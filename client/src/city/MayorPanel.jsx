import { useEffect, useRef, useState } from 'react';
import { TokenMeter, usageFromTranscript } from '../components/TokenMeter.jsx';
import { fetchMayorChat, sendMayorChat } from '../api.js';
import { formatTranscript } from '../transcriptFormat.js';
import { Composer } from '../components/Composer.jsx';
import { Transcript } from '../components/Transcript.jsx';

function nameFromId(id) {
  const text = String(id ?? '');
  const index = text.lastIndexOf('::');
  return index >= 0 && text.slice(index + 2) ? text.slice(index + 2) : text;
}

/**
 * Game-styled panel for the Mayor: persisted transcript (including the
 * Mayor's cross-playground asks), a send box, and a WAITING ON list of the
 * agents the Mayor is currently asking.
 */
export function MayorPanel({ links = [], agentsById = {}, mayorStatus = 'idle', onClose }) {
  const [transcript, setTranscript] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pendingMessage, setPendingMessage] = useState(null);

  const mounted = useRef(true);
  const previousStatus = useRef(mayorStatus);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A turn that finished while the panel was open (or reopened mid-turn):
  // pull the new reply.
  useEffect(() => {
    const was = previousStatus.current;
    previousStatus.current = mayorStatus;
    if (was === 'working' && mayorStatus === 'idle') {
      fetchMayorChat()
        .then((loaded) => {
          if (mounted.current) setTranscript(loaded);
        })
        .catch(() => {});
    }
  }, [mayorStatus]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchMayorChat()
      .then((loaded) => {
        if (!cancelled) setTranscript(loaded);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load chat.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolves false on failure so the Composer gives the draft back.
  async function handleSend(text, attachments) {
    if (sending) return false;

    setSending(true);
    setError(null);
    setBusy(false);
    setPendingMessage({ type: 'user_message', text, attachments });

    try {
      setTranscript(await sendMayorChat(text, attachments));
      return true;
    } catch (err) {
      if (err.status === 409) {
        setBusy(true);
      } else {
        setError(err.message || 'Failed to send message.');
      }
      return false;
    } finally {
      setSending(false);
      setPendingMessage(null);
    }
  }

  const mayorWorking = mayorStatus === 'working' && !sending;
  const waiting = links.filter((link) => link.from === 'mayor');
  const rows = formatTranscript(pendingMessage ? [...transcript, pendingMessage] : transcript);

  return (
    <div className="panel-overlay">
      <div className="panel chat-panel mayor-panel" role="dialog" aria-modal="true" aria-label="Mayor">
        <div className="panel-header">
          <h2>MAYOR</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <TokenMeter {...usageFromTranscript(transcript)} />

        {waiting.length > 0 && (
          <section className="mayor-waiting" aria-labelledby="mayor-waiting-heading">
            <h3 id="mayor-waiting-heading">WAITING ON</h3>
            <ul>
              {waiting.map((link) => (
                <li key={link.id}>
                  {agentsById[link.to]?.name || nameFromId(link.to)}
                  {link.label ? ` — ${link.label}` : ''}
                </li>
              ))}
            </ul>
          </section>
        )}

        {loading ? (
          <p>Loading…</p>
        ) : (
          <Transcript
            testId="mayor-transcript"
            rows={rows}
            assistantLabel="MAYOR"
            statusText={sending ? 'Working…' : mayorWorking ? 'The Mayor is working…' : null}
          />
        )}

        {busy && (
          <p role="alert" className="form-error">
            The Mayor is still busy. Try again shortly.
          </p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}

        <Composer
          id="mayor-message"
          label="Message"
          disabled={sending || mayorWorking}
          placeholder="Ask the Mayor…"
          onSubmit={handleSend}
        />
      </div>
    </div>
  );
}
