import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { requireLocalHost } from './hostCheck.js';
import { configRouter } from './routes/config.js';
import { agentsRouter } from './routes/agents.js';
import { sessionsRouter } from './routes/sessions.js';
import { bridgeRouter } from './routes/bridge.js';
import { mayorRouter } from './routes/mayor.js';
import { cityRouter } from './routes/city.js';
import { playgroundsRouter } from './routes/playgrounds.js';
import { attachmentsRouter } from './routes/attachments.js';
import { tasksRouter } from './routes/tasks.js';
import { chatsRouter, chatMetaRouter } from './routes/chats.js';

// The production build of the client (`npm run build`). When present, the
// server hosts the whole app on its own port, so no Vite dev server is needed.
const CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url));

/**
 * @param {object} [options]
 * @param {string|null} [options.clientDist] - built client to serve, if it exists.
 * @param {boolean} [options.hostCheck=true] - reject non-local Host headers.
 *   Only tests (whose supertest server listens on an ephemeral port, so its
 *   Host header never matches) turn this off.
 */
// The built page names its hashed asset files, so its content changes with
// every rebuild. Open windows compare this to notice a newer version.
function clientVersion(clientDist) {
  try {
    return createHash('sha256').update(readFileSync(join(clientDist, 'index.html'))).digest('hex').slice(0, 12);
  } catch {
    return null;
  }
}

export function createApp({ hostCheck = true, clientDist = CLIENT_DIST } = {}) {
  const app = express();

  if (hostCheck) {
    app.use(requireLocalHost());
  }

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/version', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ version: clientDist ? clientVersion(clientDist) : null });
  });

  app.use('/api/config', configRouter);
  app.use('/api/agents', agentsRouter);
  app.use('/api/agents', sessionsRouter);
  app.use('/api/bridge', bridgeRouter);
  app.use('/api/mayor', mayorRouter);
  app.use('/api/city', cityRouter);
  app.use('/api/playgrounds', playgroundsRouter);
  app.use('/api/attachments', attachmentsRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/chats', chatsRouter);
  app.use('/api/chat', chatMetaRouter);

  if (clientDist && existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: 'index.html' }));
    // Unknown /api paths stay 404s; any other GET gets the single-page app.
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile('index.html', { root: clientDist });
    });
  }

  return app;
}
