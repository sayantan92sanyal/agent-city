import { getRoots } from './config.js';
import { scanProjects } from './agentScanner.js';

// The board polls one `/status` request per agent every few seconds; each of
// those has to resolve its agentId. Re-walking the filesystem for every
// request would mean N full walks per poll interval, so scan results are
// cached briefly. The cache is keyed on the configured roots, so changing
// the roots is picked up immediately.
export const DEFAULT_TTL_MS = 5000;

let cache = null; // { key, projects, at }

/**
 * Returns the scanned projects for the currently configured roots.
 * @param {object} [options]
 * @param {boolean} [options.fresh] - bypass the cache and rescan (the result
 *   still refreshes the cache).
 * @param {number} [options.ttlMs]
 * @param {() => number} [options.now] - injectable clock, for tests.
 */
export function getProjects({ fresh = false, ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  const roots = getRoots();
  const key = JSON.stringify(roots);
  const t = now();
  if (!fresh && cache && cache.key === key && t - cache.at < ttlMs) {
    return cache.projects;
  }
  const projects = scanProjects(roots);
  cache = { key, projects, at: t };
  return projects;
}

export function clearProjectsCache() {
  cache = null;
}

export function findAgentById(agentId, options) {
  for (const project of getProjects(options)) {
    const match = project.agents.find((agent) => agent.id === agentId);
    if (match) return match;
  }
  return undefined;
}

export function isKnownProjectPath(projectPath, options) {
  return getProjects(options).some((project) => project.projectPath === projectPath);
}
