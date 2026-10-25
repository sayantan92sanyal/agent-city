import { useEffect, useState } from 'react';
import { fetchTask, markTaskSeen } from '../api.js';
import { formatTranscript } from '../transcriptFormat.js';
import { Transcript } from './Transcript.jsx';

/**
 * Shows one one-off task, which runs on the server whether or not this panel
 * stays open. While the task runs, the panel polls it; once finished, it
 * shows the result and marks it read. Closing the panel loses nothing — the
 * result stays in the agent's task list.
 *
 * @param {{ taskId: string, initialTask?: Object, onClose: () => void, pollMs?: number }} props
 */
export function TaskPanel({ taskId, initialTask, onClose, pollMs = 2000 }) {
  const [task, setTask] = useState(initialTask ?? null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    let timer;
    const load = async () => {
      try {
        const next = await fetchTask(taskId);
        if (!active) return;
        setTask(next);
        setError(null);
        if (next.status === 'running') {
          timer = setTimeout(load, pollMs);
        } else if (!next.seen) {
          markTaskSeen(taskId).catch(() => {});
        }
      } catch (err) {
        if (!active) return;
        setError(err?.message || 'Failed to load task.');
        timer = setTimeout(load, pollMs);
      }
    };
    load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [taskId, pollMs]);

  const running = !task || task.status === 'running';
  const userTurn = task ? [{ type: 'user_message', text: task.message, attachments: task.attachments }] : [];
  // A finished transcript starts with the user's message itself.
  const rows = formatTranscript(task?.transcript?.length ? task.transcript : userTurn);
  if (task?.status === 'failed' && task.error && !rows.some((row) => row.kind === 'error')) {
    rows.push({ kind: 'error', text: `Error: ${task.error}` });
  }

  return (
    <div className="panel-overlay">
      <div className="panel one-off-panel" role="dialog" aria-modal="true" aria-label="Task">
        <div className="panel-header">
          <h2>Task</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>

        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}

        <Transcript
          testId="oneoff-transcript"
          rows={rows}
          statusText={
            running ? 'Running… You can close this — the result is saved and the agent shows DONE on the map.' : null
          }
        />
      </div>
    </div>
  );
}
