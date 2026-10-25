import { beforeEach, expect, test, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveAttachments } from '../src/attachments.js';
import {
  LOCAL_MODELS,
  buildLocalMessages,
  ensureLocalServer,
  isLocalModel,
  localModelsAvailable,
  parseSse,
} from '../src/chat/localModels.js';

const b64 = (text) => Buffer.from(text).toString('base64');

beforeEach(() => {
  process.env.AGENT_PANEL_HOME = mkdtempSync(join(tmpdir(), 'acp-local-'));
  process.env.AGENT_CITY_LOCAL_MODELS_DIR = mkdtempSync(join(tmpdir(), 'acp-lmc-'));
});

test('the two local models and how they are recognised', () => {
  expect(LOCAL_MODELS.map((m) => [m.value, m.label])).toEqual([
    ['local:llama', 'Llama 3.2 3B · local'],
    ['local:qwen-vl', 'Qwen2.5-VL 7B · local'],
  ]);
  expect(isLocalModel('local:qwen-vl')).toBe(true);
  expect(isLocalModel('sonnet')).toBe(false);
});

test('local models are available only with the LocalModelChat project and its Python', () => {
  const dir = process.env.AGENT_CITY_LOCAL_MODELS_DIR;
  expect(localModelsAvailable()).toBe(false);
  writeFileSync(join(dir, 'server.py'), '');
  mkdirSync(join(dir, '.venv', 'bin'), { recursive: true });
  writeFileSync(join(dir, '.venv', 'bin', 'python'), '');
  expect(localModelsAvailable()).toBe(true);
});

test('buildLocalMessages replays the conversation, with a local system prompt', async () => {
  const transcript = [
    { type: 'user_message', text: 'What is EBITDA?' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Earnings before…' }] } },
    { type: 'result', subtype: 'success', result: 'Earnings before interest…' },
    { type: 'user_message', text: 'Shorter?' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Profit before costs.' }] } },
    { type: 'stopped' },
  ];
  const messages = await buildLocalMessages(transcript, { message: 'Thanks. Example?', attachments: [] }, { vision: false });
  expect(messages[0].role).toBe('system');
  expect(messages[0].content).toContain('no internet');
  expect(messages.slice(1)).toEqual([
    { role: 'user', content: 'What is EBITDA?' },
    { role: 'assistant', content: 'Earnings before interest…' },
    { role: 'user', content: 'Shorter?' },
    { role: 'assistant', content: 'Profit before costs.' },
    { role: 'user', content: 'Thanks. Example?' },
  ]);
});

test('STE rules and attached documents go into the system prompt; the latest image goes to a vision model', async () => {
  const [notes, shot] = saveAttachments([
    { name: 'notes.md', mediaType: 'text/markdown', data: b64('# Plan\nGrow 20%') },
    { name: 'chart.png', mediaType: 'image/png', data: b64('PNG') },
  ]);
  const extractPdf = vi.fn();
  const messages = await buildLocalMessages([], { message: 'Explain', attachments: [notes, shot] }, { vision: true, simplifiedEnglish: true, extractPdf });
  expect(messages[0].content).toContain('ASD-STE100');
  expect(messages[0].content).toContain('--- notes.md ---\n# Plan\nGrow 20%');
  expect(messages[1]).toEqual({ role: 'user', content: 'Explain', image: `data:image/png;base64,${b64('PNG')}` });

  const textOnly = await buildLocalMessages([], { message: 'Explain', attachments: [shot] }, { vision: false });
  expect(textOnly[1].image).toBeUndefined();
  expect(textOnly[1].content).toContain('cannot see images');
});

test('PDFs are turned into text through the local server', async () => {
  const [pdf] = saveAttachments([{ name: 'report.pdf', mediaType: 'application/pdf', data: b64('%PDF') }]);
  const extractPdf = vi.fn(async () => 'Revenue rose 12%.');
  const messages = await buildLocalMessages([], { message: 'Summarise', attachments: [pdf] }, { vision: false, extractPdf });
  expect(extractPdf).toHaveBeenCalledWith('report.pdf', `data:application/pdf;base64,${b64('%PDF')}`);
  expect(messages[0].content).toContain('--- report.pdf ---\nRevenue rose 12%.');
});

test('parseSse yields each data event and keeps partial lines for later', () => {
  const events = [];
  let rest = parseSse('data: {"token":"Hel"}\n\n: keep-alive\n\ndata: {"tok', (e) => events.push(e));
  rest = parseSse(`${rest}en":"lo"}\n\n`, (e) => events.push(e));
  expect(events).toEqual([{ token: 'Hel' }, { token: 'lo' }]);
  expect(rest).toBe('');
});

test('ensureLocalServer starts LocalModelChat only when it is not already running', async () => {
  const dir = process.env.AGENT_CITY_LOCAL_MODELS_DIR;
  writeFileSync(join(dir, 'server.py'), '');
  mkdirSync(join(dir, '.venv', 'bin'), { recursive: true });
  writeFileSync(join(dir, '.venv', 'bin', 'python'), '');
  const up = { ok: true, json: async () => [{ id: 'llama' }, { id: 'qwen-vl' }] };
  const spawnFn = vi.fn(() => ({ unref() {} }));

  await ensureLocalServer({ fetchFn: vi.fn(async () => up), spawnFn });
  expect(spawnFn).not.toHaveBeenCalled();

  let calls = 0;
  const fetchFn = vi.fn(async () => {
    calls += 1;
    if (calls < 3) throw new Error('ECONNREFUSED');
    return up;
  });
  await ensureLocalServer({ fetchFn, spawnFn, pollMs: 1 });
  expect(spawnFn).toHaveBeenCalledWith(join(dir, '.venv', 'bin', 'python'), ['server.py'], expect.objectContaining({ cwd: dir }));
});
