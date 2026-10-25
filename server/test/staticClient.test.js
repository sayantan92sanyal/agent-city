import { expect, test } from 'vitest';
import request from 'supertest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';

function fakeDist() {
  const dir = mkdtempSync(join(tmpdir(), 'acp-dist-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Agent City</title>');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
  return dir;
}

test('serves the built client: index, assets, and the SPA fallback', async () => {
  const app = createApp({ hostCheck: false, clientDist: fakeDist() });
  const index = await request(app).get('/');
  expect(index.status).toBe(200);
  expect(index.text).toContain('Agent City');
  expect((await request(app).get('/assets/app.js')).text).toBe('console.log(1)');
  expect((await request(app).get('/some/page')).text).toContain('Agent City');
});

test('API routes still answer, and unknown API paths are not swallowed by the fallback', async () => {
  const app = createApp({ hostCheck: false, clientDist: fakeDist() });
  expect((await request(app).get('/api/health')).body).toEqual({ status: 'ok' });
  const missing = await request(app).get('/api/nope');
  expect(missing.status).toBe(404);
  expect(missing.text).not.toContain('Agent City');
});

test('without a build, nothing extra is served', async () => {
  const app = createApp({ hostCheck: false, clientDist: join(tmpdir(), 'acp-no-such-dist') });
  expect((await request(app).get('/')).status).toBe(404);
});

test('the Host check also guards the served page', async () => {
  const app = createApp({ clientDist: fakeDist() });
  const res = await request(app).get('/').set('Host', 'evil.example:4317');
  expect(res.status).toBe(403);
});

test('reports a version that changes when the client is rebuilt', async () => {
  const dist = fakeDist();
  const app = createApp({ hostCheck: false, clientDist: dist });
  const first = await request(app).get('/api/version');
  expect(first.status).toBe(200);
  expect(first.headers['cache-control']).toBe('no-store');
  expect(first.body.version).toMatch(/^[0-9a-f]{12}$/);
  expect((await request(app).get('/api/version')).body.version).toBe(first.body.version);
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Agent City</title><script src="/assets/new.js"></script>');
  expect((await request(app).get('/api/version')).body.version).not.toBe(first.body.version);
});

test('without a build the version is null', async () => {
  const app = createApp({ hostCheck: false, clientDist: join(tmpdir(), 'acp-no-such-dist') });
  expect((await request(app).get('/api/version')).body).toEqual({ version: null });
});
