import { randomBytes } from 'node:crypto';

// Shared secret between the backend and the Mayor's bridge MCP server,
// generated once per process.
const token = randomBytes(32).toString('hex');

export function getBridgeToken() {
  return token;
}
