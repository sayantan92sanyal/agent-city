import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import request from 'supertest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../src/projectsCache.js', () => ({ getProjects: vi.fn(() => []) }));

vi.mock('../src/chat/chatRunner.js', async () => {
  const store = await import('../src/chat/chatStore.js');
  class ChatBusyError extends Error {}
  return {
    ChatBusyError,
    sendMessage: vi.fn(),
    getLiveTurn: vi.fn(() => null),
    stopChat: vi.fn(() => false),
    loadChatForView: vi.fn((id) => store.getChat(id)),
  };
});

const runner = await import('../src/chat/chatRunner.js');
const { createChat, getChat, saveChat } = await import('../src/chat/chatStore.js');
const { createApp } = await import('../src/app.js');

const app = createApp({ hostCheck: false, clientDist: null });
let home;
let dir;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'chat-home-'));
  dir = mkdtempSync(join(tmpdir(), 'chat-dir-'));
  process.env.AGENT_PANEL_HOME = home;
  // Never the real LocalModelChat on this machine.
  process.env.AGENT_CITY_LOCAL_MODELS_DIR = join(tmpdir(), 'acp-no-local-models');
  vi.clearAllMocks();
  runner.getLiveTurn.mockReturnValue(null);
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
  delete process.env.AGENT_PANEL_HOME;
});

test('create returns 201 with default settings', async () => {
  const res = await request(app).post('/api/chats').send({});
  expect(res.status).toBe(201);
  expect(res.body.chat.settings).toMatchObject({ model: '', effort: 'high', disabledConnectors: [] });
  const list = await request(app).get('/api/chats');
  expect(list.body.chats).toHaveLength(1);
});

test('create with a missing folder is a 400', async () => {
  const res = await request(app).post('/api/chats').send({ settings: { folder: join(dir, 'nope') } });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/^Folder not found/);
});

test('GET unknown chat is 404', async () => {
  const res = await request(app).get('/api/chats/00000000-0000-0000-0000-000000000000');
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: 'Chat not found' });
});

test('GET returns chat and live turn', async () => {
  const chat = createChat();
  const res = await request(app).get(`/api/chats/${chat.id}`);
  expect(res.status).toBe(200);
  expect(res.body.chat.id).toBe(chat.id);
  expect(res.body.live).toBeNull();
});

test('PATCH updates settings and title; folder change after first message is 409', async () => {
  const chat = createChat();
  const ok = await request(app).patch(`/api/chats/${chat.id}`).send({ settings: { effort: 'max' }, title: 'Hi' });
  expect(ok.status).toBe(200);
  expect(ok.body.chat.settings.effort).toBe('max');
  expect(ok.body.chat.title).toBe('Hi');

  saveChat({ ...getChat(chat.id), sessionStarted: true });
  const same = await request(app).patch(`/api/chats/${chat.id}`).send({ settings: { folder: chat.settings.folder } });
  expect(same.status).toBe(200);
  const changed = await request(app).patch(`/api/chats/${chat.id}`).send({ settings: { folder: dir } });
  expect(changed.status).toBe(409);
  expect(changed.body.error).toBe("The folder can't change after the first message.");
});

test('folder locks while running or once the transcript has entries', async () => {
  const running = createChat();
  saveChat({ ...getChat(running.id), running: true });
  const r1 = await request(app).patch(`/api/chats/${running.id}`).send({ settings: { folder: dir } });
  expect(r1.status).toBe(409);

  const talked = createChat();
  saveChat({ ...getChat(talked.id), transcript: [{ type: 'user_message', text: 'Hi' }] });
  const r2 = await request(app).patch(`/api/chats/${talked.id}`).send({ settings: { folder: dir } });
  expect(r2.status).toBe(409);

  const fresh = createChat();
  const r3 = await request(app).patch(`/api/chats/${fresh.id}`).send({ settings: { folder: dir } });
  expect(r3.status).toBe(200);
  expect(r3.body.chat.settings.folder).toBe(dir);
});

test('DELETE removes an idle chat, 409 while live', async () => {
  const chat = createChat();
  runner.getLiveTurn.mockReturnValue({ events: [] });
  expect((await request(app).delete(`/api/chats/${chat.id}`)).status).toBe(409);
  runner.getLiveTurn.mockReturnValue(null);
  expect((await request(app).delete(`/api/chats/${chat.id}`)).status).toBe(204);
  expect(getChat(chat.id)).toBeNull();
});

test('POST messages calls sendMessage and returns 202', async () => {
  const chat = createChat();
  runner.sendMessage.mockReturnValue({ chat, finished: Promise.resolve() });
  const res = await request(app).post(`/api/chats/${chat.id}/messages`).send({ message: 'hello' });
  expect(res.status).toBe(202);
  expect(res.body.chat.id).toBe(chat.id);
  expect(runner.sendMessage).toHaveBeenCalledWith(chat.id, { message: 'hello', attachments: [] });
});

test('POST messages: busy is 409, blank is 400, unknown chat is 404 without sending', async () => {
  const chat = createChat();
  runner.sendMessage.mockImplementation(() => {
    throw new runner.ChatBusyError('busy');
  });
  const busy = await request(app).post(`/api/chats/${chat.id}/messages`).send({ message: 'hi' });
  expect(busy.status).toBe(409);
  expect(busy.body).toEqual({ error: 'Claude is still replying in this chat.' });

  const blank = await request(app).post(`/api/chats/${chat.id}/messages`).send({ message: '  ' });
  expect(blank.status).toBe(400);

  runner.sendMessage.mockClear();
  const missing = await request(app)
    .post('/api/chats/00000000-0000-0000-0000-000000000000/messages')
    .send({ message: 'hi' });
  expect(missing.status).toBe(404);
  expect(runner.sendMessage).not.toHaveBeenCalled();
});

test('stop reports whether a turn was stopped', async () => {
  const chat = createChat();
  runner.stopChat.mockReturnValue(true);
  const res = await request(app).post(`/api/chats/${chat.id}/stop`);
  expect(res.body).toEqual({ stopped: true });
});

test('file route serves recorded allowed files only', async () => {
  const png = join(dir, 'a.png');
  const txt = join(dir, 'note.txt');
  writeFileSync(png, 'png-bytes');
  writeFileSync(txt, 'text');
  const chat = createChat();
  saveChat({ ...getChat(chat.id), files: [png, txt] });
  const url = `/api/chats/${chat.id}/file`;

  const ok = await request(app).get(url).query({ path: png });
  expect(ok.status).toBe(200);
  expect(ok.headers['content-type']).toMatch(/image\/png/);

  expect((await request(app).get(url).query({ path: join(dir, 'other.png') })).status).toBe(404);
  expect((await request(app).get(url).query({ path: txt })).status).toBe(404);
  expect((await request(app).get(url).query({ path: `${dir}/x/../a.png` })).status).toBe(200);
  expect((await request(app).get(url).query({ path: `${dir}/../../etc/passwd` })).status).toBe(404);
  expect((await request(app).get(url)).status).toBe(404);
});

test('file route sandboxes served HTML', async () => {
  const html = join(dir, 'page.html');
  writeFileSync(html, '<script>1</script>');
  const chat = createChat();
  saveChat({ ...getChat(chat.id), files: [html] });
  const res = await request(app).get(`/api/chats/${chat.id}/file`).query({ path: html });
  expect(res.status).toBe(200);
  expect(res.headers['content-security-policy']).toBe('sandbox allow-scripts');
  expect(res.headers['x-content-type-options']).toBe('nosniff');
});

test('settings route adds the local models when LocalModelChat is set up', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-lmc-'));
  writeFileSync(join(dir, 'server.py'), '');
  mkdirSync(join(dir, '.venv', 'bin'), { recursive: true });
  writeFileSync(join(dir, '.venv', 'bin', 'python'), '');
  process.env.AGENT_CITY_LOCAL_MODELS_DIR = dir;
  const res = await request(app).get('/api/chat/settings');
  expect(res.body.models.slice(-2)).toEqual([
    { value: 'local:llama', label: 'Llama 3.2 3B · local', local: true },
    { value: 'local:qwen-vl', label: 'Qwen2.5-VL 7B · local', local: true },
  ]);
  process.env.AGENT_CITY_LOCAL_MODELS_DIR = join(tmpdir(), 'acp-no-local-models');
});

test('settings route lists models and efforts', async () => {
  const res = await request(app).get('/api/chat/settings');
  expect(res.body.models.map((m) => m.value)).toEqual(['', 'fable', 'opus', 'sonnet', 'haiku']);
  expect(res.body.models[0].label).toBe('Default');
  expect(res.body.models[1].label).toBe('Fable');
  expect(res.body.efforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  expect(res.body.settings.effort).toBe('high');
});

test('folders route lists a directory and 400s on a missing one', async () => {
  const ok = await request(app).get('/api/chat/folders').query({ path: dir });
  expect(ok.status).toBe(200);
  expect(ok.body.path).toBe(dir);
  const bad = await request(app).get('/api/chat/folders').query({ path: join(dir, 'nope') });
  expect(bad.status).toBe(400);
  expect(bad.body.error).toMatch(/Folder not found/);
});

test('host check still applies', async () => {
  const res = await request(createApp({ clientDist: null })).get('/api/chats').set('Host', 'evil.example');
  expect(res.status).toBe(403);
});
