import { beforeEach, expect, test, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/config.js', () => ({
  getRoots: vi.fn(() => ['/roots/a']),
}));

vi.mock('../src/agentScanner.js', () => ({
  scanProjects: vi.fn(),
}));

vi.mock('../src/agentWriter.js', async () => {
  const actual = await vi.importActual('../src/agentWriter.js');
  return {
    AgentExistsError: actual.AgentExistsError,
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
  };
});

vi.mock('../src/agentDraft.js', async () => {
  const actual = await vi.importActual('../src/agentDraft.js');
  return { DraftError: actual.DraftError, draftAgent: vi.fn() };
});

const { getRoots } = await import('../src/config.js');
const { scanProjects } = await import('../src/agentScanner.js');
const { createAgent, updateAgent, AgentExistsError } = await import('../src/agentWriter.js');
const { draftAgent, DraftError } = await import('../src/agentDraft.js');
const { createApp } = await import('../src/app.js');
const { clearProjectsCache } = await import('../src/projectsCache.js');

const knownProject = { projectPath: '/roots/a/p1', projectName: 'p1', agents: [] };

beforeEach(() => {
  vi.clearAllMocks();
  clearProjectsCache();
  // By default the POST target is a scanned project; individual tests override.
  scanProjects.mockReturnValue([knownProject]);
});

test('GET /api/agents returns the shape produced by scanProjects(getRoots())', async () => {
  const fakeProjects = [
    { projectPath: '/roots/a/p1', projectName: 'p1', agents: [] },
  ];
  scanProjects.mockReturnValue(fakeProjects);

  const res = await request(createApp({ hostCheck: false })).get('/api/agents');

  expect(getRoots).toHaveBeenCalled();
  expect(scanProjects).toHaveBeenCalledWith(['/roots/a']);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ projects: fakeProjects });
});

test('POST /api/agents creates an agent and returns 201', async () => {
  createAgent.mockReturnValue({ filePath: '/roots/a/p1/.claude/agents/doc-writer.md', name: 'doc-writer' });

  const res = await request(createApp({ hostCheck: false }))
    .post('/api/agents')
    .send({
      projectPath: '/roots/a/p1',
      name: 'Doc Writer',
      model: 'sonnet',
      description: 'Writes docs',
      tools: ['Read', 'Write'],
    });

  expect(createAgent).toHaveBeenCalledWith('/roots/a/p1', {
    name: 'Doc Writer',
    model: 'sonnet',
    description: 'Writes docs',
    tools: ['Read', 'Write'],
  });
  expect(res.status).toBe(201);
  expect(res.body.agent.filePath).toBe('/roots/a/p1/.claude/agents/doc-writer.md');
  // The response carries the slug as `name` (matching the written frontmatter)
  // and the same id format the scanner produces.
  expect(res.body.agent.name).toBe('doc-writer');
  expect(res.body.agent.id).toBe('/roots/a/p1::doc-writer');
});

test('POST /api/agents rejects a projectPath that is not a scanned project with 400', async () => {
  const res = await request(createApp({ hostCheck: false }))
    .post('/api/agents')
    .send({
      projectPath: '/etc',
      name: 'Doc Writer',
      model: 'sonnet',
      description: 'Writes docs',
      tools: [],
    });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/projectPath/);
  expect(createAgent).not.toHaveBeenCalled();
});

test('POST /api/agents rescans rather than trusting a stale cache when validating projectPath', async () => {
  scanProjects.mockReturnValue([]);
  await request(createApp({ hostCheck: false })).get('/api/agents'); // caches "no projects"
  scanProjects.mockReturnValue([knownProject]);
  createAgent.mockReturnValue({ filePath: '/roots/a/p1/.claude/agents/x.md', name: 'x' });

  const res = await request(createApp({ hostCheck: false }))
    .post('/api/agents')
    .send({ projectPath: '/roots/a/p1', name: 'x', description: 'd', tools: [] });

  expect(res.status).toBe(201);
});

test('POST /api/agents with a duplicate name returns 409', async () => {
  createAgent.mockImplementation(() => {
    throw new AgentExistsError('doc-writer');
  });

  const res = await request(createApp({ hostCheck: false }))
    .post('/api/agents')
    .send({
      projectPath: '/roots/a/p1',
      name: 'Doc Writer',
      model: 'sonnet',
      description: 'Writes docs',
      tools: [],
    });

  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/doc-writer/);
});

test('POST /api/agents rejects a missing projectPath with 400', async () => {
  const res = await request(createApp({ hostCheck: false }))
    .post('/api/agents')
    .send({
      name: 'Doc Writer',
      model: 'sonnet',
      description: 'Writes docs',
      tools: [],
    });

  expect(res.status).toBe(400);
  expect(createAgent).not.toHaveBeenCalled();
});

test('POST /api/agents rejects tools sent as a non-array with 400', async () => {
  const res = await request(createApp({ hostCheck: false }))
    .post('/api/agents')
    .send({
      projectPath: '/roots/a/p1',
      name: 'Doc Writer',
      model: 'sonnet',
      description: 'Writes docs',
      tools: 'Read, Write',
    });

  expect(res.status).toBe(400);
  expect(createAgent).not.toHaveBeenCalled();
});

test('POST /api/agents rejects a missing name with 400', async () => {
  const res = await request(createApp({ hostCheck: false }))
    .post('/api/agents')
    .send({
      projectPath: '/roots/a/p1',
      model: 'sonnet',
      description: 'Writes docs',
      tools: [],
    });

  expect(res.status).toBe(400);
  expect(createAgent).not.toHaveBeenCalled();
});

test('POST /api/agents rejects a missing description with 400', async () => {
  const res = await request(createApp({ hostCheck: false }))
    .post('/api/agents')
    .send({
      projectPath: '/roots/a/p1',
      name: 'Doc Writer',
      model: 'sonnet',
      tools: [],
    });

  expect(res.status).toBe(400);
  expect(createAgent).not.toHaveBeenCalled();
});

const draft = { description: 'Reviews drafts. Use when the user shares one.', instructions: 'You are an editor.', tools: ['WebSearch'] };

test('POST /api/agents/draft returns Claude\'s draft for review', async () => {
  draftAgent.mockResolvedValue(draft);
  const res = await request(createApp({ hostCheck: false }))
    .post('/api/agents/draft')
    .send({ name: 'reviewer', brief: 'Review my drafts', current: { instructions: 'Old', tools: ['Agent'] } });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ draft });
  expect(draftAgent).toHaveBeenCalledWith({ name: 'reviewer', brief: 'Review my drafts', current: { instructions: 'Old', tools: ['Agent'] } });
});

test('POST /api/agents/draft validates input and reports a failed draft', async () => {
  const app = createApp({ hostCheck: false });
  expect((await request(app).post('/api/agents/draft').send({ name: 'x' })).status).toBe(400);
  expect((await request(app).post('/api/agents/draft').send({ name: 'x', brief: 'y', current: { tools: 'Agent' } })).status).toBe(400);
  draftAgent.mockRejectedValue(new DraftError('Claude could not draft the agent: boom'));
  const failed = await request(app).post('/api/agents/draft').send({ name: 'x', brief: 'y' });
  expect(failed.status).toBe(502);
  expect(failed.body.error).toContain('boom');
});

test('POST /api/agents passes instructions through to the file', async () => {
  createAgent.mockReturnValue({ filePath: '/roots/a/p1/.claude/agents/reviewer.md', name: 'reviewer' });
  await request(createApp({ hostCheck: false }))
    .post('/api/agents')
    .send({ projectPath: '/roots/a/p1', name: 'reviewer', model: 'sonnet', description: 'D', tools: [], instructions: 'Body' });
  expect(createAgent).toHaveBeenCalledWith('/roots/a/p1', { name: 'reviewer', model: 'sonnet', description: 'D', tools: [], instructions: 'Body' });
});

test('PATCH /api/agents/:id/definition saves an improved agent', async () => {
  const agent = { id: '/roots/a/p1::reviewer', name: 'reviewer', projectPath: '/roots/a/p1', filePath: '/roots/a/p1/.claude/agents/reviewer.md' };
  scanProjects.mockReturnValue([{ ...knownProject, agents: [agent] }]);
  const app = createApp({ hostCheck: false });
  const url = `/api/agents/${encodeURIComponent(agent.id)}/definition`;

  const res = await request(app).patch(url).send(draft);
  expect(res.status).toBe(200);
  expect(updateAgent).toHaveBeenCalledWith(agent.filePath, draft);

  expect((await request(app).patch(url).send({ ...draft, description: '' })).status).toBe(400);
  expect((await request(app).patch(`/api/agents/${encodeURIComponent('/roots/a/p1::nobody')}/definition`).send(draft)).status).toBe(404);
});
