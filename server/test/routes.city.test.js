import { beforeEach, expect, test, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/config.js', () => ({ getRoots: vi.fn(() => ['/roots/a']) }));
vi.mock('../src/agentScanner.js', () => ({ scanProjects: vi.fn() }));
vi.mock('../src/sessionManager.js', () => ({ getStatus: vi.fn() }));
vi.mock('../src/taskStore.js', () => ({ unseenTaskCounts: vi.fn(() => ({ '/roots/a/p1::idle': 2 })) }));

const { scanProjects } = await import('../src/agentScanner.js');
const { getStatus } = await import('../src/sessionManager.js');
const { createApp } = await import('../src/app.js');
const { clearProjectsCache } = await import('../src/projectsCache.js');
const { startLink, clearLinks } = await import('../src/links.js');

const mk = (n) => ({ id: `/roots/a/p1::${n}`, name: n, projectPath: '/roots/a/p1' });

beforeEach(() => {
  vi.clearAllMocks();
  clearProjectsCache();
  clearLinks();
  scanProjects.mockReturnValue([
    {
      projectPath: '/roots/a/p1',
      projectName: 'p1',
      agents: [mk('idle'), mk('busy'), mk('linked'), { id: '/roots/a/p1::bad', name: 'bad', error: 'x' }],
    },
  ]);
  getStatus.mockImplementation((id) => (id === '/roots/a/p1::busy' || id === 'mayor' ? 'working' : 'idle'));
});

test('city status reports agents, mayor and links', async () => {
  startLink({ from: 'mayor', to: '/roots/a/p1::linked', label: 'ask' });
  const res = await request(createApp({ hostCheck: false })).get('/api/city/status');
  expect(res.status).toBe(200);
  expect(res.body.agents).toEqual({
    '/roots/a/p1::idle': 'idle',
    '/roots/a/p1::busy': 'working',
    '/roots/a/p1::linked': 'working',
    '/roots/a/p1::bad': 'idle',
  });
  expect(res.body.mayor).toBe('working');
  expect(res.body.links).toHaveLength(1);
  expect(Object.keys(res.body.links[0]).sort()).toEqual(['from', 'id', 'label', 'to']);
  expect(res.body.links[0]).toMatchObject({ from: 'mayor', to: '/roots/a/p1::linked', label: 'ask' });
});

test('city status reports unread task results per agent', async () => {
  const res = await request(createApp({ hostCheck: false })).get('/api/city/status');
  expect(res.body.unseenTasks).toEqual({ '/roots/a/p1::idle': 2 });
});
