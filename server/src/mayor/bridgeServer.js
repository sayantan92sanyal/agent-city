import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function createBridgeServer({ backend }) {
  const server = new McpServer({ name: 'city', version: '1.0.0' });

  server.registerTool(
    'list_agents',
    { description: 'List every agent in every playground (id, name, description, playground).' },
    async () => {
      const agents = await backend.listAgents();
      return { content: [{ type: 'text', text: JSON.stringify(agents, null, 2) }] };
    },
  );

  server.registerTool(
    'ask_agent',
    {
      description:
        'Give an agent a task. It runs in its own playground folder and returns its final answer. Use the id from list_agents.',
      inputSchema: { agent_id: z.string(), message: z.string() },
    },
    async ({ agent_id, message }) => {
      const result = await backend.askAgent(agent_id, message);
      if (result.error) {
        return { isError: true, content: [{ type: 'text', text: `ERROR: ${result.error}` }] };
      }
      return { content: [{ type: 'text', text: result.reply }] };
    },
  );

  return server;
}
