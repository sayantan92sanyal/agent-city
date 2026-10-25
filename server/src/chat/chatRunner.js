import { basename, extname } from 'node:path';
import { buildUserContent, streamJsonUserLine } from '../attachments.js';
import { runClaude } from '../cliRunner.js';
import { buildChatArgs } from './chatArgs.js';
import { FILE_TYPES, extractFiles } from './chatFiles.js';
import { getChat, saveChat, saveLastSettings, titleFrom } from './chatStore.js';
import { disallowedToolsFor, disallowedToolsForTurn } from './connectors.js';
import {
  buildLocalMessages,
  ensureLocalServer,
  extractPdfViaServer,
  localModel,
  streamLocalChat,
} from './localModels.js';

const LOCAL = { ensureServer: () => ensureLocalServer(), chat: streamLocalChat, extractPdf: extractPdfViaServer };

/**
 * Runs chat turns: one `claude` process per turn, streamed into an in-memory
 * live turn, then appended to the chat's transcript when the process ends.
 */

export class ChatBusyError extends Error {
  constructor(chatId) {
    super(`Chat ${chatId} is already running`);
    this.name = 'ChatBusyError';
  }
}

// chatId -> { userEntry, events, partialText, activity, startedAt, usage, kill, stopped }
const liveTurns = new Map();

// Stream deltas and session/rate-limit notices drive the live view only.
const UNSAVED_TYPES = new Set(['stream_event', 'system', 'rate_limit_event']);

export function getLiveTurn(chatId) {
  const turn = liveTurns.get(chatId);
  if (!turn) return null;
  const { userEntry, events, partialText, activity, startedAt } = turn;
  const usage = { input: turn.usage.input, output: turn.usage.output + turn.usage.messageOutput };
  return { userEntry, events, partialText, activity, startedAt, usage };
}

// Tokens so far in a live turn, from each API request's stream: message_start
// carries the input (fresh plus cache), message_delta the output so far.
function countUsage(usage, inner) {
  if (inner?.type === 'message_start') {
    const u = inner.message?.usage ?? {};
    usage.input += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    usage.messageOutput = u.output_tokens ?? 0;
  } else if (inner?.type === 'message_delta' && inner.usage?.output_tokens !== undefined) {
    usage.messageOutput = inner.usage.output_tokens;
  } else if (inner?.type === 'message_stop') {
    usage.output += usage.messageOutput;
    usage.messageOutput = 0;
  }
}

// What Claude is doing while no reply text streams, so a slow turn shows
// thinking, a tool in use or an API retry instead of a bare "Working…".
// Text streaming clears it: the reply itself is then the progress.
function activityFor(event) {
  if (event.type === 'stream_event' && event.event?.type === 'content_block_start') {
    const block = event.event.content_block ?? {};
    if (block.type === 'thinking' || block.type === 'redacted_thinking') return { kind: 'thinking' };
    if (block.type === 'tool_use' || block.type === 'server_tool_use') return { kind: 'tool', tool: block.name };
    if (block.type === 'text') return null;
  }
  if (event.type === 'user') return { kind: 'thinking' };
  if (event.type === 'system' && event.subtype === 'api_retry') {
    return { kind: 'retry', attempt: event.attempt, maxRetries: event.max_retries };
  }
  return undefined;
}

/** Kills the chat's live process; returns whether there was a live turn. */
export function stopChat(chatId) {
  const turn = liveTurns.get(chatId);
  if (!turn) return false;
  turn.stopped = true;
  turn.kill?.();
  return true;
}

/** Test helper: forgets every live turn, as a server restart would. */
export function forgetLiveTurnsForTest() {
  liveTurns.clear();
}

/**
 * `getChat`, except a chat saved as running with no live turn here (the
 * server restarted mid-turn) is marked interrupted and saved that way: its
 * in-flight user message (`pendingEntry`) is kept, then `interrupted`.
 */
export function loadChatForView(chatId) {
  const chat = getChat(chatId);
  if (!chat || !chat.running || liveTurns.has(chatId)) return chat;
  const { pendingEntry, ...rest } = chat;
  const recovered = pendingEntry ? [pendingEntry] : [];
  saveChat({ ...rest, running: false, transcript: [...chat.transcript, ...recovered, { type: 'interrupted' }] });
  return getChat(chatId);
}

function onEvent(chatId, turn, event) {
  const activity = activityFor(event);
  if (activity !== undefined) turn.activity = activity;
  if (event.type === 'stream_event') {
    const inner = event.event;
    countUsage(turn.usage, inner);
    if (inner?.type === 'message_start') turn.partialText = '';
    else if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta') {
      turn.partialText += inner.delta.text ?? '';
    }
    return;
  }
  if (event.type === 'system' && event.subtype === 'init') {
    // Persist now so a turn cut short by a restart still resumes the session.
    const chat = getChat(chatId);
    if (chat && !chat.sessionStarted) saveChat({ ...chat, sessionStarted: true });
    return;
  }
  if (UNSAVED_TYPES.has(event.type)) return;
  if (event.type === 'assistant') turn.partialText = '';
  turn.events.push(event);
}

function errorText(result) {
  const base = result.error ? result.error.message : `claude exited with code ${result.exitCode}`;
  const stderr = (result.stderr ?? '').trim();
  return stderr ? `${base}: ${stderr}` : base;
}

async function runTurn(chatId, turn, { message, attachments }, options) {
  const model = localModel(getChat(chatId).settings.model);
  if (model) return runLocalTurn(chatId, turn, { message, attachments }, model, options.local ?? LOCAL);
  let result = null;
  try {
    // Always yield before spawning, so sendMessage returns first and a
    // stopChat that arrives in the meantime cancels the turn unspawned.
    const disabled = getChat(chatId).settings.disabledConnectors ?? [];
    const disallowedTools = await (options.connectors
      ? disallowedToolsFor(disabled, options.connectors)
      : disallowedToolsForTurn(disabled));
    const chat = getChat(chatId);
    if (!turn.stopped) {
      const args = buildChatArgs({
        sessionId: chat.sessionId,
        resume: chat.sessionStarted,
        model: chat.settings.model,
        effort: chat.settings.effort,
        folder: chat.settings.folder,
        simplifiedEnglish: chat.settings.simplifiedEnglish === true,
        disallowedTools,
      });
      const input = streamJsonUserLine(buildUserContent(message, attachments));
      const run = (options.runClaudeFn ?? runClaude)(
        { args, cwd: chat.settings.folder, input },
        (event) => onEvent(chatId, turn, event),
      );
      turn.kill = run.kill;
      result = await run.done;
    }
  } catch (error) {
    result = { exitCode: null, stderr: '', error };
  }
  return finishTurn(chatId, turn, result);
}

/**
 * A turn on a local model: LocalModelChat streams the reply, which is saved
 * as an ordinary assistant + result pair so the transcript, token meter and
 * a later switch back to Claude all treat it like any other reply.
 */
async function runLocalTurn(chatId, turn, { message, attachments }, model, local) {
  const controller = new AbortController();
  turn.kill = () => controller.abort();
  let text = '';
  let tokens = 0;
  let failure = null;
  try {
    turn.activity = { kind: 'status', text: 'Starting local models…' };
    await local.ensureServer();
    if (!turn.stopped) {
      const chat = getChat(chatId);
      const messages = await buildLocalMessages(chat.transcript, { message, attachments }, {
        vision: model.vision,
        simplifiedEnglish: chat.settings.simplifiedEnglish === true,
        extractPdf: local.extractPdf,
      });
      turn.activity = { kind: 'thinking' };
      await local.chat({ modelId: model.id, messages, signal: controller.signal }, (event) => {
        if (event.status) turn.activity = { kind: 'status', text: event.status };
        if (event.token) {
          text += event.token;
          tokens += 1;
          turn.partialText = text;
          turn.activity = null;
          turn.usage.messageOutput = tokens;
        }
        if (event.error) failure = event.error;
      });
    }
  } catch (error) {
    if (!turn.stopped) failure = error.message;
  }
  if (text) {
    turn.events.push({ type: 'assistant', message: { role: 'assistant', model: model.label, content: [{ type: 'text', text }] } });
  }
  if (!turn.stopped && !failure) {
    turn.events.push({ type: 'result', subtype: 'success', result: text, usage: { input_tokens: 0, output_tokens: tokens } });
  }
  turn.partialText = '';
  return finishTurn(chatId, turn, failure ? { exitCode: 1, stderr: '', error: new Error(failure) } : { exitCode: 0 });
}

function finishTurn(chatId, turn, result) {
  try {
    const chat = getChat(chatId);
    if (!chat) return null;
    const entries = [turn.userEntry, ...turn.events];
    if (turn.stopped) entries.push({ type: 'stopped' });
    else if (result && result.exitCode !== 0) entries.push({ type: 'error', error: errorText(result) });

    let files = chat.files ?? [];
    const found = extractFiles(turn.events, chat.settings.folder);
    if (found.length > 0) {
      entries.push({
        type: 'chat_files',
        files: found.map((path) => ({ path, name: basename(path), mediaType: FILE_TYPES[extname(path).toLowerCase()] })),
      });
      files = [...new Set([...files, ...found])];
    }

    const { pendingEntry: _pending, ...rest } = chat;
    saveChat({ ...rest, running: false, files, transcript: [...chat.transcript, ...entries] });
    saveLastSettings(chat.settings);
    return getChat(chatId);
  } finally {
    liveTurns.delete(chatId);
  }
}

/**
 * Starts a turn. Synchronously: rejects a busy chat, titles a new chat from
 * its first message, marks it running and saves. The process is spawned
 * asynchronously; `finished` resolves to the saved chat once the turn ends.
 */
export function sendMessage(chatId, { message, attachments = [] }, options = {}) {
  if (liveTurns.has(chatId)) throw new ChatBusyError(chatId);
  const existing = getChat(chatId);
  if (!existing) throw new Error(`Unknown chat: ${chatId}`);

  const userEntry = { type: 'user_message', text: message };
  if (attachments.length > 0) userEntry.attachments = attachments;

  const isFirst = existing.transcript.length === 0 && existing.title === 'New chat';
  const title = isFirst ? titleFrom(message, attachments) : existing.title;
  // pendingEntry survives a restart mid-turn; the live view shows userEntry.
  saveChat({ ...existing, title, running: true, pendingEntry: userEntry });
  const chat = getChat(chatId);

  const turn = { userEntry, events: [], partialText: '', activity: null, startedAt: Date.now(),
    usage: { input: 0, output: 0, messageOutput: 0 }, kill: null, stopped: false };
  liveTurns.set(chatId, turn);
  const finished = runTurn(chatId, turn, { message, attachments }, options);
  return { chat, finished };
}
