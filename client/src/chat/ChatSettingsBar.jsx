import { useEffect, useRef, useState } from 'react';
import { FolderPicker } from './FolderPicker.jsx';

const AUTH_HINT = 'Sign in via the Claude desktop app';
const STE_TITLE = 'Simplified Technical English (ASD-STE100): short sentences, simple approved words, active voice';

function folderLabel(folder) {
  if (!folder) return '~';
  const trimmed = folder.replace(/\/+$/, '');
  return trimmed.split('/').pop() || '/';
}

/**
 * Model, effort, STE, connector and folder pickers shown beside the composer.
 * `onChange` receives only the changed field, e.g. `{ model: 'opus' }`. At
 * most one popover is open; a mousedown outside it or Escape closes it.
 */
export function ChatSettingsBar({
  settings,
  models = [],
  efforts = [],
  connectors = [],
  connectorsError = null,
  folderLocked = false,
  onChange,
  onRefreshConnectors,
}) {
  // Which popover is open: 'connectors', 'folder' or null.
  const [open, setOpen] = useState(null);
  const connectorsRef = useRef(null);
  const folderRef = useRef(null);
  const disabled = settings.disabledConnectors ?? [];
  const enabledCount = connectors.filter((c) => c.status === 'connected' && !disabled.includes(c.name)).length;
  // Local models run on this Mac without Claude Code: no effort levels, no connectors.
  const isLocal = models.some((m) => m.local && m.value === settings.model);
  const claudeModels = models.filter((m) => !m.local);
  const localModels = models.filter((m) => m.local);
  const connectorsOpen = open === 'connectors';
  const folderOpen = open === 'folder';

  useEffect(() => {
    if (!open) return undefined;
    const anchor = (open === 'connectors' ? connectorsRef : folderRef).current;
    const onMouseDown = (event) => {
      if (anchor && !anchor.contains(event.target)) setOpen(null);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function toggleConnector(name, checked) {
    const next = checked ? disabled.filter((n) => n !== name) : [...disabled, name];
    onChange({ disabledConnectors: next });
  }

  return (
    <div className="chat-settings-bar">
      <select aria-label="Model" value={settings.model} onChange={(e) => onChange({ model: e.target.value })}>
        {localModels.length > 0 ? (
          <>
            <optgroup label="Claude">
              {claudeModels.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="On this Mac (no tools)">
              {localModels.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          </>
        ) : (
          claudeModels.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))
        )}
      </select>
      <select
        aria-label="Effort"
        value={settings.effort}
        disabled={isLocal}
        title={isLocal ? 'Local models do not use effort levels' : undefined}
        onChange={(e) => onChange({ effort: e.target.value })}
      >
        {efforts.map((e) => (
          <option key={e} value={e}>
            {e}
          </option>
        ))}
      </select>
      <button
        type="button"
        role="switch"
        className="chat-pill chat-switch"
        aria-checked={settings.simplifiedEnglish === true}
        aria-label="Simplified Technical English (ASD-STE100)"
        title={STE_TITLE}
        onClick={() => onChange({ simplifiedEnglish: settings.simplifiedEnglish !== true })}
      >
        <span className="chat-switch-track" aria-hidden="true" /> STE
      </button>
      <span className="chat-popover-anchor" ref={connectorsRef}>
        <button
          type="button"
          className="chat-pill"
          aria-label="Connectors"
          aria-expanded={connectorsOpen}
          disabled={isLocal}
          title={isLocal ? 'Local models cannot use connectors' : undefined}
          onClick={() => setOpen((current) => (current === 'connectors' ? null : 'connectors'))}
        >
          🔌 {enabledCount}
        </button>
        {connectorsOpen && (
          <div className="chat-popover" role="dialog" aria-label="Connectors list">
            {connectorsError && (
              <p role="alert" className="form-error">
                {connectorsError}
              </p>
            )}
            <ul className="chat-connector-list">
              {connectors.map((c) => {
                const usable = c.status === 'connected';
                return (
                  <li key={c.name}>
                    <label>
                      <input
                        type="checkbox"
                        disabled={!usable}
                        checked={usable && !disabled.includes(c.name)}
                        onChange={(e) => toggleConnector(c.name, e.target.checked)}
                      />
                      <span>{c.name}</span>
                    </label>
                    {!usable && <small> {AUTH_HINT}</small>}
                  </li>
                );
              })}
            </ul>
            <button type="button" onClick={onRefreshConnectors}>
              Refresh
            </button>
          </div>
        )}
      </span>
      <span className="chat-popover-anchor" ref={folderRef}>
        <button
          type="button"
          className="chat-pill"
          aria-label="Folder"
          aria-expanded={folderOpen}
          disabled={folderLocked}
          title={folderLocked ? 'Folder is fixed after the first message' : settings.folder}
          onClick={() => setOpen((current) => (current === 'folder' ? null : 'folder'))}
        >
          📁 {folderLabel(settings.folder)}
        </button>
        {folderOpen && (
          <FolderPicker
            value={settings.folder}
            onClose={() => setOpen(null)}
            onPick={(path) => {
              setOpen(null);
              onChange({ folder: path });
            }}
          />
        )}
      </span>
    </div>
  );
}
