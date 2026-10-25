import express from 'express';
import { findAgentById, getProjects } from '../projectsCache.js';
import { runOneOff } from '../sessionManager.js';
import { startLink, endLink } from '../links.js';
import { getBridgeToken } from '../mayor/bridgeToken.js';
import { finalReply } from '../mayor/finalReply.js';

export const bridgeRouter = express.Router();

bridgeRouter.use((req, res, next) => {
  if (req.get('x-bridge-token') !== getBridgeToken()) {
    res.status(401).json({ error: 'bad bridge token' });
    return;
  }
  next();
});

bridgeRouter.get('/agents', (_req, res) => {
  const agents = [];
  for (const project of getProjects()) {
    for (const agent of project.agents) {
      if (agent.error) continue;
      agents.push({
        id: agent.id,
        name: agent.name,
        description:
          typeof agent.description === 'string' ? agent.description.slice(0, 300) : agent.description,
        playground: project.projectName,
      });
    }
  }
  res.json({ agents });
});

bridgeRouter.post('/ask', express.json(), async (req, res) => {
  const { agentId, message } = req.body ?? {};
  if (typeof agentId !== 'string' || typeof message !== 'string' || message.trim() === '') {
    res.status(400).json({ error: 'agentId and a non-empty message are required' });
    return;
  }
  const agent = findAgentById(agentId);
  if (!agent) {
    res.json({ error: `Unknown agentId "${agentId}"` });
    return;
  }

  const linkId = startLink({ from: 'mayor', to: agentId, label: message.slice(0, 60) });
  try {
    const transcript = await runOneOff(agent, message);
    res.json(finalReply(transcript));
  } catch (err) {
    res.json({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    endLink(linkId);
  }
});
