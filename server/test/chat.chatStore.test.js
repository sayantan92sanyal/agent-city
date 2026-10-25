import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  createChat,
  deleteChat,
  getChat,
  getLastSettings,
  listChats,
  saveChat,
  saveLastSettings,
  titleFrom,
} from '../src/chat/chatStore.js';

let home;
let previous;

beforeEach(() => {
  previous = process.env.AGENT_PANEL_HOME;
  home = mkdtempSync(join(tmpdir(), 'chat-store-'));
  process.env.AGENT_PANEL_HOME = home;
});

afterEach(() => {
  if (previous === undefined) delete process.env.AGENT_PANEL_HOME;
  else process.env.AGENT_PANEL_HOME = previous;
  rmSync(home, { recursive: true, force: true });
});

describe('chatStore', () => {
  it('defaults the first chat settings', () => {
    expect(DEFAULT_SETTINGS()).toEqual({ model: '', effort: 'high', simplifiedEnglish: false, disabledConnectors: [], folder: homedir() });
    const chat = createChat();
    expect(chat.settings).toEqual(DEFAULT_SETTINGS());
    expect(chat).toMatchObject({ title: 'New chat', sessionStarted: false, running: false, transcript: [], files: [] });
    expect(chat.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(chat.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(chat.sessionId).not.toBe(chat.id);
  });

  it('createChat merges over last-used settings and persists the chat', () => {
    saveLastSettings({ ...DEFAULT_SETTINGS(), model: 'opus', folder: '/tmp/x' });
    expect(getLastSettings().model).toBe('opus');
    const chat = createChat({ effort: 'max' });
    expect(chat.settings).toEqual({ model: 'opus', effort: 'max', simplifiedEnglish: false, disabledConnectors: [], folder: '/tmp/x' });
    expect(getChat(chat.id).id).toBe(chat.id);
  });

  it('round-trips saved chats and bumps updatedAt', () => {
    const chat = createChat();
    saveChat({ ...chat, title: 'Hello', updatedAt: '2000-01-01T00:00:00.000Z' });
    const loaded = getChat(chat.id);
    expect(loaded.title).toBe('Hello');
    expect(loaded.updatedAt > '2000-01-01T00:00:00.000Z').toBe(true);
  });

  it('lists summaries newest first, excluding last-settings', async () => {
    const a = createChat();
    const b = createChat();
    saveLastSettings(DEFAULT_SETTINGS());
    saveChat({ ...a, title: 'A' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    saveChat({ ...b, title: 'B', running: true });
    const list = listChats();
    expect(list.map((c) => c.id)).toEqual([b.id, a.id]);
    for (const entry of list) expect(Object.keys(entry).sort()).toEqual(['id', 'running', 'title', 'updatedAt']);
    expect(list[0]).toMatchObject({ title: 'B', running: true });
  });

  it('deletes chats', () => {
    const chat = createChat();
    expect(deleteChat(chat.id)).toBe(true);
    expect(getChat(chat.id)).toBeNull();
    expect(deleteChat(chat.id)).toBe(false);
    expect(deleteChat('../x')).toBe(false);
  });

  it('rejects non-uuid ids', () => {
    expect(getChat('../x')).toBeNull();
    expect(getChat(undefined)).toBeNull();
  });

  it('derives titles', () => {
    expect(titleFrom('What is EBITDA, simply?\nmore', [])).toBe('What is EBITDA, simply?');
    const t = titleFrom('x'.repeat(100), []);
    expect(t).toHaveLength(60);
    expect(t.endsWith('…')).toBe(true);
    expect(titleFrom('', [{ name: 'q.png' }])).toBe('q.png');
    expect(titleFrom('  ', [])).toBe('New chat');
  });
});
