import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Chat conversations, one JSON file per chat under `<home>/chats/`, plus
 * `last-settings.json` remembering the settings of the most recent chat so a
 * new chat starts where the last one left off.
 */

const ID_PATTERN = /^[0-9a-f-]{36}$/;
const LAST_SETTINGS_FILE = 'last-settings.json';
const TITLE_MAX = 60;

export const DEFAULT_SETTINGS = () => ({
  model: '',
  effort: 'high',
  simplifiedEnglish: false,
  disabledConnectors: [],
  folder: homedir(),
});

function chatsDir() {
  const home = process.env.AGENT_PANEL_HOME || join(homedir(), '.agent-control-panel');
  return join(home, 'chats');
}

function chatFile(id) {
  return join(chatsDir(), `${id}.json`);
}

// Write to a temp file and rename it into place so readers never see a partial file.
function writeAtomic(file, data) {
  mkdirSync(chatsDir(), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2));
  renameSync(`${file}.tmp`, file);
}

export function getChat(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
  const file = chatFile(id);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Saves a chat, bumping its `updatedAt`. */
export function saveChat(chat) {
  writeAtomic(chatFile(chat.id), { ...chat, updatedAt: new Date().toISOString() });
}

/** Removes a chat. Returns whether there was one to remove. */
export function deleteChat(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return false;
  const file = chatFile(id);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

/** Chat summaries (no transcript), newest first. */
export function listChats() {
  if (!existsSync(chatsDir())) return [];
  return readdirSync(chatsDir())
    .filter((name) => name.endsWith('.json'))
    .map((name) => getChat(name.slice(0, -'.json'.length)))
    .filter(Boolean)
    .map(({ id, title, updatedAt, running }) => ({ id, title, updatedAt, running }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getLastSettings() {
  try {
    return { ...DEFAULT_SETTINGS(), ...JSON.parse(readFileSync(join(chatsDir(), LAST_SETTINGS_FILE), 'utf8')) };
  } catch {
    return DEFAULT_SETTINGS();
  }
}

export function saveLastSettings(settings) {
  writeAtomic(join(chatsDir(), LAST_SETTINGS_FILE), settings);
}

/** Creates and saves a new empty chat; `settings` is merged over the last-used settings. */
export function createChat(settings = {}) {
  const now = new Date().toISOString();
  const chat = {
    id: randomUUID(),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    settings: { ...getLastSettings(), ...settings },
    sessionId: randomUUID(),
    sessionStarted: false,
    running: false,
    transcript: [],
    files: [],
  };
  saveChat(chat);
  return getChat(chat.id);
}

/** A chat title from the first message line, else the first attachment name. */
export function titleFrom(message, attachments = []) {
  const line = String(message ?? '').split('\n')[0].trim();
  if (line) return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
  return attachments[0]?.name || 'New chat';
}
