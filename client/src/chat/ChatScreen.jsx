import { useEffect, useRef, useState } from 'react';
import { Composer } from '../components/Composer.jsx';
import { Transcript } from '../components/Transcript.jsx';
import { formatTranscript } from '../transcriptFormat.js';
import {
  chatFileUrl,
  createChat,
  deleteChat,
  fetchChatSettings,
  fetchConnectors,
  getChat,
  listChats,
  sendChatMessage,
  stopChat,
  updateChat,
} from './chatApi.js';
import { ChatSettingsBar } from './ChatSettingsBar.jsx';
import { ChatList } from './ChatList.jsx';
import { liveStatusText } from './liveStatus.js';
import { TokenMeter, usageFromTranscript } from '../components/TokenMeter.jsx';

const BUSY_MESSAGE = 'Claude is still replying in this chat.';

function summaryOf(chat) {
  return { id: chat.id, title: chat.title, updatedAt: chat.updatedAt, running: Boolean(chat.running) };
}

/**
 * The Chat view: past chats on the left, the open conversation on the
 * right. While a turn is live the chat is polled every `pollMs` and the
 * reply streams in; Stop kills the turn. Every load result is tagged with
 * the chat it was requested for, so a slow response for a chat that is no
 * longer open never touches the screen.
 */
export function ChatScreen({ pollMs = 750 }) {
  const [chats, setChats] = useState([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [activeId, setActiveId] = useState(null);
  // The last load of a chat: { id, chat, live }. Shown only while `id` is active.
  const [current, setCurrent] = useState(null);
  // Bumped after a send so polling restarts at once for the new live turn.
  const [pollKey, setPollKey] = useState(0);
  const pollKeyRef = useRef(0);
  // The message just sent, shown until a load started after the send lands:
  // { chatId, entry, key } (key = the pollKey whose loads may clear it).
  const [pending, setPending] = useState(null);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const activeIdRef = useRef(null);
  activeIdRef.current = activeId;
  const [options, setOptions] = useState({ models: [], efforts: [] });
  const [connectorInfo, setConnectorInfo] = useState({ connectors: [], error: null });

  useEffect(() => {
    let cancelled = false;
    fetchChatSettings()
      .then((data) => {
        if (!cancelled) setOptions({ models: data.models ?? [], efforts: data.efforts ?? [] });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load chat settings.');
      });
    fetchConnectors()
      .then((data) => {
        if (!cancelled) setConnectorInfo({ connectors: data.connectors ?? [], error: data.error ?? null });
      })
      .catch((err) => {
        if (!cancelled) setConnectorInfo({ connectors: [], error: err.message || 'Failed to load connectors.' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshConnectors() {
    try {
      const data = await fetchConnectors(true);
      setConnectorInfo({ connectors: data.connectors ?? [], error: data.error ?? null });
    } catch (err) {
      setConnectorInfo((info) => ({ ...info, error: err.message || 'Failed to refresh connectors.' }));
    }
  }

  // Settings changes not yet confirmed by the server, oldest first:
  // [{ seq, id, changes }]. Each response is reconciled with the ones still
  // outstanding so a quick second edit is never undone by the first reply.
  const settingsQueueRef = useRef([]);
  const settingsSeqRef = useRef(0);
  const settingsAppliedRef = useRef(0);

  function outstandingFor(id) {
    return settingsQueueRef.current.filter((item) => item.id === id).reduce((acc, item) => ({ ...acc, ...item.changes }), {});
  }

  function bumpPoll() {
    setPollKey(++pollKeyRef.current);
  }

  // `changes` holds only the edited field(s); the server merges them.
  async function handleSettingsChange(changes) {
    const id = activeId;
    if (!id) return;
    const seq = ++settingsSeqRef.current;
    settingsQueueRef.current.push({ seq, id, changes });
    setCurrent((c) => (c && c.id === id ? { ...c, chat: { ...c.chat, settings: { ...c.chat.settings, ...changes } } } : c));
    try {
      const chat = await updateChat(id, { settings: changes });
      settingsQueueRef.current = settingsQueueRef.current.filter((item) => item.seq !== seq);
      if (seq < settingsAppliedRef.current) return; // a newer reply already landed
      settingsAppliedRef.current = seq;
      const settings = { ...chat.settings, ...outstandingFor(id) };
      setCurrent((c) => (c && c.id === id ? { ...c, chat: { ...c.chat, ...chat, settings } } : c));
      if (activeIdRef.current === id) setError(null);
    } catch (err) {
      settingsQueueRef.current = settingsQueueRef.current.filter((item) => item.seq !== seq);
      if (activeIdRef.current === id) setError(err.message || 'Failed to update settings.');
      // Put the saved settings back in place of the optimistic ones.
      getChat(id)
        .then((result) => {
          const saved = { ...result.chat.settings, ...outstandingFor(id) };
          setCurrent((c) => (c && c.id === id ? { ...c, chat: { ...c.chat, settings: saved } } : c));
        })
        .catch(() => {});
    }
  }

  useEffect(() => {
    let cancelled = false;
    listChats()
      .then((list) => {
        if (cancelled) return;
        setChats(list);
        setActiveId((selected) => selected ?? list[0]?.id ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load chats.');
      })
      .finally(() => {
        if (!cancelled) setListLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the open chat, and keep polling it while a turn is live. Changing
  // chats (or unmounting) cancels the loop and drops any in-flight result.
  useEffect(() => {
    if (!activeId) return undefined;
    const id = activeId;
    const runKey = pollKey;
    let cancelled = false;
    let timer;
    let live = false;

    const load = async () => {
      try {
        const result = await getChat(id);
        if (cancelled) return;
        live = Boolean(result.chat.running || result.live);
        const settings = { ...result.chat.settings, ...outstandingFor(id) };
        setCurrent({ id, chat: { ...result.chat, settings }, live: result.live });
        setPending((sent) => (sent && sent.chatId === id && sent.key <= runKey ? null : sent));
        setChats((list) =>
          list.map((item) => (item.id === id ? { ...item, title: result.chat.title, running: live } : item))
        );
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err.message || 'Failed to load chat.');
      }
      if (live && !cancelled) timer = setTimeout(load, pollMs);
    };
    load();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeId, pollMs, pollKey]);

  function select(id) {
    if (id === activeId) return;
    setActiveId(id);
    setBusy(false);
    setError(null);
  }

  async function handleNew() {
    setError(null);
    try {
      const chat = await createChat();
      setChats((list) => [summaryOf(chat), ...list.filter((item) => item.id !== chat.id)]);
      setCurrent({ id: chat.id, chat, live: null });
      select(chat.id);
    } catch (err) {
      setError(err.message || 'Failed to create chat.');
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this chat?')) return;
    try {
      await deleteChat(id);
    } catch (err) {
      setError(err.message || 'Failed to delete chat.');
      return;
    }
    const remaining = chats.filter((item) => item.id !== id);
    setChats((list) => list.filter((item) => item.id !== id));
    if (activeIdRef.current === id) {
      setActiveId(remaining[0]?.id ?? null);
      setBusy(false);
      setError(null);
    }
  }

  // Resolves false on failure so the Composer gives the draft back.
  async function handleSend(text, attachments) {
    const id = activeId;
    if (!id || sending) return false;
    setSending(true);
    setBusy(false);
    setError(null);
    const entry = { type: 'user_message', text };
    if (attachments.length > 0) entry.attachments = attachments;
    setPending({ chatId: id, entry, key: Infinity });
    try {
      await sendChatMessage(id, text, attachments);
      const next = ++pollKeyRef.current;
      setPending((sent) => (sent && sent.chatId === id ? { ...sent, key: next } : sent));
      setPollKey(next);
      return true;
    } catch (err) {
      setPending((sent) => (sent && sent.chatId === id ? null : sent));
      if (activeIdRef.current === id) {
        if (err.status === 409) {
          setBusy(true);
          bumpPoll(); // follow the turn that is already running
        } else setError(err.message || 'Failed to send message.');
      }
      return false;
    } finally {
      setSending(false);
    }
  }

  async function handleStop() {
    const id = activeId;
    try {
      await stopChat(id);
    } catch (err) {
      if (activeIdRef.current === id) setError(err.message || 'Failed to stop.');
    }
  }

  const shown = current && current.id === activeId ? current : null;
  const live = shown?.live ?? null;
  const running = Boolean(shown?.chat.running || live);
  const pendingEntry = pending && pending.chatId === activeId ? pending.entry : null;
  const entries = shown ? [...shown.chat.transcript] : [];
  if (live) entries.push(live.userEntry, ...live.events);
  else if (pendingEntry) entries.push(pendingEntry);
  // The live turn's result is not in the transcript yet; its running count is.
  const used = usageFromTranscript(shown ? shown.chat.transcript : []);
  if (live?.usage) {
    used.input += live.usage.input;
    used.output += live.usage.output;
  }
  const title = shown?.chat.title ?? chats.find((item) => item.id === activeId)?.title ?? '';

  return (
    <div className="chat-screen">
      <ChatList chats={chats} activeId={activeId} onSelect={select} onNew={handleNew} onDelete={handleDelete} />
      <section className="chat-main" aria-label="Conversation">
        {activeId ? (
          <>
            <header className="chat-main-header">
              <h2 className="chat-main-title" title={title}>
                {title}
              </h2>
              <TokenMeter input={used.input} output={used.output} />
            </header>
            {shown ? (
              <Transcript
                key={activeId}
                testId="chat-screen-transcript"
                rows={formatTranscript(entries)}
                assistantLabel="Claude"
                renderVisuals
                followMedia
                fileUrl={(path) => chatFileUrl(activeId, path)}
                streamingText={live?.partialText || undefined}
                streamingLabel={options.models.find((m) => m.local && m.value === shown.chat.settings.model)?.label}
                statusText={running || pendingEntry ? liveStatusText(live) : null}
              />
            ) : (
              <p className="chat-main-loading">Loading…</p>
            )}
            {busy && (
              <p role="alert" className="form-error chat-main-alert">
                {BUSY_MESSAGE}
              </p>
            )}
            {error && (
              <p role="alert" className="form-error chat-main-alert">
                {error}
              </p>
            )}
            <Composer
              id="chat-screen-message"
              label="Message"
              disabled={running || sending}
              placeholder="Message Claude…"
              onSubmit={handleSend}
              onStop={running ? handleStop : undefined}
            >
              {shown && (
                <ChatSettingsBar
                  settings={shown.chat.settings}
                  models={options.models}
                  efforts={options.efforts}
                  connectors={connectorInfo.connectors}
                  connectorsError={connectorInfo.error}
                  folderLocked={Boolean(shown.chat.sessionStarted) || running || shown.chat.transcript.length > 0}
                  onChange={handleSettingsChange}
                  onRefreshConnectors={refreshConnectors}
                />
              )}
            </Composer>
          </>
        ) : (
          <div className="chat-empty">
            {listLoaded ? (
              <>
                <h2 className="chat-empty-title">NEW CHAT</h2>
                <p>No chats yet. Start one with + NEW CHAT.</p>
              </>
            ) : (
              <p className="chat-main-loading">Loading…</p>
            )}
            {error && (
              <p role="alert" className="form-error chat-main-alert">
                {error}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
