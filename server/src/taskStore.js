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

export class TaskBusyError extends Error {
  constructor() {
    super('This task is still running. Wait for it to finish, then send your follow-up.');
    this.name = 'TaskBusyError';
  }
}

export class NoFollowUpError extends Error {
  constructor() {
    super('This task ran before follow-ups were possible, so it cannot take one. Give the agent a new task instead.');
    this.name = 'NoFollowUpError';
  }
}

// Runs one turn of `task` in the background, saving the record as running
// and then with the turn's events added to `earlier`.
function runTurn(agent, task, earlier, message, attachments, resume) {
  save(task);
  live.add(task.id);

  const finished = runOneOff(agent, message, attachments, { sessionId: task.sessionId, resume })
    .then((events) => {
      const outcome = finalReply(events);
      return { status: 'error' in outcome ? 'failed' : 'done', transcript: [...earlier, ...events], error: outcome.error };
    })
    .catch((err) => ({ status: 'failed', transcript: earlier, error: err instanceof Error ? err.message : String(err) }))
    .then((result) => {
      const { pending: _pending, ...rest } = task;
      const done = { ...rest, ...result, finishedAt: new Date().toISOString() };
      if (done.error === undefined) delete done.error;
      save(done);
      live.delete(task.id);
      return done;
    });

  return { task, finished };
}

/**
 * Starts a one-off task for `agent` in the background and returns its
 * `running` record straight away. `finished` resolves once the run is over
 * and the record is saved (tests wait on it; routes don't). The task gets its
 * own Claude session, so it can take follow-ups later.
 */
export function startTask(agent, message, attachments = []) {
  const task = {
    id: randomUUID(),
    agentId: agent.id,
    agentName: agent.name,
    sessionId: randomUUID(),
    message,
    attachments,
    status: 'running',
    startedAt: new Date().toISOString(),
    seen: false,
  };
  return runTurn(agent, task, [], message, attachments, false);
}

/**
 * Sends a follow-up message to a finished task, resuming its Claude session.
 * The record is running again until the reply is saved after the earlier
 * transcript; `pending` holds the follow-up meanwhile. Returns null for an
 * unknown task.
 */
export function continueTask(agent, id, message, attachments = []) {
  const existing = load(id);
  if (!existing) return null;
  if (existing.status === 'running') throw new TaskBusyError();
  if (!existing.sessionId) throw new NoFollowUpError();

  const { error: _error, finishedAt: _finishedAt, transcript = [], ...rest } = existing;
  const pending = { type: 'user_message', text: message };
  if (attachments.length > 0) pending.attachments = attachments;
  const task = { ...rest, status: 'running', seen: false, pending };
  return runTurn(agent, { ...task, transcript }, transcript, message, attachments, true);
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
