import { test, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBridgeServer } from '../src/mayor/bridgeServer.js';

async function connect(backend) {
  const server = createBridgeServer({ backend });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

test('list_agents returns the backend list as JSON text', async () => {
  const client = await connect({ listAgents: async () => [{ id: '/p::a', name: 'a', description: 'd', playground: 'p' }] });
  const res = await client.callTool({ name: 'list_agents', arguments: {} });
  expect(JSON.parse(res.content[0].text)).toEqual([{ id: '/p::a', name: 'a', description: 'd', playground: 'p' }]);
});

test('ask_agent returns the reply text', async () => {
  const askAgent = vi.fn(async () => ({ reply: 'Paris' }));
  const client = await connect({ askAgent });
  const res = await client.callTool({ name: 'ask_agent', arguments: { agent_id: '/p::a', message: 'capital?' } });
  expect(askAgent).toHaveBeenCalledWith('/p::a', 'capital?');
  expect(res.content[0].text).toBe('Paris');
});

test('ask_agent surfaces backend errors as isError', async () => {
  const client = await connect({ askAgent: async () => ({ error: 'Unknown agentId' }) });
  const res = await client.callTool({ name: 'ask_agent', arguments: { agent_id: 'x', message: 'm' } });
  expect(res.isError).toBe(true);
  expect(res.content[0].text).toBe('ERROR: Unknown agentId');
});
