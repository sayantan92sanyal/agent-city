import { basename } from 'node:path';
import express from 'express';
import { attachmentPath } from '../attachments.js';

export const attachmentsRouter = express.Router();

attachmentsRouter.get('/:id', (req, res) => {
  const file = attachmentPath(req.params.id);
  if (!file) {
    res.status(404).json({ error: 'attachment not found' });
    return;
  }
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  // Any file type can be attached, so nothing served here may run as a page
  // on the app's origin: no type sniffing, a sandbox, and anything that is
  // not an image, PDF or plain text downloads instead of opening.
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Security-Policy', 'sandbox');
  if (!/\.(png|jpe?g|gif|webp|pdf|txt)$/.test(file)) res.attachment(basename(file));
  res.sendFile(file, { dotfiles: 'allow' });
});
