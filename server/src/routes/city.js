import express from 'express';
import { getProjects } from '../projectsCache.js';
import { getStatus } from '../sessionManager.js';
import { activeLinks, isLinkTarget } from '../links.js';
import { unseenTaskCounts } from '../taskStore.js';

export const cityRouter = express.Router();

cityRouter.get('/status', (_req, res) => {
  const agents = {};
  for (const project of getProjects()) {
    for (const agent of project.agents) {
      agents[agent.id] = getStatus(agent.id) === 'working' || isLinkTarget(agent.id) ? 'working' : 'idle';
    }
  }
  const links = activeLinks().map(({ id, from, to, label }) => ({ id, from, to, label }));
  res.json({ agents, mayor: getStatus('mayor'), links, unseenTasks: unseenTaskCounts() });
});
