import { beforeEach, expect, test, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/config.js', () => ({
  getRoots: vi.fn(() => ['/roots/a']),
}));

vi.mock('../src/agentScanner.js', () => ({
  scanProjects: vi.fn(),
}));

vi.mock('../src/sessionManager.js', async () => {
  const actual = await vi.importActual('../src/sessionManager.js');
  return {
    AlreadyRunningError: actual.AlreadyRunningError,
    sendToStandingChat: vi.fn(),
    getPendingTurn: vi.fn(() => null),
    getStatus: vi.fn(),
  };
});

vi.mock('../src/taskStore.js', () => ({
  startTask: vi.fn(),
  listTasks: vi.fn(),
  summarize: (task) => task,
}));

vi.mock('../src/transcriptStore.js', () => ({
  loadSession: vi.fn(),
}));

const { getRoots } = await import('../src/config.js');
const { scanProjects } = await import('../src/agentScanner.js');
const { sendToStandingChat, getPendingTurn, getStatus, AlreadyRunningError } = await import(
  '../src/sessionManager.js'
);
const { startTask, listTasks } = await import('../src/taskStore.js');
const { loadSession } = await import('../src/transcriptStore.js');
const { createApp } = await import('../src/app.js');
const { clearProjectsCache } = await import('../src/projectsCache.js');

const fakeAgent = {
  id: '/roots/a/p1::doc-writer',
  name: 'doc-writer',
  description: 'Writes docs',
  tools: ['Read', 'Write'],
  model: 'sonnet',
  projectPath: '/roots/a/p1',
  filePath: '/roots/a/p1/.claude/agents/doc-writer.md',
};

function mockProjectsWithAgent() {
  scanProjects.mockReturnValue([
    { projectPath: '/roots/a/p1', projectName: 'p1', agents: [fakeAgent] },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  clearProjectsCache();
});

test('POST /api/agents/:id/chat returns the transcript', async () => {
  mockProjectsWithAgent();
  const transcript = [{ type: 'message', text: 'hi' }];
  sendToStandingChat.mockResolvedValue(transcript);

  const res = await request(createApp({ hostCheck: false }))
    .post(`/api/agents/${encodeURIComponent(fakeAgent.id)}/chat`)
    .send({ message: 'hello' });

  expect(getRoots).toHaveBeenCalled();
  expect(sendToStandingChat).toHaveBeenCalledWith(fakeAgent, 'hello', []);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ transcript });
});

test('POST /api/agents/:id/chat returns 409 when AlreadyRunningError is thrown', async () => {
  mockProjectsWithAgent();
  sendToStandingChat.mockRejectedValue(new AlreadyRunningError(fakeAgent.id));

  const res = await request(createApp({ hostCheck: false }))
    .post(`/api/agents/${encodeURIComponent(fakeAgent.id)}/chat`)
    .send({ message: 'hello' });

  expect(res.status).toBe(409);
});

test('POST /api/agents/:id/chat propagates an unexpected error as a 500', async () => {
  mockProjectsWithAgent();
  sendToStandingChat.mockRejectedValue(new Error('boom'));

  const res = await request(createApp({ hostCheck: false }))
    .post(`/api/agents/${encodeURIComponent(fakeAgent.id)}/chat`)
    .send({ message: 'hello' });

  expect(res.status).toBe(500);
});

test('GET /api/agents/:id/chat returns the stored transcript', async () => {
  mockProjectsWithAgent();
  loadSession.mockReturnValue({ sessionId: 'abc', transcript: [{ type: 'message', text: 'hi' }] });

  const res = await request(createApp({ hostCheck: false })).get(`/api/agents/${encodeURIComponent(fakeAgent.id)}/chat`);

  expect(loadSession).toHaveBeenCalledWith(fakeAgent.id);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ transcript: [{ type: 'message', text: 'hi' }], pending: null });
});

test('GET /api/agents/:id/chat returns an empty transcript when none is stored', async () => {
  mockProjectsWithAgent();
  loadSession.mockReturnValue(null);

  const res = await request(createApp({ hostCheck: false })).get(`/api/agents/${encodeURIComponent(fakeAgent.id)}/chat`);

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ transcript: [], pending: null });
});

test('GET /api/agents/:id/chat includes the turn still running, if any', async () => {
  mockProjectsWithAgent();
  loadSession.mockReturnValue(null);
  getPendingTurn.mockReturnValueOnce({ type: 'user_message', text: 'still going' });

  const res = await request(createApp({ hostCheck: false })).get(`/api/agents/${encodeURIComponent(fakeAgent.id)}/chat`);

  expect(res.body.pending).toEqual({ type: 'user_message', text: 'still going' });
});

test('POST /api/agents/:id/tasks starts a task and answers at once with it', async () => {
  mockProjectsWithAgent();
  const task = { id: 't1', status: 'running', message: 'do a thing' };
  startTask.mockReturnValue({ task, finished: new Promise(() => {}) });

  const res = await request(createApp({ hostCheck: false }))
    .post(`/api/agents/${encodeURIComponent(fakeAgent.id)}/tasks`)
    .send({ message: 'do a thing' });

  expect(startTask).toHaveBeenCalledWith(fakeAgent, 'do a thing', []);
  expect(res.status).toBe(201);
  expect(res.body).toEqual({ task });
});

test('GET /api/agents/:id/tasks lists the agent\'s tasks', async () => {
  mockProjectsWithAgent();
  listTasks.mockReturnValue([{ id: 't1' }]);
  const res = await request(createApp({ hostCheck: false })).get(`/api/agents/${encodeURIComponent(fakeAgent.id)}/tasks`);
  expect(listTasks).toHaveBeenCalledWith(fakeAgent.id);
  expect(res.body).toEqual({ tasks: [{ id: 't1' }] });
});

test('GET /api/agents/:id/status returns the current status', async () => {
  mockProjectsWithAgent();
  getStatus.mockReturnValue('working');

  const res = await request(createApp({ hostCheck: false })).get(`/api/agents/${encodeURIComponent(fakeAgent.id)}/status`);

  expect(getStatus).toHaveBeenCalledWith(fakeAgent.id);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'working' });
});

test('an unknown agentId returns 404 on chat', async () => {
  scanProjects.mockReturnValue([]);

  const res = await request(createApp({ hostCheck: false })).post('/api/agents/does-not-exist/chat').send({ message: 'hi' });

  expect(res.status).toBe(404);
  expect(sendToStandingChat).not.toHaveBeenCalled();
});

test('an unknown agentId returns 404 on GET chat', async () => {
  scanProjects.mockReturnValue([]);

  const res = await request(createApp({ hostCheck: false })).get('/api/agents/does-not-exist/chat');

  expect(res.status).toBe(404);
  expect(loadSession).not.toHaveBeenCalled();
});

test('an unknown agentId returns 404 on starting a task', async () => {
  scanProjects.mockReturnValue([]);

  const res = await request(createApp({ hostCheck: false })).post('/api/agents/does-not-exist/tasks').send({ message: 'hi' });

  expect(res.status).toBe(404);
  expect(startTask).not.toHaveBeenCalled();
});

test('an unknown agentId returns 404 on status', async () => {
  scanProjects.mockReturnValue([]);

  const res = await request(createApp({ hostCheck: false })).get('/api/agents/does-not-exist/status');

  expect(res.status).toBe(404);
  expect(getStatus).not.toHaveBeenCalled();
});

test.each([
  ['missing', {}],
  ['empty', { message: '' }],
  ['whitespace-only', { message: '   ' }],
  ['non-string', { message: 42 }],
])('POST chat with a %s message returns 400 and never spawns', async (_label, body) => {
  mockProjectsWithAgent();

  const res = await request(createApp({ hostCheck: false }))
    .post(`/api/agents/${encodeURIComponent(fakeAgent.id)}/chat`)
    .send(body);

  expect(res.status).toBe(400);
  expect(sendToStandingChat).not.toHaveBeenCalled();
});

test.each([
  ['missing', {}],
  ['empty', { message: '' }],
  ['non-string', { message: ['a'] }],
])('POST tasks with a %s message returns 400 and never spawns', async (_label, body) => {
  mockProjectsWithAgent();

  const res = await request(createApp({ hostCheck: false }))
    .post(`/api/agents/${encodeURIComponent(fakeAgent.id)}/tasks`)
    .send(body);

  expect(res.status).toBe(400);
  expect(startTask).not.toHaveBeenCalled();
});

test('repeated status polls reuse the cached scan instead of re-walking the filesystem', async () => {
  mockProjectsWithAgent();
  getStatus.mockReturnValue('idle');
  const app = createApp({ hostCheck: false });
  const url = `/api/agents/${encodeURIComponent(fakeAgent.id)}/status`;

  await request(app).get(url);
  await request(app).get(url);
  await request(app).get(url);

  expect(scanProjects).toHaveBeenCalledTimes(1);
});

test('GET /api/agents forces a rescan that the status route then reuses', async () => {
  mockProjectsWithAgent();
  getStatus.mockReturnValue('idle');
  const app = createApp({ hostCheck: false });

  await request(app).get(`/api/agents/${encodeURIComponent(fakeAgent.id)}/status`);
  await request(app).get('/api/agents');
  expect(scanProjects).toHaveBeenCalledTimes(2);

  await request(app).get(`/api/agents/${encodeURIComponent(fakeAgent.id)}/status`);
  expect(scanProjects).toHaveBeenCalledTimes(2);
});

test('POST chat accepts a blank message when files are attached, and stores them', async () => {
  process.env.AGENT_PANEL_HOME = (await import('node:fs')).mkdtempSync(
    (await import('node:path')).join((await import('node:os')).tmpdir(), 'acp-route-att-')
  );
  mockProjectsWithAgent();
  sendToStandingChat.mockResolvedValue([]);

  const res = await request(createApp({ hostCheck: false }))
    .post(`/api/agents/${encodeURIComponent(fakeAgent.id)}/chat`)
    .send({ message: '', attachments: [{ name: 'a.png', mediaType: 'image/png', data: Buffer.from('x').toString('base64') }] });

  expect(res.status).toBe(200);
  const [, message, attachments] = sendToStandingChat.mock.calls[0];
  expect(message).toBe('');
  expect(attachments).toEqual([{ id: expect.any(String), name: 'a.png', mediaType: 'image/png', size: 1 }]);

  const served = await request(createApp({ hostCheck: false })).get(`/api/attachments/${attachments[0].id}`);
  expect(served.status).toBe(200);
  expect(served.headers['content-type']).toMatch(/image\/png/);
});

test('POST tasks rejects an invalid attachment with 400', async () => {
  mockProjectsWithAgent();
  const res = await request(createApp({ hostCheck: false }))
    .post(`/api/agents/${encodeURIComponent(fakeAgent.id)}/tasks`)
    .send({ message: 'hi', attachments: [{ name: 'a.zip', mediaType: 'application/zip', data: '' }] });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/empty/);
  expect(startTask).not.toHaveBeenCalled();
});
