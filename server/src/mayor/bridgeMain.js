#!/usr/bin/env node
// Stdio MCP server launched by the Mayor's claude session (--mcp-config).
// Uses node:http (not fetch) so long-running asks are not killed by fetch's headers timeout.
import http from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBridgeServer } from './bridgeServer.js';

const BRIDGE_URL = process.env.BRIDGE_URL;
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN;

function request(method, path, body) {
  return new Promise((resolve) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = { 'x-bridge-token': BRIDGE_TOKEN ?? '' };
    if (payload !== null) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }
    const req = http.request(new URL(path, BRIDGE_URL), { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* non-JSON body */ }
        if (res.statusCode !== 200) {
          resolve({ error: json?.error ?? `Backend returned HTTP ${res.statusCode}` });
        } else if (json === null) {
          resolve({ error: 'Backend returned an invalid response' });
        } else {
          resolve(json);
        }
      });
    });
    req.on('error', (err) => resolve({ error: `Backend unreachable: ${err.message}` }));
    if (payload !== null) req.write(payload);
    req.end();
  });
}

const backend = {
  async listAgents() {
    const res = await request('GET', '/api/bridge/agents');
    if (res.error) throw new Error(res.error);
    return res.agents;
  },
  askAgent(agentId, message) {
    return request('POST', '/api/bridge/ask', { agentId, message });
  },
};

const server = createBridgeServer({ backend });
await server.connect(new StdioServerTransport());
