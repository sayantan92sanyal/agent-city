import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { finalReply } from './mayor/finalReply.js';
import { runOneOff } from './sessionManager.js';

/**
 * One-off tasks that outlive the panel that started them.
 *
 * Starting a task saves a `running` record and runs the agent in the
 * background; when it finishes, the record gets the transcript and becomes
 * `done` or `failed` (and `seen: false`, so the map can flag a result the
 * user hasn't opened yet). Records are files under `<home>/tasks/`, so
 * results also survive a server restart. A task still marked `running` that
 * this process isn't actually running was cut off by a restart and is
 * reported as failed.
 */

const ID_PATTERN = /^[0-9a-f-]{36}$/;
const LIST_LIMIT = 20;

// Task ids running in this server process.
const live = new Set();

function tasksDir() {
  const home = process.env.AGENT_PANEL_HOME || join(homedir(), '.agent-control-panel');
  return join(home, 'tasks');
}

function taskFile(id) {
  return join(tasksDir(), `${id}.json`);
}

// Write to a temp file and rename it into place so readers never see a partial file.
function save(task) {
  mkdirSync(tasksDir(), { recursive: true });
  const file = taskFile(task.id);
  writeFileSync(`${file}.tmp`, JSON.stringify(task, null, 2));
  renameSync(`${file}.tmp`, file);
}

function withLiveness(task) {
  if (task.status === 'running' && !live.has(task.id)) {
    return { ...task, status: 'failed', error: 'The server restarted before this task finished.' };
  }
  return task;
}

function load(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
  const file = taskFile(id);
  if (!existsSync(file)) return null;
  try {
    return withLiveness(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

function loadAll() {
  if (!existsSync(tasksDir())) return [];
  return readdirSync(tasksDir())
    .filter((name) => name.endsWith('.json'))
    .map((name) => load(name.slice(0, -'.json'.length)))
    .filter(Boolean);
}

/** A task without its (possibly large) transcript, for lists. */
export function summarize({ transcript: _transcript, ...summary }) {
  return summary;
}

/**
 * Starts a one-off task for `agent` in the background and returns its
 * `running` record straight away. `finished` resolves once the run is over
 * and the record is saved (tests wait on it; routes don't).
 */
export function startTask(agent, message, attachments = []) {
  const task = {
    id: randomUUID(),
    agentId: agent.id,
    agentName: agent.name,
    message,
    attachments,
    status: 'running',
    startedAt: new Date().toISOString(),
    seen: false,
  };
  save(task);
  live.add(task.id);

  const finished = runOneOff(agent, message, attachments)
    .then((transcript) => {
      const outcome = finalReply(transcript);
      return { status: 'error' in outcome ? 'failed' : 'done', transcript, error: outcome.error };
    })
    .catch((err) => ({ status: 'failed', transcript: [], error: err instanceof Error ? err.message : String(err) }))
    .then((result) => {
      const done = { ...task, ...result, finishedAt: new Date().toISOString() };
      if (done.error === undefined) delete done.error;
      save(done);
      live.delete(task.id);
      return done;
    });

  return { task, finished };
}

export function getTask(id) {
  return load(id);
}

/** An agent's most recent tasks, newest first, without transcripts. */
export function listTasks(agentId) {
  return loadAll()
    .filter((task) => task.agentId === agentId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, LIST_LIMIT)
    .map(summarize);
}

/** Marks a finished task as read. Returns the task, or null if unknown. */
export function markTaskSeen(id) {
  const task = load(id);
  if (!task) return null;
  if (task.status !== 'running' && !task.seen) {
    const updated = { ...task, seen: true };
    save(updated);
    return updated;
  }
  return task;
}

/** agentId -> number of finished tasks whose result hasn't been opened. */
export function unseenTaskCounts() {
  const counts = {};
  for (const task of loadAll()) {
    if (task.status !== 'running' && !task.seen) {
      counts[task.agentId] = (counts[task.agentId] ?? 0) + 1;
    }
  }
  return counts;
}
