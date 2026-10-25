import { beforeEach, expect, test, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/config.js', () => ({ getRoots: vi.fn(() => ['/roots/a']) }));
vi.mock('../src/agentScanner.js', () => ({ scanProjects: vi.fn() }));
vi.mock('../src/sessionManager.js', async () => {
  const actual = await vi.importActual('../src/sessionManager.js');
  return {
    AlreadyRunningError: actual.AlreadyRunningError,
    sendToStandingChat: vi.fn(),
    runOneOff: vi.fn(),
    getStatus: vi.fn(),
  };
});

const { scanProjects } = await import('../src/agentScanner.js');
const { runOneOff } = await import('../src/sessionManager.js');
const { createApp } = await import('../src/app.js');
const { clearProjectsCache } = await import('../src/projectsCache.js');
const { getBridgeToken } = await import('../src/mayor/bridgeToken.js');
const { activeLinks, clearLinks } = await import('../src/links.js');

const agent = {
  id: '/roots/a/p1::geo',
  name: 'geo',
  description: 'Knows geography',
  tools: [],
  model: 'sonnet',
  projectPath: '/roots/a/p1',
  filePath: '/roots/a/p1/.claude/agents/geo.md',
};
const broken = { id: '/roots/a/p1::bad', name: 'bad', error: 'parse failure' };

beforeEach(() => {
  vi.clearAllMocks();
  clearProjectsCache();
  clearLinks();
  scanProjects.mockReturnValue([{ projectPath: '/roots/a/p1', projectName: 'p1', agents: [agent, broken] }]);
});

const app = () => createApp({ hostCheck: false });

test('getBridgeToken is a stable 64-char hex string', () => {
  expect(getBridgeToken()).toMatch(/^[0-9a-f]{64}$/);
  expect(getBridgeToken()).toBe(getBridgeToken());
});

test('agents without token is 401', async () => {
  const res = await request(app()).get('/api/bridge/agents');
  expect(res.status).toBe(401);
  expect(res.body).toEqual({ error: 'bad bridge token' });
});

test('agents lists healthy agents with playground', async () => {
  const res = await request(app()).get('/api/bridge/agents').set('x-bridge-token', getBridgeToken());
  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    agents: [{ id: agent.id, name: 'geo', description: 'Knows geography', playground: 'p1' }],
  });
});

test('ask without token is 401 and spawns nothing', async () => {
  const res = await request(app()).post('/api/bridge/ask').send({ agentId: agent.id, message: 'hi' });
  expect(res.status).toBe(401);
  expect(runOneOff).not.toHaveBeenCalled();
});

test('ask for unknown agent returns readable error, spawns nothing', async () => {
  const res = await request(app())
    .post('/api/bridge/ask')
    .set('x-bridge-token', getBridgeToken())
    .send({ agentId: '/nope::x', message: 'hi' });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ error: 'Unknown agentId "/nope::x"' });
  expect(runOneOff).not.toHaveBeenCalled();
});

test('ask runs a one-off, returns its final reply, and holds a mayor link while running', async () => {
  let during;
  runOneOff.mockImplementation(async () => {
    during = activeLinks();
    return [{ type: 'result', result: 'Paris', is_error: false }];
  });
  const res = await request(app())
    .post('/api/bridge/ask')
    .set('x-bridge-token', getBridgeToken())
    .send({ agentId: agent.id, message: 'capital of France?' });
  expect(runOneOff).toHaveBeenCalledWith(agent, 'capital of France?');
  expect(during).toHaveLength(1);
  expect(during[0]).toMatchObject({ from: 'mayor', to: agent.id, label: 'capital of France?' });
  expect(activeLinks()).toEqual([]);
  expect(res.body).toEqual({ reply: 'Paris' });
});

test('link is released and error returned when runOneOff rejects', async () => {
  runOneOff.mockRejectedValue(new Error('boom'));
  const res = await request(app())
    .post('/api/bridge/ask')
    .set('x-bridge-token', getBridgeToken())
    .send({ agentId: agent.id, message: 'hi' });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ error: 'boom' });
  expect(activeLinks()).toEqual([]);
});

test.each([
  ['missing message', { agentId: agent.id }],
  ['blank message', { agentId: agent.id, message: '  ' }],
  ['non-string agentId', { agentId: 5, message: 'hi' }],
])('ask with %s is 400', async (_label, body) => {
  const res = await request(app()).post('/api/bridge/ask').set('x-bridge-token', getBridgeToken()).send(body);
  expect(res.status).toBe(400);
  expect(runOneOff).not.toHaveBeenCalled();
});

test('agents caps each description at 300 characters', async () => {
  const { getProjects } = await import('../src/projectsCache.js');
  const long = { ...agent, description: 'x'.repeat(500) };
  const spy = vi.spyOn(await import('../src/projectsCache.js'), 'getProjects').mockReturnValue([
    { projectName: 'p1', agents: [long] },
  ]);
  try {
    const res = await request(app()).get('/api/bridge/agents').set('x-bridge-token', getBridgeToken());
    expect(res.body.agents[0].description).toHaveLength(300);
  } finally {
    spy.mockRestore();
  }
});
