import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('../src/config.js', () => ({
  getRoots: vi.fn(() => ['/roots/a']),
}));

vi.mock('../src/agentScanner.js', () => ({
  scanProjects: vi.fn(),
}));

const { getRoots } = await import('../src/config.js');
const { scanProjects } = await import('../src/agentScanner.js');
const { getProjects, clearProjectsCache, findAgentById, isKnownProjectPath, DEFAULT_TTL_MS } =
  await import('../src/projectsCache.js');

const agent = { id: '/roots/a/p1::reviewer', name: 'reviewer', projectPath: '/roots/a/p1' };
const projects = [{ projectPath: '/roots/a/p1', projectName: 'p1', agents: [agent] }];

beforeEach(() => {
  vi.clearAllMocks();
  getRoots.mockReturnValue(['/roots/a']);
  scanProjects.mockReturnValue(projects);
  clearProjectsCache();
});

test('a second call within the TTL reuses the cached scan', () => {
  let t = 1000;
  const now = () => t;
  expect(getProjects({ now })).toBe(projects);
  t += DEFAULT_TTL_MS - 1;
  getProjects({ now });
  expect(scanProjects).toHaveBeenCalledTimes(1);
});

test('a call after the TTL expires rescans', () => {
  let t = 1000;
  const now = () => t;
  getProjects({ now });
  t += DEFAULT_TTL_MS;
  getProjects({ now });
  expect(scanProjects).toHaveBeenCalledTimes(2);
});

test('fresh: true always rescans and refreshes the cache', () => {
  const now = () => 1000;
  getProjects({ now });
  getProjects({ now, fresh: true });
  expect(scanProjects).toHaveBeenCalledTimes(2);
  getProjects({ now });
  expect(scanProjects).toHaveBeenCalledTimes(2);
});

test('changing the configured roots invalidates the cache immediately', () => {
  const now = () => 1000;
  getProjects({ now });
  getRoots.mockReturnValue(['/roots/a', '/roots/b']);
  getProjects({ now });
  expect(scanProjects).toHaveBeenCalledTimes(2);
  expect(scanProjects).toHaveBeenLastCalledWith(['/roots/a', '/roots/b']);
});

test('clearProjectsCache forces the next call to rescan', () => {
  getProjects();
  clearProjectsCache();
  getProjects();
  expect(scanProjects).toHaveBeenCalledTimes(2);
});

test('findAgentById resolves against the cached scan', () => {
  expect(findAgentById(agent.id)).toBe(agent);
  expect(findAgentById('nope')).toBeUndefined();
  expect(scanProjects).toHaveBeenCalledTimes(1);
});

test('isKnownProjectPath only accepts scanned project paths', () => {
  expect(isKnownProjectPath('/roots/a/p1')).toBe(true);
  expect(isKnownProjectPath('/etc')).toBe(false);
});
