import express from 'express';
import { AlreadyRunningError } from '../sessionManager.js';
import { loadMayorTranscript, sendToMayor } from '../mayor/mayorSession.js';
import { messageJson, readMessageBody } from './messageBody.js';

export const mayorRouter = express.Router();

mayorRouter.get('/chat', (_req, res) => {
  res.json({ transcript: loadMayorTranscript() });
});

mayorRouter.post('/chat', messageJson, async (req, res, next) => {
  try {
    const body = readMessageBody(req, res);
    if (!body) return;
    res.json({ transcript: await sendToMayor(body.message, body.attachments) });
  } catch (err) {
    if (err instanceof AlreadyRunningError) {
      return res.status(409).json({ error: err.message });
    }
    next(err);
  }
});
