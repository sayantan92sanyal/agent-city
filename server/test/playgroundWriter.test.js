import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getRoots, setRoots } from '../src/config.js';
import { createPlayground, PlaygroundExistsError, slugifyPlayground } from '../src/playgroundWriter.js';

let home;
let dir;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pg-home-'));
  dir = mkdtempSync(join(tmpdir(), 'pg-dir-'));
  process.env.AGENT_PANEL_HOME = home;
  process.env.AGENT_PANEL_PLAYGROUNDS_DIR = dir;
});
afterEach(() => {
  delete process.env.AGENT_PANEL_HOME;
  delete process.env.AGENT_PANEL_PLAYGROUNDS_DIR;
  rmSync(home, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

describe('slugifyPlayground', () => {
  test('slugs', () => {
    expect(slugifyPlayground('  My Cool/Project!! ')).toBe('my-cool-project');
    expect(slugifyPlayground('a'.repeat(80))).toHaveLength(60);
    expect(() => slugifyPlayground('!!!')).toThrow();
  });
});

describe('createPlayground', () => {
  test('creates tree and adds root', () => {
    const r = createPlayground('My Game');
    expect(r.projectName).toBe('my-game');
    expect(r.projectPath).toBe(join(resolve(dir), 'my-game'));
    expect(existsSync(join(r.projectPath, '.claude', 'agents'))).toBe(true);
    expect(getRoots()).toEqual([resolve(dir)]);
  });
  test('existing folder throws and creates nothing', () => {
    mkdirSync(join(dir, 'x'));
    expect(() => createPlayground('x')).toThrow(PlaygroundExistsError);
    expect(existsSync(join(dir, 'x', '.claude'))).toBe(false);
    expect(getRoots()).toEqual([]);
  });
  test('root not added when dir is a root', () => {
    setRoots([resolve(dir)]);
    createPlayground('a');
    expect(getRoots()).toEqual([resolve(dir)]);
  });
  test('root not added when parent is a root (trailing sep ok)', () => {
    const parent = resolve(dir, '..') + '/';
    setRoots([parent]);
    createPlayground('a');
    expect(getRoots()).toEqual([parent]);
  });
  test('sibling-prefix root does not cover', () => {
    const sibling = resolve(dir) + 'x';
    setRoots([sibling]);
    createPlayground('a');
    expect(getRoots()).toEqual([sibling, resolve(dir)]);
  });
});

describe('POST /api/playgrounds', () => {
  const post = (body) => request(createApp({ hostCheck: false })).post('/api/playgrounds').send(body);
  test('201', async () => {
    const res = await post({ name: 'Hello' });
    expect(res.status).toBe(201);
    expect(res.body.playground).toEqual({
      projectPath: join(resolve(dir), 'hello'),
      projectName: 'hello',
      agents: [],
    });
  });
  test('409 on existing', async () => {
    await post({ name: 'Hello' });
    const res = await post({ name: 'hello' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('hello');
  });
  test('400 blank', async () => {
    expect((await post({ name: '   ' })).status).toBe(400);
    expect((await post({ name: '!!!' })).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });
});
