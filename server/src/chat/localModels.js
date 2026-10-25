import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { attachmentDataUrl, attachmentKind, attachmentPath, attachmentText } from '../attachments.js';
import { STE_PROMPT } from './chatArgs.js';

/**
 * Local models for Chat, run on this Mac by the user's LocalModelChat project
 * (an MLX server on 127.0.0.1:8000). Agent City starts that server when a
 * local model is first used and shares it if it is already running, so both
 * apps use the same loaded models. Local models have no tools: no web, files
 * or connectors.
 */

export const LOCAL_MODELS = [
  { value: 'local:llama', id: 'llama', label: 'Llama 3.2 3B · local', vision: false },
  { value: 'local:qwen-vl', id: 'qwen-vl', label: 'Qwen2.5-VL 7B · local', vision: true },
];

export function isLocalModel(value) {
  return LOCAL_MODELS.some((model) => model.value === value);
}

export function localModel(value) {
  return LOCAL_MODELS.find((model) => model.value === value) ?? null;
}

const LOCAL_SYSTEM_PROMPT =
  "You are a helpful assistant running entirely on the user's Mac. You have no internet access and no tools, " +
  'so you cannot look anything up. When asked about recent events or live data, say that you cannot check it. ' +
  'Answer clearly and use Markdown when it helps.';

// Same limits as LocalModelChat itself.
const MAX_DOC_CHARS = 50_000;
const MAX_TOKENS = 2048;
const TEMPERATURE = 0.7;

function localUrl() {
  return process.env.AGENT_CITY_LOCAL_MODELS_URL || 'http://127.0.0.1:8000';
}

export function localModelsDir() {
  return process.env.AGENT_CITY_LOCAL_MODELS_DIR || join(homedir(), 'Documents', 'Projects', 'LocalModelChat');
}

function pythonPath() {
  return join(localModelsDir(), '.venv', 'bin', 'python');
}

export function localModelsAvailable() {
  return existsSync(join(localModelsDir(), 'server.py')) && existsSync(pythonPath());
}

// Port 8000 counts as LocalModelChat only if it lists these models.
async function serverUp(fetchFn) {
  try {
    const res = await fetchFn(`${localUrl()}/api/models`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const list = await res.json();
    return Array.isArray(list) && LOCAL_MODELS.every((model) => list.some((item) => item?.id === model.id));
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let starting = null;

/** Makes sure LocalModelChat's server answers, starting it if needed. */
export async function ensureLocalServer({ fetchFn = fetch, spawnFn = spawn, timeoutMs = 60_000, pollMs = 500 } = {}) {
  if (await serverUp(fetchFn)) return;
  if (!localModelsAvailable()) {
    throw new Error(`Local models need the LocalModelChat project (with its .venv) at ${localModelsDir()}.`);
  }
  starting ??= (async () => {
    // Detached, so it keeps serving (and keeps models loaded) across Agent
    // City restarts, as if the user had started it.
    const child = spawnFn(pythonPath(), ['server.py'], { cwd: localModelsDir(), detached: true, stdio: 'ignore' });
    child.unref?.();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await serverUp(fetchFn)) return;
      await sleep(pollMs);
    }
    throw new Error('The local model server did not start within a minute.');
  })().finally(() => {
    starting = null;
  });
  return starting;
}

function fileDataUrl(attachment) {
  const file = attachmentPath(attachment.id);
  return file ? `data:${attachment.mediaType};base64,${readFileSync(file).toString('base64')}` : null;
}

/** PDF text through LocalModelChat's own extractor (pypdf). */
export async function extractPdfViaServer(name, dataUrl, fetchFn = fetch) {
  const res = await fetchFn(`${localUrl()}/api/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, data: dataUrl }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `Could not read ${name}`);
  return body.text;
}

async function documentSections(attachments, extractPdf) {
  const sections = [];
  for (const attachment of attachments) {
    const kind = attachmentKind(attachment.name, attachment.mediaType);
    let text = null;
    if (kind === 'pdf' && extractPdf) {
      text = await extractPdf(attachment.name, fileDataUrl(attachment)).catch((err) => `(Could not read: ${err.message})`);
    } else {
      text = attachmentText(attachment);
    }
    if (text !== null) sections.push(`--- ${attachment.name} ---\n${text}`);
  }
  const joined = sections.join('\n\n');
  return joined.length > MAX_DOC_CHARS ? `${joined.slice(0, MAX_DOC_CHARS)}\n[…cut]` : joined;
}

/**
 * The OpenAI-style message list for LocalModelChat: a system prompt (with STE
 * rules and attached documents when there are any), the conversation so far
 * and the new message. Only the most recent image is sent, and only to a
 * vision model, as LocalModelChat expects.
 */
export async function buildLocalMessages(transcript, { message, attachments = [] }, { vision, simplifiedEnglish = false, extractPdf } = {}) {
  const history = [];
  const allAttachments = [];
  let replyParts = [];
  let replied = false;
  const closeReply = () => {
    if (!replied && replyParts.length > 0) history.push({ role: 'assistant', content: replyParts.join('\n\n') });
    replyParts = [];
    replied = false;
  };
  for (const entry of transcript) {
    if (entry.type === 'user_message') {
      closeReply();
      history.push({ role: 'user', content: entry.text || 'Please look at the attached file(s).' });
      allAttachments.push(...(entry.attachments ?? []));
    } else if (entry.type === 'assistant') {
      for (const block of entry.message?.content ?? []) {
        if (block?.type === 'text' && block.text) replyParts.push(block.text);
      }
    } else if (entry.type === 'result' && typeof entry.result === 'string' && entry.result) {
      history.push({ role: 'assistant', content: entry.result });
      replyParts = [];
      replied = true;
    }
  }
  closeReply();

  allAttachments.push(...attachments);
  const latest = { role: 'user', content: message.trim() || 'Please look at the attached file(s).' };
  const images = allAttachments.filter((a) => attachmentKind(a.name, a.mediaType) === 'image');
  if (images.length > 0) {
    if (vision) {
      const dataUrl = attachmentDataUrl(images.at(-1));
      if (dataUrl) latest.image = dataUrl;
    } else if (attachments.some((a) => attachmentKind(a.name, a.mediaType) === 'image')) {
      latest.content += '\n\n(An image was attached, but this model cannot see images.)';
    }
  }

  let system = LOCAL_SYSTEM_PROMPT;
  if (simplifiedEnglish) system += `\n\n${STE_PROMPT}`;
  const docs = await documentSections(allAttachments, extractPdf);
  if (docs) system += `\n\nThe user has attached the following file(s). Use their content to answer questions about them:\n\n${docs}`;
  return [{ role: 'system', content: system }, ...history, latest];
}

/** Calls `onEvent` for each `data:` event in an SSE chunk; returns the unfinished remainder. */
export function parseSse(buffer, onEvent) {
  let rest = buffer;
  let index;
  while ((index = rest.indexOf('\n\n')) >= 0) {
    const block = rest.slice(0, index);
    rest = rest.slice(index + 2);
    for (const line of block.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      try {
        onEvent(JSON.parse(line.slice(6)));
      } catch {
        // A malformed event is skipped, never fatal.
      }
    }
  }
  return rest;
}

/**
 * Streams one reply from LocalModelChat. Events: {status}, {token}, {done,
 * stats} or {error}. Resolves when the stream ends; `signal` stops it.
 */
export async function streamLocalChat({ modelId, messages, signal }, onEvent, fetchFn = fetch) {
  const res = await fetchFn(`${localUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelId, messages, temperature: TEMPERATURE, max_tokens: MAX_TOKENS }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`The local model server answered ${res.status}`);
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer = parseSse(buffer + decoder.decode(chunk, { stream: true }), onEvent);
  }
}
