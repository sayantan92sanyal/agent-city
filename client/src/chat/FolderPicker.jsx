import { useEffect, useRef, useState } from 'react';
import { fetchFolders } from './chatApi.js';

/**
 * Small dialog for choosing a working folder: browse sub-folders, jump to a
 * quick pick, or paste a path. Server errors show inline and the picker
 * stays on the previous path.
 */
export function FolderPicker({ value, onPick, onClose }) {
  const [listing, setListing] = useState(null);
  const [error, setError] = useState(null);
  const [pasted, setPasted] = useState('');
  const aliveRef = useRef(true);

  async function go(path) {
    try {
      const result = await fetchFolders(path);
      if (!aliveRef.current) return;
      setListing(result);
      setError(null);
    } catch (err) {
      if (aliveRef.current) setError(err.message || 'Failed to open folder.');
    }
  }

  useEffect(() => {
    aliveRef.current = true;
    go(value);
    return () => {
      aliveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handlePaste(event) {
    event.preventDefault();
    const path = pasted.trim();
    if (path) go(path);
  }

  const join = (name) => `${listing.path.replace(/\/$/, '')}/${name}`;

  return (
    <div className="chat-folder-picker" role="dialog" aria-label="Choose folder">
      <div className="chat-folder-current" title={listing?.path}>
        {listing ? listing.path : 'Loading…'}
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {listing && (
        <>
          <div className="chat-folder-row">
            <button type="button" disabled={!listing.parent} onClick={() => go(listing.parent)}>
              Up
            </button>
            {listing.quickPicks.map((pick) => (
              <button key={pick.path} type="button" onClick={() => go(pick.path)}>
                {pick.label}
              </button>
            ))}
          </div>
          <ul className="chat-folder-list">
            {listing.folders.map((name) => (
              <li key={name}>
                <button type="button" onClick={() => go(join(name))}>
                  {name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <form className="chat-folder-row" onSubmit={handlePaste}>
        <input
          type="text"
          aria-label="Paste a path"
          placeholder="Paste a path"
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
        />
        <button type="submit">Go</button>
      </form>
      <div className="chat-folder-row">
        <button type="button" disabled={!listing} onClick={() => onPick(listing.path)}>
          Use this folder
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
