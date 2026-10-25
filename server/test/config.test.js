import { beforeEach, expect, test } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { getRoots, setRoots } from '../src/config.js';
import { createApp } from '../src/app.js';

beforeEach(() => {
  process.env.AGENT_PANEL_HOME = mkdtempSync(join(tmpdir(), 'acp-config-'));
});

test('getRoots returns [] when no config file exists', () => {
  expect(getRoots()).toEqual([]);
});

test('setRoots persists and getRoots reflects it', () => {
  setRoots(['/a', '/b']);
  expect(getRoots()).toEqual(['/a', '/b']);
});

test('getRoots returns [] for malformed JSON', () => {
  writeFileSync(join(process.env.AGENT_PANEL_HOME, 'config.json'), '{not json');
  expect(getRoots()).toEqual([]);
});

test('getRoots returns [] when roots is not a string array', () => {
  writeFileSync(join(process.env.AGENT_PANEL_HOME, 'config.json'), '{"roots":"x"}');
  expect(getRoots()).toEqual([]);
});

test('getRoots returns [] when the file is null', () => {
  writeFileSync(join(process.env.AGENT_PANEL_HOME, 'config.json'), 'null');
  expect(getRoots()).toEqual([]);
});

test('GET /api/config/roots returns 200 with [] for a malformed config file', async () => {
  writeFileSync(join(process.env.AGENT_PANEL_HOME, 'config.json'), '{not json');
  const res = await request(createApp({ hostCheck: false })).get('/api/config/roots');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ roots: [] });
});

test('setRoots leaves no temp file behind', () => {
  setRoots(['/t']);
  expect(existsSync(join(process.env.AGENT_PANEL_HOME, 'config.json.tmp'))).toBe(false);
  expect(getRoots()).toEqual(['/t']);
});

test('GET /api/config/roots returns current roots', async () => {
  setRoots(['/x']);
  const res = await request(createApp({ hostCheck: false })).get('/api/config/roots');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ roots: ['/x'] });
});

test('PUT /api/config/roots persists roots and echoes them', async () => {
  const res = await request(createApp({ hostCheck: false })).put('/api/config/roots').send({ roots: ['/p', '/q'] });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ roots: ['/p', '/q'] });
  expect(getRoots()).toEqual(['/p', '/q']);
});

test('PUT /api/config/roots rejects a non-array body', async () => {
  const res = await request(createApp({ hostCheck: false })).put('/api/config/roots').send({ roots: 'nope' });
  expect(res.status).toBe(400);
});
