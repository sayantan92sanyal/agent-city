import { beforeEach, expect, test } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moveToTrash } from '../src/trash.js';

let trash;
let work;

beforeEach(() => {
  trash = mkdtempSync(join(tmpdir(), 'acp-trash-'));
  work = mkdtempSync(join(tmpdir(), 'acp-work-'));
  process.env.AGENT_PANEL_TRASH_DIR = trash;
});

test('moves a file or a whole folder into the Trash, keeping its name', () => {
  const file = join(work, 'reviewer.md');
  writeFileSync(file, 'x');
  const folder = join(work, 'article-authoring');
  mkdirSync(join(folder, '.claude', 'agents'), { recursive: true });

  expect(moveToTrash(file)).toBe(join(trash, 'reviewer.md'));
  expect(moveToTrash(folder)).toBe(join(trash, 'article-authoring'));
  expect(existsSync(file)).toBe(false);
  expect(existsSync(join(trash, 'article-authoring', '.claude', 'agents'))).toBe(true);
});

test('never overwrites something already in the Trash', () => {
  writeFileSync(join(trash, 'reviewer.md'), 'older');
  const file = join(work, 'reviewer.md');
  writeFileSync(file, 'newer');
  const moved = moveToTrash(file);
  expect(moved).not.toBe(join(trash, 'reviewer.md'));
  expect(readdirSync(trash).sort()).toHaveLength(2);
});
