import { useEffect, useState } from 'react';
import { TokenMeter, usageFromTranscript } from './TokenMeter.jsx';
import { fetchChat, sendChat } from '../api.js';
import { formatTranscript } from '../transcriptFormat.js';
import { Composer } from './Composer.jsx';
import { Transcript } from './Transcript.jsx';

/**
 * Standing chat panel for one agent: loads the persisted transcript on
 * mount, lets the user send further messages, and replaces its transcript
 * with the full, updated one each `sendChat` returns. A turn keeps running
 * on the server if the panel is closed; reopened mid-turn, the panel shows
 * that turn as in progress and polls until its reply is saved.
 */
export function ChatPanel({ agentId, onClose, pollMs = 3000 }) {
  const [transcript, setTranscript] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [alreadyRunning, setAlreadyRunning] = useState(false);
  // The message currently being sent, shown immediately as the user's own
  // turn until the server returns the full updated transcript (which then
  // contains it as a persisted `user_message` entry).
  const [pendingMessage, setPendingMessage] = useState(null);
  // A turn started earlier (before this panel opened) that is still running.
  const [backgroundTurn, setBackgroundTurn] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer;
    setLoading(true);
    setError(null);

    const load = () =>
      fetchChat(agentId)
        .then(({ transcript: loaded, pending }) => {
          if (cancelled) return;
          setTranscript(loaded);
          setBackgroundTurn(pending);
          if (pending) timer = setTimeout(load, pollMs);
        })
        .catch((err) => {
          if (!cancelled) setError(err.message || 'Failed to load chat.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    load();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [agentId, pollMs]);

  // Resolves false on failure so the Composer gives the draft back.
  async function handleSend(text, attachments) {
    if (sending) return false;

    setSending(true);
    setError(null);
    setAlreadyRunning(false);
    setPendingMessage({ type: 'user_message', text, attachments });

    try {
      const updated = await sendChat(agentId, text, attachments);
      setTranscript(updated);
      return true;
    } catch (err) {
      if (err.status === 409) {
        setAlreadyRunning(true);
      } else {
        setError(err.message || 'Failed to send message.');
      }
      return false;
    } finally {
      setSending(false);
      setPendingMessage(null);
    }
  }

  return (
    <div className="panel-overlay">
      <div className="panel chat-panel" role="dialog" aria-modal="true" aria-label="Chat">
        <div className="panel-header">
          <h2>Chat</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <TokenMeter {...usageFromTranscript(transcript)} />

        {loading ? (
          <p>Loading…</p>
        ) : (
          <Transcript
            testId="chat-transcript"
            rows={formatTranscript(
              pendingMessage || backgroundTurn ? [...transcript, pendingMessage ?? backgroundTurn] : transcript
            )}
            statusText={sending || backgroundTurn ? 'Working…' : null}
          />
        )}

        {alreadyRunning && (
          <p role="alert" className="form-error">
            A turn is already running for this agent. Try again shortly.
          </p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}

        <Composer
          id="chat-message"
          label="Message"
          disabled={sending || Boolean(backgroundTurn)}
          placeholder="Reply…"
          onSubmit={handleSend}
        />
      </div>
    </div>
  );
}
