import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChat, getChat, getLastSettings, saveChat } from '../src/chat/chatStore.js';
import {
  ChatBusyError,
  forgetLiveTurnsForTest,
  getLiveTurn,
  loadChatForView,
  sendMessage,
  stopChat,
} from '../src/chat/chatRunner.js';

let home;
let folder;
let previous;

beforeEach(() => {
  previous = process.env.AGENT_PANEL_HOME;
  home = mkdtempSync(join(tmpdir(), 'chat-runner-'));
  folder = mkdtempSync(join(tmpdir(), 'chat-folder-'));
  process.env.AGENT_PANEL_HOME = home;
});

afterEach(() => {
  if (previous === undefined) delete process.env.AGENT_PANEL_HOME;
  else process.env.AGENT_PANEL_HOME = previous;
  rmSync(home, { recursive: true, force: true });
  rmSync(folder, { recursive: true, force: true });
});

/**
 * A fake `runClaude`: records each call; the test emits events and finishes
 * the process when it wants. `kill()` finishes it like a signalled process.
 */
function fakeRunner() {
  const calls = [];
  const fn = vi.fn((options, onEvent) => {
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    const call = {
      options,
      emit: (event) => onEvent(event),
      finish: (result = { exitCode: 0, stderr: '' }) => resolve(result),
      kill: vi.fn(() => resolve({ exitCode: null, stderr: '' })),
    };
    calls.push(call);
    return { kill: call.kill, done };
  });
  return { fn, calls };
}

// Lets the async part of sendMessage (connectors, spawn) run.
const tick = () => new Promise((r) => setTimeout(r, 0));

const delta = (text) => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
});
const assistant = (...content) => ({ type: 'assistant', message: { role: 'assistant', content } });
const result = { type: 'result', subtype: 'success', result: 'Hello' };
const init = { type: 'system', subtype: 'init', session_id: 'x' };

function newChat(settings = {}) {
  return createChat({ folder, ...settings });
}

describe('chatRunner', () => {
  it('runs a local model turn: streams tokens, then saves the reply like any other', async () => {
    const chat = newChat({ model: 'local:llama' });
    let emit;
    let finishStream;
    const local = {
      ensureServer: vi.fn(async () => {}),
      extractPdf: vi.fn(),
      chat: vi.fn(({ modelId, messages }, onEvent) => {
        expect(modelId).toBe('llama');
        expect(messages.at(-1)).toEqual({ role: 'user', content: 'Hi' });
        emit = onEvent;
        return new Promise((resolve) => { finishStream = resolve; });
      }),
    };
    const fn = vi.fn();
    const { finished } = sendMessage(chat.id, { message: 'Hi', attachments: [] }, { runClaudeFn: fn, local });
    await vi.waitFor(() => expect(local.chat).toHaveBeenCalled());
    emit({ status: 'Loading Llama 3.2 3B Instruct (first use takes a moment)…' });
    expect(getLiveTurn(chat.id).activity).toEqual({ kind: 'status', text: 'Loading Llama 3.2 3B Instruct (first use takes a moment)…' });
    emit({ token: 'Hel' });
    emit({ token: 'lo' });
    expect(getLiveTurn(chat.id)).toMatchObject({ partialText: 'Hello', activity: null, usage: { input: 0, output: 2 } });
    emit({ done: true, stats: '2 tokens · 40.0 tok/s' });
    finishStream();

    const saved = await finished;
    expect(fn).not.toHaveBeenCalled();
    expect(saved.transcript.map((e) => e.type)).toEqual(['user_message', 'assistant', 'result']);
    expect(saved.transcript[1].message.content).toEqual([{ type: 'text', text: 'Hello' }]);
    expect(saved.transcript[2]).toMatchObject({ subtype: 'success', result: 'Hello', usage: { input_tokens: 0, output_tokens: 2 } });
  });

  it('a local model error shows in the conversation', async () => {
    const chat = newChat({ model: 'local:qwen-vl' });
    const local = {
      ensureServer: vi.fn(async () => { throw new Error('Local models need the LocalModelChat project'); }),
      chat: vi.fn(),
    };
    const saved = await sendMessage(chat.id, { message: 'Hi', attachments: [] }, { local }).finished;
    expect(local.chat).not.toHaveBeenCalled();
    expect(saved.transcript.at(-1)).toMatchObject({ type: 'error', error: expect.stringContaining('LocalModelChat') });
  });

  it('Stop ends a local reply and keeps what was written', async () => {
    const chat = newChat({ model: 'local:llama' });
    let emit;
    const local = {
      ensureServer: vi.fn(async () => {}),
      chat: vi.fn(({ signal }, onEvent) => {
        emit = onEvent;
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
      }),
    };
    const { finished } = sendMessage(chat.id, { message: 'Long story', attachments: [] }, { local });
    await vi.waitFor(() => expect(local.chat).toHaveBeenCalled());
    emit({ token: 'Once upon' });
    stopChat(chat.id);
    const saved = await finished;
    expect(saved.transcript.map((e) => e.type)).toEqual(['user_message', 'assistant', 'stopped']);
    expect(saved.transcript[1].message.content[0].text).toBe('Once upon');
  });

  it('counts input and output tokens across the requests of a live turn', async () => {
    const chat = newChat();
    const { fn, calls } = fakeRunner();
    const { finished } = sendMessage(chat.id, { message: 'Hi', attachments: [] }, { runClaudeFn: fn, connectors: [] });
    expect(getLiveTurn(chat.id).usage).toEqual({ input: 0, output: 0 });
    await tick();

    const run = calls[0];
    const start = (usage) => ({ type: 'stream_event', event: { type: 'message_start', message: { usage } } });
    const outSoFar = (output_tokens) => ({ type: 'stream_event', event: { type: 'message_delta', delta: {}, usage: { output_tokens } } });
    run.emit(start({ input_tokens: 3, cache_creation_input_tokens: 1000, cache_read_input_tokens: 9000, output_tokens: 1 }));
    expect(getLiveTurn(chat.id).usage).toEqual({ input: 10003, output: 1 });
    run.emit(outSoFar(40));
    expect(getLiveTurn(chat.id).usage).toEqual({ input: 10003, output: 40 });
    run.emit({ type: 'stream_event', event: { type: 'message_stop' } });
    run.emit(start({ input_tokens: 5, cache_read_input_tokens: 10500, output_tokens: 1 }));
    run.emit(outSoFar(25));
    expect(getLiveTurn(chat.id).usage).toEqual({ input: 20508, output: 65 });
    run.emit(result);
    run.finish();
    await finished;
  });

  it('reports what Claude is doing while no reply text is streaming', async () => {
    const chat = newChat();
    const { fn, calls } = fakeRunner();
    const { finished } = sendMessage(chat.id, { message: 'Hi', attachments: [] }, { runClaudeFn: fn, connectors: [] });
    const live = getLiveTurn(chat.id);
    expect(live.activity).toBeNull();
    expect(typeof live.startedAt).toBe('number');
    await tick();

    const run = calls[0];
    const blockStart = (content_block) => ({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block } });
    run.emit(blockStart({ type: 'thinking', thinking: '' }));
    expect(getLiveTurn(chat.id).activity).toEqual({ kind: 'thinking' });
    run.emit(blockStart({ type: 'tool_use', name: 'WebSearch', input: {} }));
    expect(getLiveTurn(chat.id).activity).toEqual({ kind: 'tool', tool: 'WebSearch' });
    run.emit({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'results' }] } });
    expect(getLiveTurn(chat.id).activity).toEqual({ kind: 'thinking' });
    run.emit({ type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 10, retry_delay_ms: 1000, error_status: null });
    expect(getLiveTurn(chat.id).activity).toEqual({ kind: 'retry', attempt: 2, maxRetries: 10 });
    run.emit(blockStart({ type: 'text', text: '' }));
    expect(getLiveTurn(chat.id).activity).toBeNull();
    run.emit(result);
    run.finish();
    await finished;
  });

  it('streams partial text, then saves only real events', async () => {
    const chat = newChat();
    const { fn, calls } = fakeRunner();
    const { chat: started, finished } = sendMessage(chat.id, { message: 'Hi', attachments: [] }, { runClaudeFn: fn, connectors: [] });
    expect(started.running).toBe(true);
    expect(getChat(chat.id).running).toBe(true);
    expect(getLiveTurn(chat.id)).toMatchObject({ userEntry: { type: 'user_message', text: 'Hi' }, events: [], partialText: '' });
    await tick();

    const run = calls[0];
    run.emit(init);
    run.emit({ type: 'stream_event', event: { type: 'message_start', message: {} } });
    run.emit(delta('Hel'));
    run.emit(delta('lo'));
    expect(getLiveTurn(chat.id).partialText).toBe('Hello');
    run.emit({ type: 'stream_event', event: { type: 'message_start', message: {} } });
    expect(getLiveTurn(chat.id).partialText).toBe('');
    run.emit(delta('Hello'));
    run.emit({ type: 'rate_limit_event', rate_limit_info: {} });
    run.emit(assistant({ type: 'text', text: 'Hello' }));
    expect(getLiveTurn(chat.id).partialText).toBe('');
    run.emit(result);
    run.finish();

    const saved = await finished;
    expect(saved.transcript.map((e) => e.type)).toEqual(['user_message', 'assistant', 'result']);
    expect(saved.transcript[0]).toEqual({ type: 'user_message', text: 'Hi' });
    expect(saved.running).toBe(false);
    expect(saved.sessionStarted).toBe(true);
    expect(getChat(chat.id)).toEqual(saved);
    expect(getLiveTurn(chat.id)).toBeNull();
    expect(getLastSettings()).toEqual(saved.settings);
  });

  it('passes args, cwd and stdin', async () => {
    const chat = newChat({ model: 'sonnet', effort: 'low', simplifiedEnglish: true });
    const { fn, calls } = fakeRunner();
    const first = sendMessage(chat.id, { message: 'What is 2+2?', attachments: [] }, { runClaudeFn: fn, connectors: [] });
    await tick();
    const { args, cwd, input } = calls[0].options;
    expect(cwd).toBe(folder);
    expect(args).toContain('--session-id');
    expect(args[args.indexOf('--session-id') + 1]).toBe(chat.sessionId);
    expect(args).not.toContain('--resume');
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
    expect(args[args.indexOf('--system-prompt') + 1]).toContain('ASD-STE100');
    expect(args[args.indexOf('--system-prompt') + 1]).toContain(`in the folder ${folder}`);
    expect(args[args.indexOf('--effort') + 1]).toBe('low');
    const line = JSON.parse(input);
    expect(line.type).toBe('user');
    expect(line.message.role).toBe('user');
    expect(line.message.content.at(-1).text.startsWith('What is 2+2?')).toBe(true);
    calls[0].emit(init);
    calls[0].finish();
    await first.finished;

    const second = sendMessage(chat.id, { message: 'And 3+3?', attachments: [] }, { runClaudeFn: fn, connectors: [] });
    await tick();
    const args2 = calls[1].options.args;
    expect(args2).toContain('--resume');
    expect(args2[args2.indexOf('--resume') + 1]).toBe(chat.sessionId);
    expect(args2).not.toContain('--session-id');
    calls[1].finish();
    const saved = await second.finished;
    expect(saved.transcript.filter((e) => e.type === 'user_message').map((e) => e.text)).toEqual(['What is 2+2?', 'And 3+3?']);
  });

  it('disabled connectors become --disallowedTools', async () => {
    const chat = newChat({ disabledConnectors: ['Gmail'] });
    const connectors = [
      { name: 'Gmail', source: 'claude.ai', status: 'connected', toolPrefix: 'mcp__claude_ai_Gmail' },
      { name: 'Slack', source: 'claude.ai', status: 'connected', toolPrefix: 'mcp__claude_ai_Slack' },
    ];
    const { fn, calls } = fakeRunner();
    const { finished } = sendMessage(chat.id, { message: 'Hi', attachments: [] }, { runClaudeFn: fn, connectors });
    await tick();
    const { args } = calls[0].options;
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe('mcp__claude_ai_Gmail');
    calls[0].finish();
    await finished;
  });

  it('rejects a second send while live', async () => {
    const chat = newChat();
    const { fn, calls } = fakeRunner();
    const { finished } = sendMessage(chat.id, { message: 'Hi', attachments: [] }, { runClaudeFn: fn, connectors: [] });
    expect(() => sendMessage(chat.id, { message: 'Again', attachments: [] }, { runClaudeFn: fn, connectors: [] }))
      .toThrow(ChatBusyError);
    await tick();
    expect(fn).toHaveBeenCalledTimes(1);
    calls[0].finish();
    const saved = await finished;
    expect(saved.transcript.filter((e) => e.type === 'user_message')).toHaveLength(1);
  });

  it('stop kills the process and records stopped', async () => {
    const chat = newChat();
    expect(stopChat(chat.id)).toBe(false);
    const { fn, calls } = fakeRunner();
    const { finished } = sendMessage(chat.id, { message: 'Long task', attachments: [] }, { runClaudeFn: fn, connectors: [] });
    await tick();
    calls[0].emit(assistant({ type: 'text', text: 'Working' }));
    expect(stopChat(chat.id)).toBe(true);
    expect(calls[0].kill).toHaveBeenCalled();
    const saved = await finished;
    expect(saved.transcript.at(-1)).toEqual({ type: 'stopped' });
    expect(saved.transcript.some((e) => e.type === 'error')).toBe(false);
    expect(saved.running).toBe(false);
    expect(stopChat(chat.id)).toBe(false);
  });

  it('stop before the spawn ends the turn without spawning', async () => {
    const chat = newChat();
    const { fn } = fakeRunner();
    const { finished } = sendMessage(chat.id, { message: 'Hi', attachments: [] }, { runClaudeFn: fn, connectors: [] });
    expect(stopChat(chat.id)).toBe(true);
    const saved = await finished;
    expect(fn).not.toHaveBeenCalled();
    expect(saved.transcript.map((e) => e.type)).toEqual(['user_message', 'stopped']);
    expect(saved.running).toBe(false);
  });

  it('a crashed CLI is recorded as an error entry', async () => {
    const chat = newChat();
    const { fn, calls } = fakeRunner();
    const { finished } = sendMessage(chat.id, { message: 'Hi', attachments: [] }, { runClaudeFn: fn, connectors: [] });
    await tick();
    calls[0].finish({ exitCode: 1, stderr: '  Invalid API key\n' });
    const saved = await finished;
    expect(saved.transcript.at(-1)).toEqual({ type: 'error', error: 'claude exited with code 1: Invalid API key' });
    expect(saved.running).toBe(false);

    const second = sendMessage(chat.id, { message: 'Again', attachments: [] }, { runClaudeFn: fn, connectors: [] });
    await tick();
    calls[1].finish({ exitCode: null, stderr: '', error: new Error('spawn claude ENOENT') });
    expect((await second.finished).transcript.at(-1)).toEqual({ type: 'error', error: 'spawn claude ENOENT' });
  });

  it('title comes from the first message only', async () => {
    const chat = newChat();
    const { fn, calls } = fakeRunner();
    const first = sendMessage(chat.id, { message: 'Plan my trip to Lisbon\nmore detail', attachments: [] }, { runClaudeFn: fn, connectors: [] });
    expect(first.chat.title).toBe('Plan my trip to Lisbon');
    await tick();
    calls[0].finish();
    await first.finished;

    const second = sendMessage(chat.id, { message: 'Something else', attachments: [] }, { runClaudeFn: fn, connectors: [] });
    await tick();
    calls[1].finish();
    expect((await second.finished).title).toBe('Plan my trip to Lisbon');
  });

  it('a restart mid-turn keeps the user message, then marks it interrupted', async () => {
    const chat = newChat();
    const { fn } = fakeRunner();
    sendMessage(chat.id, { message: 'Hi there', attachments: [] }, { runClaudeFn: fn, connectors: [] });
    await tick();
    expect(getChat(chat.id).transcript).toEqual([]);
    forgetLiveTurnsForTest(); // the server restarts; the process never reports back

    const viewed = loadChatForView(chat.id);
    expect(viewed.running).toBe(false);
    expect(viewed.transcript).toEqual([{ type: 'user_message', text: 'Hi there' }, { type: 'interrupted' }]);
    expect(viewed.pendingEntry).toBeUndefined();
    expect(getChat(chat.id)).toEqual(viewed);
    expect(loadChatForView(chat.id).transcript).toHaveLength(2);
    expect(loadChatForView('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('a finished turn clears the pending user message', async () => {
    const chat = newChat();
    const { fn, calls } = fakeRunner();
    const { finished } = sendMessage(chat.id, { message: 'Hi', attachments: [] }, { runClaudeFn: fn, connectors: [] });
    expect(getChat(chat.id).pendingEntry).toEqual({ type: 'user_message', text: 'Hi' });
    await tick();
    calls[0].finish();
    const saved = await finished;
    expect(saved.pendingEntry).toBeUndefined();
    expect(saved.transcript.filter((e) => e.type === 'user_message')).toHaveLength(1);
  });

  it('loadChatForView leaves a live chat running', async () => {
    const chat = newChat();
    const { fn, calls } = fakeRunner();
    const { finished } = sendMessage(chat.id, { message: 'Hi', attachments: [] }, { runClaudeFn: fn, connectors: [] });
    const viewed = loadChatForView(chat.id);
    expect(viewed.running).toBe(true);
    expect(viewed.transcript).toEqual([]);
    await tick();
    calls[0].finish();
    await finished;
  });

  it('chat_files lists files Claude wrote', async () => {
    const chat = newChat();
    const png = join(folder, 'chart.png');
    writeFileSync(png, 'png');
    const { fn, calls } = fakeRunner();
    const { finished } = sendMessage(chat.id, { message: 'Make a chart', attachments: [] }, { runClaudeFn: fn, connectors: [] });
    await tick();
    calls[0].emit(assistant({ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: png, content: 'png' } }));
    calls[0].emit(assistant({ type: 'text', text: `Saved to ${png}` }));
    calls[0].emit(result);
    calls[0].finish();
    const saved = await finished;
    expect(saved.transcript.at(-1)).toEqual({
      type: 'chat_files',
      files: [{ path: png, name: 'chart.png', mediaType: 'image/png' }],
    });
    expect(saved.files).toContain(png);
  });
});
