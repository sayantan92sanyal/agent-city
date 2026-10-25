import { createApp } from './app.js';
import { PORT } from './hostCheck.js';

// Bound to loopback only: this server can spawn `claude` with
// `--permission-mode bypassPermissions`, so it must never be reachable from
// other machines on the network.
const HOST = '127.0.0.1';

const server = createApp().listen(PORT, HOST, () => {
  console.log(`Agent Control Panel server listening on http://localhost:${PORT}`);
});

// Agent runs (and Mayor asks) can take minutes; don't let Node cut them off.
server.requestTimeout = 0;
server.headersTimeout = 0;
