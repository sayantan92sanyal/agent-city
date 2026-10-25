import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { EFFORTS, MODELS } from './chatArgs.js';
import { isLocalModel } from './localModels.js';
import { listChats, getChat } from './chatStore.js';
import { getProjects } from '../projectsCache.js';

const RECENT_FOLDERS = 5;

export class SettingsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SettingsError';
  }
}

/** Throws SettingsError unless `path` is an absolute path to an existing directory. */
export function assertFolder(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new SettingsError(`Folder not found: ${path}`);
  let stats;
  try {
    stats = statSync(path);
  } catch {
    throw new SettingsError(`Folder not found: ${path}`);
  }
  if (!stats.isDirectory()) throw new SettingsError(`Not a folder: ${path}`);
}

/**
 * Validates whichever settings fields are present and returns just those
 * (callers merge them over the current settings). Throws SettingsError.
 */
export function validateSettings(input) {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new SettingsError('settings must be an object');
  const out = {};
  if ('model' in input) {
    if (input.model !== '' && !MODELS.includes(input.model) && !isLocalModel(input.model)) {
      throw new SettingsError(`Unknown model: ${input.model}`);
    }
    out.model = input.model;
  }
  if ('effort' in input) {
    if (!EFFORTS.includes(input.effort)) throw new SettingsError(`Unknown effort: ${input.effort}`);
    out.effort = input.effort;
  }
  if ('simplifiedEnglish' in input) {
    if (typeof input.simplifiedEnglish !== 'boolean') throw new SettingsError('simplifiedEnglish must be true or false');
    out.simplifiedEnglish = input.simplifiedEnglish;
  }
  if ('disabledConnectors' in input) {
    const list = input.disabledConnectors;
    if (!Array.isArray(list) || list.some((name) => typeof name !== 'string')) {
      throw new SettingsError('disabledConnectors must be an array of strings');
    }
    out.disabledConnectors = list;
  }
  if ('folder' in input) {
    assertFolder(input.folder);
    out.folder = input.folder;
  }
  return out;
}

function recentChatFolders() {
  const folders = [];
  for (const { id } of listChats()) {
    const folder = getChat(id)?.settings?.folder;
    if (folder && !folders.includes(folder)) folders.push(folder);
    if (folders.length >= RECENT_FOLDERS) break;
  }
  return folders;
}

function quickPicks() {
  const picks = [{ label: 'Home', path: homedir() }];
  const add = (label, path) => {
    if (!picks.some((pick) => pick.path === path)) picks.push({ label, path });
  };
  for (const { projectName, projectPath } of getProjects()) add(projectName, projectPath);
  for (const folder of recentChatFolders()) add(basename(folder) || folder, folder);
  return picks;
}

/** Sub-folders of `path` (dot-folders hidden), plus quick picks for jumping around. */
export function listFolders(path = homedir()) {
  assertFolder(path);
  const abs = resolve(path);
  const folders = readdirSync(abs, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .filter((entry) => {
      if (entry.isDirectory()) return true;
      if (!entry.isSymbolicLink()) return false;
      try {
        return statSync(join(abs, entry.name)).isDirectory();
      } catch {
        return false;
      }
    })
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const parent = dirname(abs);
  return { path: abs, parent: parent === abs ? null : parent, folders, quickPicks: quickPicks() };
}
