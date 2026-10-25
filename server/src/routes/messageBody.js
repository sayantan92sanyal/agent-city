import express from 'express';
import { AttachmentError, saveAttachments } from '../attachments.js';

// Attachments travel as base64 inside the JSON body, so allow room for a
// handful of screenshots or a PDF.
export const messageJson = express.json({ limit: '60mb' });

/**
 * Reads `{ message, attachments? }` from a request body, storing any
 * attachments. A message may be blank only when files are attached. Sends a
 * 400 and returns undefined when the body is invalid.
 * @returns {{ message: string, attachments: Array<Object> } | undefined}
 */
export function readMessageBody(req, res) {
  const message = req.body?.message ?? '';
  if (typeof message !== 'string') {
    res.status(400).json({ error: 'message must be a string' });
    return undefined;
  }
  const uploads = req.body?.attachments;
  const hasUploads = Array.isArray(uploads) && uploads.length > 0;
  if (message.trim() === '' && !hasUploads) {
    res.status(400).json({ error: 'message must be a non-empty string' });
    return undefined;
  }
  try {
    return { message, attachments: saveAttachments(uploads) };
  } catch (err) {
    if (err instanceof AttachmentError) {
      res.status(400).json({ error: err.message });
      return undefined;
    }
    throw err;
  }
}
