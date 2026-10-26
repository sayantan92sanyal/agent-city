import { beforeEach, expect, test, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../src/config.js', () => ({ getRoots: vi.fn(() => ['/roots/a']) }));
vi.mock('../src/agentScanner.js', () => ({ scanProjects: vi.fn() }));
vi.mock('../src/sessionManager.js', () => ({ runOneOff: vi.fn(), getStatus: vi.fn(() => 'idle') }));

const { scanProjects } = await import('../src/agentScanner.js');
const { runOneOff } = await import('../src/sessionManager.js');
const { startTask } = await import('../src/taskStore.js');
const { createApp } = await import('../src/app.js');
const { clearProjectsCache } = await import('../src/projectsCache.js');

const agent = { id: '/roots/a/p1::analyst', name: 'analyst', projectPath: '/roots/a/p1' };
const ok = [{ type: 'result', result: 'done', is_error: false }];

beforeEach(() => {
  process.env.AGENT_PANEL_HOME = mkdtempSync(join(tmpdir(), 'acp-task-routes-'));
  vi.clearAllMocks();
  clearProjectsCache();
  scanProjects.mockReturnValue([{ projectPath: '/roots/a/p1', projectName: 'p1', agents: [agent] }]);
});

test('POST /api/tasks/:id/messages sends a follow-up and answers with the running task', async () => {
  runOneOff.mockResolvedValueOnce(ok);
  const first = startTask(agent, 'report');
  await first.finished;
  runOneOff.mockReturnValueOnce(new Promise(() => {}));

  const res = await request(createApp({ hostCheck: false }))
    .post(`/api/tasks/${first.task.id}/messages`)
    .send({ message: 'and per agent?' });

  expect(res.status).toBe(200);
  expect(res.body.task).toMatchObject({ id: first.task.id, status: 'running' });
  expect(res.body.task.transcript).toBeUndefined();
  expect(runOneOff).toHaveBeenLastCalledWith(agent, 'and per agent?', [], { sessionId: first.task.sessionId, resume: true });
});

test('POST /api/tasks/:id/messages answers 409 while the task runs, 404 for unknown tasks, 400 for a blank message', async () => {
  runOneOff.mockReturnValue(new Promise(() => {}));
  const { task } = startTask(agent, 'slow');
  const app = createApp({ hostCheck: false });

  expect((await request(app).post(`/api/tasks/${task.id}/messages`).send({ message: 'hi' })).status).toBe(409);
  expect((await request(app).post('/api/tasks/44444444-4444-4444-4444-444444444444/messages').send({ message: 'hi' })).status).toBe(404);
  expect((await request(app).post(`/api/tasks/${task.id}/messages`).send({ message: '  ' })).status).toBe(400);
});
