import { expect, test } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

test.each(['localhost:4317', '127.0.0.1:4317'])('a request with Host %s passes through', async (host) => {
  const res = await request(createApp()).get('/api/health').set('Host', host);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'ok' });
});

test.each([
  'evil.example.com',
  'evil.example.com:4317',
  'localhost',
  'localhost:9999',
  '192.168.1.20:4317',
  'localhost:4317.evil.com',
])('a request with Host %s is rejected with 403', async (host) => {
  const res = await request(createApp()).get('/api/health').set('Host', host);
  expect(res.status).toBe(403);
});

test('a non-local Host cannot reach the one-off run route', async () => {
  const res = await request(createApp())
    .post('/api/agents/x/run')
    .set('Host', 'rebind.attacker.test:4317')
    .send({ message: 'hello' });
  expect(res.status).toBe(403);
});

test('host checking is on by default (supertest\'s ephemeral-port Host is rejected)', async () => {
  const res = await request(createApp()).get('/api/health');
  expect(res.status).toBe(403);
});
