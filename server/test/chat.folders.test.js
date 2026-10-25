import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../src/projectsCache.js', () => ({
  getProjects: vi.fn(() => [{ projectPath: '/play/one', projectName: 'one', agents: [] }]),
}));

const { listFolders, validateSettings, SettingsError } = await import('../src/chat/folders.js');
const { createChat } = await import('../src/chat/chatStore.js');

let dir;
let home;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'folders-'));
  home = mkdtempSync(join(tmpdir(), 'chat-home-'));
  process.env.AGENT_PANEL_HOME = home;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  delete process.env.AGENT_PANEL_HOME;
});

test('lists only sorted directories and hides dot-folders', () => {
  mkdirSync(join(dir, 'b'));
  mkdirSync(join(dir, 'a'));
  mkdirSync(join(dir, '.hidden'));
  writeFileSync(join(dir, 'file.txt'), 'x');
  const result = listFolders(dir);
  expect(result.folders).toEqual(['a', 'b']);
  expect(result.path).toBe(dir);
  expect(result.parent).toBe(join(dir, '..').replace(/\/$/, '') || '/');
});

test('the parent of / is null', () => {
  expect(listFolders('/').parent).toBeNull();
});

test('a missing path throws Folder not found', () => {
  expect(() => listFolders(join(dir, 'nope'))).toThrow(/Folder not found/);
});

test('quick picks: Home, playgrounds, then recent chat folders without duplicates', () => {
  createChat({ folder: dir });
  createChat({ folder: homedir() });
  const picks = listFolders(dir).quickPicks;
  expect(picks[0]).toEqual({ label: 'Home', path: homedir() });
  expect(picks[1]).toEqual({ label: 'one', path: '/play/one' });
  expect(picks.filter((p) => p.path === homedir())).toHaveLength(1);
  expect(picks.some((p) => p.path === dir)).toBe(true);
});

test('validateSettings rejects bad values and a file as folder', () => {
  writeFileSync(join(dir, 'f'), 'x');
  expect(() => validateSettings({ model: 'gpt' })).toThrow(SettingsError);
  expect(() => validateSettings({ effort: 'extreme' })).toThrow(SettingsError);
  expect(() => validateSettings({ disabledConnectors: 'x' })).toThrow(SettingsError);
  expect(() => validateSettings({ simplifiedEnglish: 'yes' })).toThrow(SettingsError);
  expect(validateSettings({ simplifiedEnglish: true })).toEqual({ simplifiedEnglish: true });
  expect(() => validateSettings({ folder: 'relative' })).toThrow(/Folder not found/);
  expect(() => validateSettings({ folder: join(dir, 'f') })).toThrow(/Not a folder/);
  expect(validateSettings({ model: '', effort: 'max', folder: dir })).toEqual({ model: '', effort: 'max', folder: dir });
});
