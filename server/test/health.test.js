import { expect, test } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

test('GET /api/health returns ok', async () => {
  const res = await request(createApp()).get('/api/health').set('Host', 'localhost:4317');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'ok' });
});
