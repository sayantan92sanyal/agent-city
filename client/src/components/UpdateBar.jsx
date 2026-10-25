import { useEffect, useRef, useState } from 'react';

async function fetchServerVersion() {
  const res = await fetch('/api/version', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).version ?? null;
}

function reloadPage() {
  window.location.reload();
}

// Text typed but not sent anywhere on the page; a reload would lose it.
function hasUnsentText() {
  return [...document.querySelectorAll('textarea, input[type="text"], input:not([type])')].some(
    (field) => field.value.trim() !== ''
  );
}

/**
 * Notices when the server starts serving a newer build than this window
 * loaded, and offers a reload. While the window is in the background and
 * nothing is typed, it reloads by itself; a reply in progress is not lost,
 * because chats and tasks keep running on the server.
 */
export function UpdateBar({ fetchVersion = fetchServerVersion, reload = reloadPage, intervalMs = 30000 }) {
  const [updated, setUpdated] = useState(false);
  // The app re-renders every few seconds; the latest callbacks live in a ref
  // so the check below runs once and keeps the version this window started with.
  const latest = useRef({ fetchVersion, reload });
  latest.current = { fetchVersion, reload };

  useEffect(() => {
    const reload = () => latest.current.reload();
    let loaded; // the version this window started with
    let found = false;
    let cancelled = false;

    const reloadIfIdle = () => {
      if (found && document.hidden && !hasUnsentText()) reload();
    };
    const check = async () => {
      if (found) return;
      try {
        const version = await latest.current.fetchVersion();
        if (cancelled) return;
        if (loaded === undefined) loaded = version;
        else if (loaded && version && version !== loaded) {
          found = true;
          setUpdated(true);
          reloadIfIdle();
        }
      } catch {
        // The server is restarting; try again next time.
      }
    };
    const onVisibility = () => {
      if (document.hidden) reloadIfIdle();
      else check();
    };

    check();
    const timer = setInterval(check, intervalMs);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', check);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', check);
    };
  }, [intervalMs]);

  if (!updated) return null;
  return (
    <div className="update-bar" role="status">
      <span>Agent City was updated.</span>
      <button type="button" onClick={() => latest.current.reload()}>
        Reload
      </button>
    </div>
  );
}
