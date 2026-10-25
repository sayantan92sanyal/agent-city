import { randomUUID } from 'node:crypto';
import { buildOneOffArgs, buildResumeArgs, buildStartArgs } from './cliArgs.js';
import { runClaude } from './cliRunner.js';
import { buildUserContent, streamJsonUserLine } from './attachments.js';
import { createDelegationTracker } from './delegation.js';
import { loadSession, saveSession } from './transcriptStore.js';

export class AlreadyRunningError extends Error {
  constructor(agentId) {
    super(`A standing-chat turn is already running for agent "${agentId}"`);
    this.name = 'AlreadyRunningError';
    this.agentId = agentId;
  }
}

// agentId -> Promise of the in-flight standing-chat turn.
const standingChatTurns = new Map();
// agentId -> the user's message for the in-flight standing-chat turn, so a
// chat reopened mid-turn can show what is being worked on.
const pendingTurns = new Map();
// agentId -> Set<Promise> of in-flight one-off runs.
const oneOffRuns = new Map();

/** The user entry of the standing-chat turn running for `id`, or null. */
export function getPendingTurn(id) {
  return pendingTurns.get(id) ?? null;
}

export function getStatus(agentId) {
  const oneOffsForAgent = oneOffRuns.get(agentId);
  const hasOneOff = Boolean(oneOffsForAgent && oneOffsForAgent.size > 0);
  return standingChatTurns.has(agentId) || hasOneOff ? 'working' : 'idle';
}

function hasAttachments(attachments) {
  return Array.isArray(attachments) && attachments.length > 0;
}

// The argv carries the message itself unless there are attachments, in which
// case it is `null` and the whole turn goes to stdin as stream-json.
function argvMessage(message, attachments) {
  return hasAttachments(attachments) ? null : message;
}

// Runs one claude invocation, collecting its emitted events into a
// transcript. If the process fails to spawn or exits non-zero, that failure
// is appended to the transcript as an event rather than left to silently
// produce an empty/successful-looking transcript. `succeeded` tells callers
// whether the underlying claude process actually completed cleanly, which
// matters for deciding whether a newly-generated session id is now valid.
async function runTurn({ args, cwd, env, message, attachments, agent }) {
  // The user's own message is recorded as the first entry of each turn so a
  // transcript reads as an actual back-and-forth.
  const userEntry = { type: 'user_message', text: message };
  if (hasAttachments(attachments)) userEntry.attachments = attachments;
  const events = [userEntry];
  const input = hasAttachments(attachments)
    ? streamJsonUserLine(buildUserContent(message, attachments))
    : undefined;
  const tracker = agent ? createDelegationTracker({ fromAgent: agent }) : null;
  const { done } = runClaude({ args, cwd, env, input }, (event) => {
    events.push(event);
    tracker?.onEvent(event);
  });
  let result;
  try {
    result = await done;
  } finally {
    tracker?.close();
  }

  if (result.exitCode !== 0) {
    const base = result.error ? result.error.message : `claude exited with code ${result.exitCode}`;
    const stderr = (result.stderr ?? '').trim();
    events.push({
      type: 'error',
      error: stderr ? `${base}: ${stderr}` : base,
    });
  }

  return { events, succeeded: result.exitCode === 0 };
}

export function sendToStandingChat(agent, message, attachments) {
  return runStandingChat({
    id: agent.id,
    cwd: agent.projectPath,
    argsFor: ({ sessionId, resume, message: m }) =>
      (resume ? buildResumeArgs : buildStartArgs)({
        agentName: agent.name,
        sessionId,
        message: m,
      }),
    message,
    attachments,
    agent,
  });
}

// Generic standing-chat turn keyed by `id`. `argsFor` builds the argv for
// either a fresh session (`resume: false`) or a resumed one.
export async function runStandingChat({ id, cwd, env, argsFor, message, attachments, agent }) {
  if (standingChatTurns.has(id)) {
    throw new AlreadyRunningError(id);
  }

  const existing = loadSession(id);
  const sessionId = existing?.sessionId ?? randomUUID();
  const args = argsFor({ sessionId, resume: Boolean(existing), message: argvMessage(message, attachments) });

  const turnPromise = runTurn({ args, cwd, env, message, attachments, agent });
  standingChatTurns.set(id, turnPromise);
  pendingTurns.set(id, hasAttachments(attachments) ? { type: 'user_message', text: message, attachments } : { type: 'user_message', text: message });

  try {
    const { events: newEvents, succeeded } = await turnPromise;
    const transcript = [...(existing?.transcript ?? []), ...newEvents];
    // A brand-new sessionId is only valid once the turn that introduced it
    // actually succeeded — the `claude` CLI is what creates the session
    // server-side. If the very first turn for this agent fails (spawn error
    // or non-zero exit), persisting that sessionId would make the *next*
    // call `--resume` a session that was never created, wedging the agent
    // in a permanent resume-a-dead-session failure loop. Don't persist in
    // that case, so the next call starts fresh with a new `--session-id`
    // instead. An existing (already-established) session is persisted
    // regardless of this turn's outcome, since it was valid before this
    // call and resuming it again next time is still the right move.
    if (existing || succeeded) {
      saveSession(id,{ sessionId, transcript });
    }
    return transcript;
  } finally {
    standingChatTurns.delete(id);
    pendingTurns.delete(id);
  }
}

export async function runOneOff(agent, message, attachments) {
  const args = buildOneOffArgs({ agentName: agent.name, message: argvMessage(message, attachments) });
  const turnPromise = runTurn({ args, cwd: agent.projectPath, message, attachments, agent });

  let runsForAgent = oneOffRuns.get(agent.id);
  if (!runsForAgent) {
    runsForAgent = new Set();
    oneOffRuns.set(agent.id, runsForAgent);
  }
  runsForAgent.add(turnPromise);

  try {
    const { events } = await turnPromise;
    return events;
  } finally {
    runsForAgent.delete(turnPromise);
    if (runsForAgent.size === 0) {
      oneOffRuns.delete(agent.id);
    }
  }
}
