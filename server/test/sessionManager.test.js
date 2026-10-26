import { beforeEach, expect, test, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const runClaudeMock = vi.fn();
vi.mock('../src/cliRunner.js', () => ({
  runClaude: (...args) => runClaudeMock(...args),
}));

const { sendToStandingChat, runOneOff, getStatus, AlreadyRunningError } = await import(
  '../src/sessionManager.js'
);
const transcriptStore = await import('../src/transcriptStore.js');

const agent = { id: '/proj::my-agent', name: 'my-agent', tools: ['Read'], projectPath: '/proj' };

// Returns a controllable fake runClaude implementation: emits one event
// synchronously, and resolves `done` only when the test calls `resolveRun`.
function deferredRunClaude(events = [{ type: 'assistant', text: 'ok' }]) {
  let resolve;
  const done = new Promise((res) => {
    resolve = res;
  });
  const impl = ({ args, cwd }, onEvent) => {
    events.forEach((e) => onEvent(e));
    return { kill: vi.fn(), done };
  };
  return { impl, resolveRun: (result = { exitCode: 0 }) => resolve(result) };
}

// Resolves immediately with exitCode 0 after emitting the given events.
function immediateRunClaude(events = [{ type: 'assistant', text: 'ok' }]) {
  return ({ args, cwd }, onEvent) => {
    events.forEach((e) => onEvent(e));
    return { kill: vi.fn(), done: Promise.resolve({ exitCode: 0 }) };
  };
}

beforeEach(() => {
  process.env.AGENT_PANEL_HOME = mkdtempSync(join(tmpdir(), 'acp-state-'));
  runClaudeMock.mockReset();
});

test('first sendToStandingChat generates a session id and persists it', async () => {
  runClaudeMock.mockImplementation(immediateRunClaude());
  await sendToStandingChat(agent, 'hello');
  expect(transcriptStore.loadSession(agent.id).sessionId).toBeTruthy();
});

test('second sendToStandingChat resumes the same session id', async () => {
  runClaudeMock.mockImplementation(immediateRunClaude());
  await sendToStandingChat(agent, 'hello');
  const firstId = transcriptStore.loadSession(agent.id).sessionId;
  await sendToStandingChat(agent, 'again');
  expect(transcriptStore.loadSession(agent.id).sessionId).toBe(firstId);
});

test('second sendToStandingChat uses --resume with the first session id', async () => {
  runClaudeMock.mockImplementation(immediateRunClaude());
  await sendToStandingChat(agent, 'hello');
  const firstId = transcriptStore.loadSession(agent.id).sessionId;
  await sendToStandingChat(agent, 'again');
  const secondCallArgs = runClaudeMock.mock.calls[1][0].args;
  expect(secondCallArgs).toContain('--resume');
  expect(secondCallArgs).toContain(firstId);
});

test('sendToStandingChat rejects while a previous turn for the same agent is still running', async () => {
  const { impl, resolveRun } = deferredRunClaude();
  runClaudeMock.mockImplementation(impl);
  const first = sendToStandingChat(agent, 'slow'); // fake runClaude not yet resolved
  await expect(sendToStandingChat(agent, 'too soon')).rejects.toThrow(AlreadyRunningError);
  resolveRun();
  await first;
});

test('getStatus is "working" during a call and "idle" after it resolves', async () => {
  const { impl, resolveRun } = deferredRunClaude();
  runClaudeMock.mockImplementation(impl);
  const p = sendToStandingChat(agent, 'hello');
  expect(getStatus(agent.id)).toBe('working');
  resolveRun();
  await p;
  expect(getStatus(agent.id)).toBe('idle');
});

test('getStatus reflects a one-off run independently of standing chat', async () => {
  const { impl, resolveRun } = deferredRunClaude();
  runClaudeMock.mockImplementation(impl);
  const p = runOneOff(agent, 'one off task');
  expect(getStatus(agent.id)).toBe('working');
  resolveRun();
  await p;
  expect(getStatus(agent.id)).toBe('idle');
});

test('getStatus is "working" when standing chat and one-off are both in flight for the same agent', async () => {
  const standing = deferredRunClaude([{ type: 'assistant', text: 'standing' }]);
  const oneOff = deferredRunClaude([{ type: 'assistant', text: 'oneoff' }]);
  runClaudeMock
    .mockImplementationOnce(standing.impl)
    .mockImplementationOnce(oneOff.impl);

  const standingPromise = sendToStandingChat(agent, 'hello');
  const oneOffPromise = runOneOff(agent, 'task');
  expect(getStatus(agent.id)).toBe('working');

  standing.resolveRun();
  await standingPromise;
  expect(getStatus(agent.id)).toBe('working'); // one-off still running

  oneOff.resolveRun();
  await oneOffPromise;
  expect(getStatus(agent.id)).toBe('idle');
});

test('a one-off run for the same agent is not blocked while its standing chat is running', async () => {
  const standing = deferredRunClaude();
  const oneOff = deferredRunClaude();
  runClaudeMock
    .mockImplementationOnce(standing.impl)
    .mockImplementationOnce(oneOff.impl);

  const standingPromise = sendToStandingChat(agent, 'hello');
  const oneOffPromise = runOneOff(agent, 'task');
  oneOff.resolveRun();
  await expect(oneOffPromise).resolves.toBeTruthy();

  standing.resolveRun();
  await standingPromise;
});

test('a standing chat for a different agent is not blocked by another agent\'s in-flight turn', async () => {
  const otherAgent = { id: '/proj::other-agent', name: 'other-agent', tools: [], projectPath: '/proj' };
  const first = deferredRunClaude();
  const second = deferredRunClaude();
  runClaudeMock.mockImplementationOnce(first.impl).mockImplementationOnce(second.impl);

  const p1 = sendToStandingChat(agent, 'hello');
  const p2 = sendToStandingChat(otherAgent, 'hello');
  second.resolveRun();
  await expect(p2).resolves.toBeTruthy();

  first.resolveRun();
  await p1;
});

test('runOneOff does not change the standing chat session id or persisted transcript', async () => {
  runClaudeMock.mockImplementation(immediateRunClaude());
  await sendToStandingChat(agent, 'hello');
  const before = transcriptStore.loadSession(agent.id);
  await runOneOff(agent, 'one off task');
  expect(transcriptStore.loadSession(agent.id)).toEqual(before);
});

test('a failed standing-chat turn (spawn error) is reflected as an error in the transcript, not silently empty', async () => {
  const spawnError = new Error('ENOENT: claude not found');
  runClaudeMock.mockImplementation(({ args, cwd }, onEvent) => ({
    kill: vi.fn(),
    done: Promise.resolve({ exitCode: null, error: spawnError }),
  }));
  const transcript = await sendToStandingChat(agent, 'hello');
  expect(transcript.length).toBeGreaterThan(0);
  expect(JSON.stringify(transcript)).toMatch(/ENOENT|error/i);
  // Status must return to idle even after a failed turn.
  expect(getStatus(agent.id)).toBe('idle');
});

test('a failed first turn for a new agent does not persist a dead session id', async () => {
  const spawnError = new Error('ENOENT: claude not found');
  runClaudeMock.mockImplementationOnce(() => ({
    kill: vi.fn(),
    done: Promise.resolve({ exitCode: null, error: spawnError }),
  }));
  await sendToStandingChat(agent, 'hello');
  // Nothing should have been persisted — the generated sessionId was never
  // actually established by the CLI, so there is no valid session to resume.
  expect(transcriptStore.loadSession(agent.id)).toBeNull();
});

test('after a failed first turn, the next call starts a fresh session instead of resuming the dead one', async () => {
  const spawnError = new Error('ENOENT: claude not found');
  runClaudeMock
    .mockImplementationOnce(() => ({
      kill: vi.fn(),
      done: Promise.resolve({ exitCode: null, error: spawnError }),
    }))
    .mockImplementationOnce(immediateRunClaude());

  await sendToStandingChat(agent, 'hello');
  await sendToStandingChat(agent, 'retry');

  const secondCallArgs = runClaudeMock.mock.calls[1][0].args;
  expect(secondCallArgs).toContain('--session-id');
  expect(secondCallArgs).not.toContain('--resume');
  // The retry succeeded, so now there should be a persisted session.
  expect(transcriptStore.loadSession(agent.id).sessionId).toBeTruthy();
});

test('a successful first turn persists its session id so the next call resumes it (happy path unaffected)', async () => {
  runClaudeMock.mockImplementation(immediateRunClaude());
  await sendToStandingChat(agent, 'hello');
  const firstId = transcriptStore.loadSession(agent.id).sessionId;
  expect(firstId).toBeTruthy();

  await sendToStandingChat(agent, 'again');
  const secondCallArgs = runClaudeMock.mock.calls[1][0].args;
  expect(secondCallArgs).toContain('--resume');
  expect(secondCallArgs).toContain(firstId);
  expect(transcriptStore.loadSession(agent.id).sessionId).toBe(firstId);
});

test('a failed turn on an already-established session still persists that session id (not a new-session case)', async () => {
  runClaudeMock.mockImplementationOnce(immediateRunClaude());
  await sendToStandingChat(agent, 'hello');
  const firstId = transcriptStore.loadSession(agent.id).sessionId;

  const spawnError = new Error('temporary failure');
  runClaudeMock.mockImplementationOnce(() => ({
    kill: vi.fn(),
    done: Promise.resolve({ exitCode: null, error: spawnError }),
  }));
  await sendToStandingChat(agent, 'again');

  // The session was already established by the first (successful) turn, so
  // a failure on a later turn must not wipe out or change that sessionId.
  expect(transcriptStore.loadSession(agent.id).sessionId).toBe(firstId);
});

test('a failed one-off run surfaces the error in its returned transcript', async () => {
  runClaudeMock.mockImplementation(() => ({
    kill: vi.fn(),
    done: Promise.resolve({ exitCode: 1 }),
  }));
  const transcript = await runOneOff(agent, 'task');
  expect(transcript.length).toBeGreaterThan(0);
  expect(getStatus(agent.id)).toBe('idle');
});

test('a non-zero exit includes the captured stderr text in the transcript error entry', async () => {
  runClaudeMock.mockImplementation(() => ({
    kill: vi.fn(),
    done: Promise.resolve({ exitCode: 1, stderr: 'Error: agent "nope" not found\n' }),
  }));
  const transcript = await runOneOff(agent, 'task');
  const errorEntry = transcript.find((e) => e.type === 'error');
  expect(errorEntry.error).toBe('claude exited with code 1: Error: agent "nope" not found');
});

test('a spawn error includes captured stderr when there is any', async () => {
  runClaudeMock.mockImplementation(() => ({
    kill: vi.fn(),
    done: Promise.resolve({ exitCode: null, error: new Error('spawn EACCES'), stderr: '' }),
  }));
  const transcript = await sendToStandingChat(agent, 'hello');
  expect(transcript.find((e) => e.type === 'error').error).toBe('spawn EACCES');
});

test('each turn records the user\'s own message as a user_message entry before the response', async () => {
  runClaudeMock.mockImplementation(immediateRunClaude([{ type: 'assistant', text: 'reply' }]));
  await sendToStandingChat(agent, 'hello');
  const transcript = await sendToStandingChat(agent, 'again');
  expect(transcript).toEqual([
    { type: 'user_message', text: 'hello' },
    { type: 'assistant', text: 'reply' },
    { type: 'user_message', text: 'again' },
    { type: 'assistant', text: 'reply' },
  ]);
  expect(transcriptStore.loadSession(agent.id).transcript).toEqual(transcript);
});

test('a one-off transcript starts with the task message', async () => {
  runClaudeMock.mockImplementation(immediateRunClaude([{ type: 'assistant', text: 'done' }]));
  expect(await runOneOff(agent, 'do it')).toEqual([
    { type: 'user_message', text: 'do it' },
    { type: 'assistant', text: 'done' },
  ]);
});

test('one-off delegation shows a link while pending and clears it afterwards', async () => {
  const { activeLinks, clearLinks } = await import('../src/links.js');
  clearLinks();
  const toolUse = {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 'toolu_9', name: 'Agent', input: { subagent_type: 'growth', description: 'go' } }] },
  };
  const { impl, resolveRun } = deferredRunClaude([toolUse]);
  runClaudeMock.mockImplementation(impl);
  const p = runOneOff(agent, 'task');
  expect(activeLinks()).toMatchObject([{ from: '/proj::my-agent', to: '/proj::growth' }]);
  resolveRun();
  await p;
  expect(activeLinks()).toEqual([]);
});

test('attachments send the turn on stdin and are recorded on the user entry', async () => {
  const { saveAttachments } = await import('../src/attachments.js');
  const metas = saveAttachments([{ name: 'shot.png', mediaType: 'image/png', data: Buffer.from('IMG').toString('base64') }]);
  runClaudeMock.mockImplementation(immediateRunClaude());

  const transcript = await sendToStandingChat(agent, 'look', metas);

  const { args, input } = runClaudeMock.mock.calls[0][0];
  expect(args.slice(-2)).toEqual(['--input-format', 'stream-json']);
  expect(args).not.toContain('look');
  const content = JSON.parse(input).message.content;
  expect(content[0].type).toBe('image');
  expect(content.at(-1).text).toMatch(/^look/);
  expect(transcript[0]).toEqual({ type: 'user_message', text: 'look', attachments: metas });
});

test('without attachments the message stays positional and nothing goes to stdin', async () => {
  runClaudeMock.mockImplementation(immediateRunClaude());
  await runOneOff(agent, 'plain');
  const { args, input } = runClaudeMock.mock.calls[0][0];
  expect(args.slice(-2)).toEqual(['--', 'plain']);
  expect(input).toBeUndefined();
});

test('runOneOff with a session starts it, or resumes it, and keeps it', async () => {
  runClaudeMock.mockImplementation(() => ({ kill: vi.fn(), done: Promise.resolve({ exitCode: 0 }) }));
  await runOneOff(agent, 'task', undefined, { sessionId: 'sid-1', resume: false });
  let args = runClaudeMock.mock.calls.at(-1)[0].args;
  expect(args).toContain('--session-id');
  expect(args).not.toContain('--no-session-persistence');

  await runOneOff(agent, 'more', undefined, { sessionId: 'sid-1', resume: true });
  args = runClaudeMock.mock.calls.at(-1)[0].args;
  expect(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2)).toEqual(['--resume', 'sid-1']);

  await runOneOff(agent, 'mayor question');
  expect(runClaudeMock.mock.calls.at(-1)[0].args).toContain('--no-session-persistence');
});
