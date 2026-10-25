import { afterEach, beforeEach, expect, test } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { setRoots } from '../src/config.js';
import { clearProjectsCache } from '../src/projectsCache.js';

let home;
let root;
let trash;
let project;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'del-home-'));
  root = mkdtempSync(join(tmpdir(), 'del-root-'));
  trash = mkdtempSync(join(tmpdir(), 'del-trash-'));
  process.env.AGENT_PANEL_HOME = home;
  process.env.AGENT_PANEL_TRASH_DIR = trash;
  setRoots([root]);
  project = join(root, 'article-authoring');
  mkdirSync(join(project, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(project, 'draft.docx'), 'my article');
  writeFileSync(join(project, '.claude', 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: Reviews\n---\nBody\n');
  clearProjectsCache();
});

afterEach(() => {
  delete process.env.AGENT_PANEL_HOME;
  delete process.env.AGENT_PANEL_TRASH_DIR;
  for (const dir of [home, root, trash]) rmSync(dir, { recursive: true, force: true });
});

test('DELETE /api/agents/:id moves the agent file to the Trash', async () => {
  const app = createApp({ hostCheck: false });
  const res = await request(app).delete(`/api/agents/${encodeURIComponent(`${project}::reviewer`)}`);
  expect(res.status).toBe(200);
  expect(existsSync(join(project, '.claude', 'agents', 'reviewer.md'))).toBe(false);
  expect(existsSync(join(trash, 'reviewer.md'))).toBe(true);
  expect((await request(app).delete(`/api/agents/${encodeURIComponent(`${project}::reviewer`)}`)).status).toBe(404);
});

test('DELETE /api/playgrounds moves the whole folder to the Trash', async () => {
  const app = createApp({ hostCheck: false });
  const res = await request(app).delete('/api/playgrounds').send({ projectPath: project });
  expect(res.status).toBe(200);
  expect(existsSync(project)).toBe(false);
  expect(existsSync(join(trash, 'article-authoring', 'draft.docx'))).toBe(true);
  const list = await request(app).get('/api/agents');
  expect(list.body.projects).toEqual([]);
});

test('DELETE /api/playgrounds refuses unknown folders and a watched root itself', async () => {
  const app = createApp({ hostCheck: false });
  expect((await request(app).delete('/api/playgrounds').send({ projectPath: join(root, 'nope') })).status).toBe(400);
  expect((await request(app).delete('/api/playgrounds').send({})).status).toBe(400);
  mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
  clearProjectsCache();
  const res = await request(app).delete('/api/playgrounds').send({ projectPath: root });
  expect(res.status).toBe(400);
  expect(existsSync(root)).toBe(true);
});
