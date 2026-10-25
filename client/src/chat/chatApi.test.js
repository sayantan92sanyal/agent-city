import { test, expect, vi, afterEach } from 'vitest';
import { sendChatMessage, getChat, listChats, chatFileUrl, deleteChat } from './chatApi.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(status, body) {
  const fetchMock = vi.fn(async () =>
    body === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

test('sendChatMessage POSTs { message, attachments } to /api/chats/<id>/messages', async () => {
  const fetchMock = stubFetch(202, { chat: { id: 'c1' } });
  const attachments = [{ name: 'a.png', mediaType: 'image/png', data: 'AAA', previewUrl: 'data:x', size: 3 }];
  const chat = await sendChatMessage('c1', 'hi', attachments);
  expect(chat).toEqual({ id: 'c1' });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('/api/chats/c1/messages');
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual({
    message: 'hi',
    attachments: [{ name: 'a.png', mediaType: 'image/png', data: 'AAA' }],
  });
});

test('sendChatMessage sends an empty attachments list when there are none', async () => {
  const fetchMock = stubFetch(202, { chat: { id: 'c1' } });
  await sendChatMessage('c1', 'hi');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ message: 'hi', attachments: [] });
});

test('errors carry the server text and status', async () => {
  stubFetch(409, { error: 'Claude is still replying in this chat.' });
  const err = await sendChatMessage('c1', 'hi', []).catch((e) => e);
  expect(err.message).toBe('Claude is still replying in this chat.');
  expect(err.status).toBe(409);
});

test('errors without a JSON body fall back to a generic message', async () => {
  stubFetch(500);
  const err = await getChat('c1').catch((e) => e);
  expect(err.message).toBe('getChat failed: 500');
  expect(err.status).toBe(500);
});

test('listChats returns the chats array and getChat returns { chat, live }', async () => {
  stubFetch(200, { chats: [{ id: 'a' }] });
  expect(await listChats()).toEqual([{ id: 'a' }]);
  stubFetch(200, { chat: { id: 'a' }, live: null });
  expect(await getChat('a')).toEqual({ chat: { id: 'a' }, live: null });
});

test('deleteChat accepts a 204', async () => {
  const fetchMock = stubFetch(204);
  await expect(deleteChat('a')).resolves.toBeUndefined();
  expect(fetchMock.mock.calls[0][0]).toBe('/api/chats/a');
  expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
});

test('chatFileUrl encodes the id and path', () => {
  expect(chatFileUrl('a b', '/x/y z.png')).toBe('/api/chats/a%20b/file?path=%2Fx%2Fy%20z.png');
});
