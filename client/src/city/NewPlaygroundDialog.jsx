import { useState } from 'react';
import { createPlayground } from '../api.js';

/**
 * Game-styled dialog for founding a new playground. Shows the server's error
 * text inline (e.g. "already exists") and stays open on failure.
 */
export function NewPlaygroundDialog({ onCreated, onCancel }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length > 0 && !submitting;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const playground = await createPlayground(name.trim());
      onCreated(playground);
    } catch (err) {
      setError(err.message || 'Failed to create playground.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay">
      <form
        className="modal new-playground-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="New playground"
        onSubmit={handleSubmit}
      >
        <h2>NEW PLAYGROUND</h2>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <label htmlFor="new-playground-name">Playground name</label>
        <input
          id="new-playground-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            CANCEL
          </button>
          <button type="submit" disabled={!canSubmit}>
            BUILD
          </button>
        </div>
      </form>
    </div>
  );
}
