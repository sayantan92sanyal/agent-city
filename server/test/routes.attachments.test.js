import { beforeEach, expect, test } from 'vitest';
import request from 'supertest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveAttachments } from '../src/attachments.js';
import { createApp } from '../src/app.js';

const b64 = (text) => Buffer.from(text).toString('base64');

beforeEach(() => {
  process.env.AGENT_PANEL_HOME = mkdtempSync(join(tmpdir(), 'acp-att-route-'));
});

test('images are shown inline; every attachment is sniff-proof and sandboxed', async () => {
  const [png] = saveAttachments([{ name: 'shot.png', mediaType: 'image/png', data: b64('PNG') }]);
  const res = await request(createApp({ hostCheck: false })).get(`/api/attachments/${png.id}`);
  expect(res.status).toBe(200);
  expect(res.headers['content-disposition']).toBeUndefined();
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['content-security-policy']).toBe('sandbox');
});

test('other files (which could be web pages or SVGs) download instead of opening', async () => {
  const [svg] = saveAttachments([{ name: 'logo.svg', mediaType: 'image/svg+xml', data: b64('<svg onload="alert(1)"/>') }]);
  const res = await request(createApp({ hostCheck: false })).get(`/api/attachments/${svg.id}`);
  expect(res.status).toBe(200);
  expect(res.headers['content-disposition']).toMatch(/^attachment/);
  expect(res.headers['content-security-policy']).toBe('sandbox');
});
