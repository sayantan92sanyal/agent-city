import { useState } from 'react';
import { deletePlayground } from '../api.js';

/**
 * Confirms deleting a playground: its whole folder (not just the agents)
 * moves to the Mac's Trash, from where it can be put back.
 */
export function DeletePlaygroundDialog({ project, onDeleted, onCancel }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const agentCount = project.agents?.length ?? 0;

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deletePlayground(project.projectPath);
      onDeleted(project);
    } catch (err) {
      setError(err?.message || 'Failed to delete the playground.');
      setDeleting(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal agent-dialog" role="dialog" aria-modal="true" aria-label="Delete playground">
        <h2>DELETE PLAYGROUND</h2>
        <p>
          Move <strong>{project.projectName}</strong> to the Trash? The whole folder and everything in it, not just
          its {agentCount} {agentCount === 1 ? 'agent' : 'agents'}, goes to your Mac&apos;s Trash. You can put it
          back from there.
        </p>
        <p className="agent-dialog-file">{project.projectPath}</p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onCancel} disabled={deleting}>
            CANCEL
          </button>
          <button type="button" className="danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'DELETING…' : 'MOVE FOLDER TO TRASH'}
          </button>
        </div>
      </div>
    </div>
  );
}
