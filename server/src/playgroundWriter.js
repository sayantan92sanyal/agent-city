import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRoots, setRoots } from './config.js';
import { clearProjectsCache, isKnownProjectPath } from './projectsCache.js';
import { moveToTrash } from './trash.js';

// The folder Agent City itself runs from; it must never be trashed.
const APP_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export class PlaygroundDeleteError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlaygroundDeleteError';
  }
}

export class PlaygroundExistsError extends Error {
  constructor(slug) {
    super(`a playground folder named "${slug}" already exists`);
    this.name = 'PlaygroundExistsError';
    this.slug = slug;
  }
}

export class InvalidPlaygroundNameError extends Error {
  constructor() {
    super('name must contain at least one letter or digit');
    this.name = 'InvalidPlaygroundNameError';
  }
}

export function playgroundsDir() {
  return process.env.AGENT_PANEL_PLAYGROUNDS_DIR || join(homedir(), 'Documents', 'Projects');
}

export function slugifyPlayground(name) {
  const slug = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  if (!slug) throw new InvalidPlaygroundNameError();
  return slug;
}

// Path-segment-wise: `/a/b` covers `/a/b` and `/a/b/c` but not `/a/bc`.
function covers(root, dir) {
  const r = resolve(root);
  const prefix = r.endsWith(sep) ? r : r + sep;
  return dir === r || dir.startsWith(prefix);
}

function ensureRootCovers(dir) {
  const roots = getRoots();
  if (roots.some((root) => covers(root, dir))) return;
  setRoots([...roots, dir]);
}

export function createPlayground(name) {
  const slug = slugifyPlayground(name);
  const dir = resolve(playgroundsDir());
  mkdirSync(dir, { recursive: true });
  const projectPath = join(dir, slug);
  try {
    // Non-recursive: EEXIST is atomic, so nothing is created if it exists.
    mkdirSync(projectPath);
  } catch (err) {
    if (err.code === 'EEXIST') throw new PlaygroundExistsError(slug);
    throw err;
  }
  mkdirSync(join(projectPath, '.claude', 'agents'), { recursive: true });
  ensureRootCovers(dir);
  clearProjectsCache();
  return { projectPath, projectName: slug };
}

/**
 * Moves a playground's whole folder to the Trash. Only a folder the scanner
 * found as a playground qualifies, and never a watched root, the home folder
 * or a folder holding Agent City itself.
 */
export function trashPlayground(projectPath) {
  const dir = resolve(projectPath);
  if (!isKnownProjectPath(dir, { fresh: true })) {
    throw new PlaygroundDeleteError('That folder is not a playground in the City.');
  }
  if (getRoots().some((root) => resolve(root) === dir) || dir === resolve(homedir())) {
    throw new PlaygroundDeleteError('This folder is one Agent City watches as a whole, so it cannot be deleted from here.');
  }
  if (covers(dir, APP_DIR)) {
    throw new PlaygroundDeleteError('This folder holds Agent City itself, so it cannot be deleted from here.');
  }
  const trashedTo = moveToTrash(dir);
  clearProjectsCache();
  return trashedTo;
}
