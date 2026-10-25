import { useEffect, useState } from 'react';
import { fetchRoots, saveRoots } from '../api.js';

/**
 * Panel for viewing and editing the configured project root folders.
 */
export function SettingsPanel({ onSaved, onClose }) {
  const [roots, setRoots] = useState([]);
  const [newRoot, setNewRoot] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetchRoots()
      .then((fetchedRoots) => {
        if (!cancelled) {
          setRoots(fetchedRoots);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleAdd() {
    const trimmed = newRoot.trim();
    if (trimmed.length === 0 || roots.includes(trimmed)) {
      return;
    }
    setRoots([...roots, trimmed]);
    setNewRoot('');
  }

  function handleRemove(root) {
    setRoots(roots.filter((r) => r !== root));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const savedRoots = await saveRoots(roots);
      onSaved(savedRoots);
    } catch (err) {
      setError(err.message || 'Failed to save roots.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel-overlay">
      <div className="panel settings-panel" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="panel-header">
          <h2>Settings</h2>
          {onClose && (
            <button type="button" onClick={onClose}>
              Close
            </button>
          )}
        </div>

        <p className="settings-hint">
          Root folders are searched for projects containing <code>.claude/agents/</code>.
        </p>

        {error && <p role="alert" className="form-error">{error}</p>}

        <ul className="settings-roots-list">
          {roots.map((root) => (
            <li key={root}>
              <span>{root}</span>
              <button type="button" onClick={() => handleRemove(root)}>
                Remove {root}
              </button>
            </li>
          ))}
        </ul>

        <label htmlFor="settings-add-root">Add root</label>
        <div className="settings-add-row">
          <input
            id="settings-add-root"
            type="text"
            value={newRoot}
            onChange={(event) => setNewRoot(event.target.value)}
          />
          <button type="button" onClick={handleAdd}>
            Add
          </button>
        </div>

        <div className="settings-actions">
          <button type="button" onClick={handleSave} disabled={saving}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
