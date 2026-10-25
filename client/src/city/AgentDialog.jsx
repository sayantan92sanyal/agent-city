import { useEffect, useState } from 'react';
import { ImproveAgentPanel } from './ImproveAgentPanel.jsx';
import { deleteAgent, fetchTasks, startTask } from '../api.js';
import { ChatPanel } from '../components/ChatPanel.jsx';
import { Composer } from '../components/Composer.jsx';
import { TaskPanel } from '../components/TaskPanel.jsx';
import { AgentSprite, colorForName } from './sprites.jsx';

const STATUS_LABELS = { running: 'RUNNING', done: 'DONE', failed: 'FAILED' };

function timeAgo(iso) {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}

/**
 * The agent's recent one-off tasks, refreshed while the dialog is open so a
 * running task flips to DONE without reopening anything.
 */
function RecentTasks({ agentId, onOpen, pollMs = 3000 }) {
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    let active = true;
    const load = () =>
      fetchTasks(agentId)
        .then((list) => {
          if (active) setTasks(list ?? []);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, pollMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [agentId, pollMs]);

  if (tasks.length === 0) return null;

  return (
    <section className="agent-tasks" aria-labelledby={`tasks-${agentId}`}>
      <h3 id={`tasks-${agentId}`}>TASKS</h3>
      <ul>
        {tasks.slice(0, 5).map((task) => {
          const unread = task.status !== 'running' && !task.seen;
          return (
            <li key={task.id}>
              <button type="button" className="agent-task" onClick={() => onOpen(task)}>
                <span className={`agent-task-status agent-task-${task.status}`}>
                  {STATUS_LABELS[task.status] ?? task.status}
                </span>
                <span className="agent-task-message">{task.message || '(attached files)'}</span>
                <span className="agent-task-time">{timeAgo(task.finishedAt ?? task.startedAt)}</span>
                {unread && (
                  <span className="agent-task-new" aria-label="new result">
                    NEW
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Game-styled dialog for a clicked agent. TALK opens the standing chat;
 * GIVE TASK starts a one-off task from the submit handler (exactly once,
 * never from a mount effect) and shows it. Tasks run on the server, so the
 * dialog can be closed at any time; recent tasks and their results are
 * listed here. A broken agent shows its parse error and can only be closed.
 */
export function AgentDialog({ agent, status, onClose, onUpdated, onDeleted }) {
  // 'menu' | 'chat' | 'drafting' | 'task' | 'improve' | 'delete'
  const [stage, setStage] = useState('menu');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  // The task being viewed.
  const [openTask, setOpenTask] = useState(null);
  const [startError, setStartError] = useState(null);

  if (stage === 'chat') {
    return <ChatPanel agentId={agent.id} onClose={onClose} />;
  }

  if (stage === 'task' && openTask) {
    return <TaskPanel key={openTask.id} taskId={openTask.id} initialTask={openTask} onClose={onClose} />;
  }

  function showTask(task) {
    setOpenTask(task);
    setStage('task');
  }

  // Started here, exactly once per submit — React StrictMode double-runs
  // mount effects, so this must never move into one. Resolves false on
  // failure so the Composer keeps the draft.
  async function handleStartTask(text, attachments) {
    setStartError(null);
    try {
      showTask(await startTask(agent.id, text, attachments));
      return true;
    } catch (err) {
      setStartError(err?.message || 'Failed to start the task.');
      return false;
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAgent(agent.id);
      onDeleted?.(agent);
    } catch (err) {
      setDeleteError(err?.message || 'Failed to delete the agent.');
      setDeleting(false);
    }
  }

  const deleteConfirm = (
    <div className="agent-delete-confirm">
      <p>
        Move <strong>{agent.name}</strong> to the Trash? Its file goes to your Mac&apos;s Trash, so you can put it
        back from there.
      </p>
      <p className="agent-dialog-file">{agent.filePath}</p>
      {deleteError && (
        <p role="alert" className="form-error">
          {deleteError}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" onClick={() => setStage('menu')} disabled={deleting}>
          CANCEL
        </button>
        <button type="button" className="danger" onClick={handleDelete} disabled={deleting}>
          {deleting ? 'DELETING…' : 'MOVE TO TRASH'}
        </button>
      </div>
    </div>
  );

  if (agent.error) {
    return (
      <div className="modal-overlay">
        <div className="modal agent-dialog" role="dialog" aria-modal="true" aria-label={agent.name}>
          <h2>BROKEN AGENT</h2>
          <p className="agent-dialog-file">{agent.filePath || agent.name}</p>
          <p className="form-error">{agent.error}</p>
          {stage === 'delete' ? (
            deleteConfirm
          ) : (
            <div className="modal-actions">
              <button type="button" onClick={onClose}>
                CLOSE
              </button>
              <button type="button" className="danger" onClick={() => setStage('delete')}>
                DELETE
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const isWorking = status === 'working';

  return (
    <div className="modal-overlay">
      <div className="modal agent-dialog" role="dialog" aria-modal="true" aria-label={agent.name}>
        <div className="agent-dialog-header">
          <div className="agent-dialog-sprite" aria-hidden="true">
            <AgentSprite color={colorForName(agent.name)} pose={isWorking ? 'working' : 'idle'} />
          </div>
          <div>
            <h2>{agent.name}</h2>
            <span className={`agent-dialog-status ${isWorking ? 'status-working' : 'status-idle'}`}>
              {isWorking ? 'WORKING' : 'IDLE'}
            </span>
          </div>
        </div>
        {agent.description && <p className="agent-dialog-description">{agent.description}</p>}

        {stage === 'delete' ? (
          deleteConfirm
        ) : stage === 'improve' ? (
          <ImproveAgentPanel
            agent={agent}
            onBack={() => setStage('menu')}
            onSaved={(updated) => {
              setStage('menu');
              onUpdated?.(updated);
            }}
          />
        ) : stage === 'drafting' ? (
          <div className="one-off-draft">
            <Composer
              id={`one-off-message-${agent.id}`}
              label="Task"
              submitLabel="RUN"
              placeholder="Describe the task…"
              autoFocus
              onSubmit={handleStartTask}
            >
              <button type="button" onClick={() => setStage('menu')}>
                BACK
              </button>
            </Composer>
            {startError && (
              <p role="alert" className="form-error">
                {startError}
              </p>
            )}
          </div>
        ) : (
          <>
            <RecentTasks agentId={agent.id} onOpen={showTask} />
            <div className="modal-actions">
              <button type="button" onClick={onClose}>
                CLOSE
              </button>
              <button type="button" className="danger" onClick={() => setStage('delete')}>
                DELETE
              </button>
              <button type="button" onClick={() => setStage('improve')}>
                IMPROVE
              </button>
              <button type="button" onClick={() => setStage('drafting')}>
                GIVE TASK
              </button>
              <button type="submit" onClick={() => setStage('chat')}>
                TALK
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
