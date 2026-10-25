import express, { Router } from 'express';
import { extname, resolve } from 'node:path';
import { EFFORTS, MODELS } from '../chat/chatArgs.js';
import { FILE_TYPES } from '../chat/chatFiles.js';
import { listConnectors } from '../chat/connectors.js';
import { createChat, deleteChat, getLastSettings, listChats, saveChat } from '../chat/chatStore.js';
import { ChatBusyError, getLiveTurn, loadChatForView, sendMessage, stopChat } from '../chat/chatRunner.js';
import { SettingsError, listFolders, validateSettings } from '../chat/folders.js';
import { LOCAL_MODELS, localModelsAvailable } from '../chat/localModels.js';
import { messageJson, readMessageBody } from './messageBody.js';

const CLAUDE_MODEL_OPTIONS = [
  { value: '', label: 'Default' },
  ...MODELS.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) })),
];

// Local models are offered only when LocalModelChat is set up on this Mac.
function modelOptions() {
  if (!localModelsAvailable()) return CLAUDE_MODEL_OPTIONS;
  return [...CLAUDE_MODEL_OPTIONS, ...LOCAL_MODELS.map(({ value, label }) => ({ value, label, local: true }))];
}

function notFound(res) {
  return res.status(404).json({ error: 'Chat not found' });
}

// Maps settings validation failures to 400 responses.
function handle(fn) {
  return (req, res, next) => {
    try {
      fn(req, res, next);
    } catch (err) {
      if (err instanceof SettingsError) return res.status(400).json({ error: err.message });
      next(err);
    }
  };
}

export const chatsRouter = Router();
export const chatMetaRouter = Router();

chatsRouter.get('/', (_req, res) => {
  res.json({ chats: listChats() });
});

chatsRouter.post('/', express.json(), handle((req, res) => {
  const settings = validateSettings(req.body?.settings);
  res.status(201).json({ chat: createChat(settings) });
}));

chatsRouter.get('/:id', (req, res) => {
  const chat = loadChatForView(req.params.id);
  if (!chat) return notFound(res);
  res.json({ chat, live: getLiveTurn(chat.id) });
});

chatsRouter.patch('/:id', express.json(), handle((req, res) => {
  const chat = loadChatForView(req.params.id);
  if (!chat) return notFound(res);
  const changes = validateSettings(req.body?.settings);
  const folderLocked = chat.sessionStarted || chat.running || chat.transcript.length > 0;
  if (changes.folder !== undefined && changes.folder !== chat.settings.folder && folderLocked) {
    return res.status(409).json({ error: "The folder can't change after the first message." });
  }
  const next = { ...chat, settings: { ...chat.settings, ...changes } };
  const title = req.body?.title;
  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim() === '') {
      return res.status(400).json({ error: 'title must be a non-empty string' });
    }
    next.title = title.trim();
  }
  saveChat(next);
  res.json({ chat: loadChatForView(chat.id) });
}));

chatsRouter.delete('/:id', (req, res) => {
  const chat = loadChatForView(req.params.id);
  if (!chat) return notFound(res);
  if (getLiveTurn(chat.id)) return res.status(409).json({ error: 'Claude is still replying in this chat.' });
  deleteChat(chat.id);
  res.status(204).end();
});

chatsRouter.post('/:id/messages', messageJson, (req, res, next) => {
  const chat = loadChatForView(req.params.id);
  if (!chat) return notFound(res);
  const body = readMessageBody(req, res);
  if (!body) return;
  try {
    const { chat: updated } = sendMessage(chat.id, { message: body.message, attachments: body.attachments });
    res.status(202).json({ chat: updated });
  } catch (err) {
    if (err instanceof ChatBusyError) {
      return res.status(409).json({ error: 'Claude is still replying in this chat.' });
    }
    next(err);
  }
});

chatsRouter.post('/:id/stop', (req, res) => {
  const chat = loadChatForView(req.params.id);
  if (!chat) return notFound(res);
  res.json({ stopped: stopChat(chat.id) });
});

chatsRouter.get('/:id/file', (req, res) => {
  const chat = loadChatForView(req.params.id);
  if (!chat) return notFound(res);
  const requested = req.query.path;
  if (typeof requested !== 'string' || requested === '') return res.status(404).json({ error: 'File not found' });
  const path = resolve(requested);
  const type = FILE_TYPES[extname(path).toLowerCase()];
  if (!type || !(chat.files ?? []).includes(path)) return res.status(404).json({ error: 'File not found' });
  // Generated HTML/SVG must never run with this app's origin, even if opened directly.
  res.set('Content-Security-Policy', 'sandbox allow-scripts');
  res.set('X-Content-Type-Options', 'nosniff');
  res.type(type).sendFile(path, { dotfiles: 'allow' }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'File not found' });
  });
});

chatMetaRouter.get('/connectors', async (req, res, next) => {
  try {
    res.json(await listConnectors({ fresh: req.query.fresh === '1' }));
  } catch (err) {
    next(err);
  }
});

chatMetaRouter.get('/settings', (_req, res) => {
  res.json({ settings: getLastSettings(), models: modelOptions(), efforts: EFFORTS });
});

chatMetaRouter.get('/folders', handle((req, res) => {
  const path = typeof req.query.path === 'string' && req.query.path !== '' ? req.query.path : undefined;
  res.json(listFolders(path));
}));
