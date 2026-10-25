import { test, expect, vi, afterEach } from 'vitest';
import { sendChat, startTask, fetchTasks, fetchTask, markTaskSeen, fetchChat, createAgent, fetchCityStatus, fetchMayorChat, sendMayorChat, createPlayground } from './api.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(status, body) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      typeof body === 'string'
        ? new Response(body, { status })
        : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    )
  );
}

test('sendChat surfaces the server\'s JSON error text and keeps the status', async () => {
  stubFetch(409, { error: 'A standing-chat turn is already running for agent "x"' });
  const err = await sendChat('x', 'hi').catch((e) => e);
  expect(err.message).toBe('A standing-chat turn is already running for agent "x"');
  expect(err.status).toBe(409);
});

test('startTask surfaces the server\'s JSON error text', async () => {
  stubFetch(400, { error: 'message must be a non-empty string' });
  const err = await startTask('x', '').catch((e) => e);
  expect(err.message).toBe('message must be a non-empty string');
  expect(err.status).toBe(400);
});

test('falls back to a generic message when the error body is not JSON', async () => {
  stubFetch(500, 'Internal Server Error');
  const err = await startTask('x', 'go').catch((e) => e);
  expect(err.message).toBe('startTask failed: 500');
  expect(err.status).toBe(500);
});

test('createAgent surfaces the server\'s error text too', async () => {
  stubFetch(409, { error: 'an agent with slug "doc-writer" already exists' });
  const err = await createAgent('/a', { name: 'Doc Writer', description: 'd' }).catch((e) => e);
  expect(err.message).toMatch(/already exists/);
});

function lastCall() {
  return globalThis.fetch.mock.calls.at(-1);
}

test('fetchCityStatus GETs /api/city/status and returns the whole object', async () => {
  const status = { agents: { a: 'idle' }, mayor: 'working', links: [{ id: 'l', from: 'a', to: 'b', label: 'x' }] };
  stubFetch(200, status);
  expect(await fetchCityStatus()).toEqual(status);
  expect(lastCall()[0]).toBe('/api/city/status');
});

test('fetchCityStatus surfaces failures', async () => {
  stubFetch(500, 'boom');
  const err = await fetchCityStatus().catch((e) => e);
  expect(err.message).toBe('fetchCityStatus failed: 500');
});

test('fetchMayorChat GETs the transcript', async () => {
  stubFetch(200, { transcript: [{ role: 'user' }] });
  expect(await fetchMayorChat()).toEqual([{ role: 'user' }]);
  expect(lastCall()[0]).toBe('/api/mayor/chat');
});

test('sendMayorChat POSTs the message and returns the transcript', async () => {
  stubFetch(200, { transcript: [1] });
  expect(await sendMayorChat('hi')).toEqual([1]);
  const [url, opts] = lastCall();
  expect(url).toBe('/api/mayor/chat');
  expect(opts.method).toBe('POST');
  expect(JSON.parse(opts.body)).toEqual({ message: 'hi' });
});

test('sendMayorChat keeps status 409 and server error text when busy', async () => {
  stubFetch(409, { error: 'Mayor is busy' });
  const err = await sendMayorChat('hi').catch((e) => e);
  expect(err.status).toBe(409);
  expect(err.message).toBe('Mayor is busy');
});

test('createPlayground POSTs the name and returns the unwrapped playground', async () => {
  const playground = { projectPath: '/p', projectName: 'p', agents: [] };
  stubFetch(201, { playground });
  expect(await createPlayground('p')).toEqual(playground);
  const [url, opts] = lastCall();
  expect(url).toBe('/api/playgrounds');
  expect(opts.method).toBe('POST');
  expect(JSON.parse(opts.body)).toEqual({ name: 'p' });
});

test('createPlayground surfaces server error text', async () => {
  stubFetch(409, { error: 'already exists' });
  const err = await createPlayground('p').catch((e) => e);
  expect(err.message).toBe('already exists');
  expect(err.status).toBe(409);
});

test('sendChat sends only the upload fields of attachments, and omits them when empty', async () => {
  stubFetch(200, { transcript: [] });
  await sendChat('x', 'look', [{ name: 'a.png', mediaType: 'image/png', data: 'QQ==', previewUrl: 'data:...', size: 1 }]);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    message: 'look',
    attachments: [{ name: 'a.png', mediaType: 'image/png', data: 'QQ==' }],
  });
  await sendChat('x', 'plain', []);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ message: 'plain' });
});

test('startTask POSTs to the agent\'s tasks and returns the task', async () => {
  stubFetch(201, { task: { id: 't1', status: 'running' } });
  expect(await startTask('/p::a', 'go')).toEqual({ id: 't1', status: 'running' });
  expect(fetch.mock.calls[0][0]).toBe('/api/agents/%2Fp%3A%3Aa/tasks');
});

test('fetchTasks, fetchTask and markTaskSeen hit the task routes', async () => {
  stubFetch(200, { tasks: [{ id: 't1' }], task: { id: 't1' } });
  expect(await fetchTasks('/p::a')).toEqual([{ id: 't1' }]);
  expect(await fetchTask('t1')).toEqual({ id: 't1' });
  await markTaskSeen('t1');
  expect(fetch.mock.calls.map((c) => c[0])).toEqual(['/api/agents/%2Fp%3A%3Aa/tasks', '/api/tasks/t1', '/api/tasks/t1/seen']);
  expect(fetch.mock.calls[2][1].method).toBe('POST');
});

test('fetchChat returns the transcript and any pending turn', async () => {
  stubFetch(200, { transcript: [1], pending: { text: 'hi' } });
  expect(await fetchChat('x')).toEqual({ transcript: [1], pending: { text: 'hi' } });
});
