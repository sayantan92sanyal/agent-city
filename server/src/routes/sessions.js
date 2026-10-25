import express from 'express';
import { findAgentById } from '../projectsCache.js';
import { sendToStandingChat, getPendingTurn, getStatus, AlreadyRunningError } from '../sessionManager.js';
import { listTasks, startTask, summarize } from '../taskStore.js';
import { loadSession } from '../transcriptStore.js';
import { messageJson, readMessageBody } from './messageBody.js';

export const sessionsRouter = express.Router();

// Resolves an agentId against the (briefly cached) scanned agent list,
// returning the AgentSummary that sessionManager functions expect. The cache
// keeps the board's per-agent status polling from re-walking the
// filesystem on every request.
function requireAgent(req, res) {
  const agent = findAgentById(req.params.agentId);
  if (!agent) {
    res.status(404).json({ error: `Unknown agentId "${req.params.agentId}"` });
    return undefined;
  }
  return agent;
}

sessionsRouter.post('/:agentId/chat', messageJson, async (req, res, next) => {
  const agent = requireAgent(req, res);
  if (!agent) return;

  try {
    const body = readMessageBody(req, res);
    if (!body) return;
    const transcript = await sendToStandingChat(agent, body.message, body.attachments);
    res.json({ transcript });
  } catch (err) {
    if (err instanceof AlreadyRunningError) {
      return res.status(409).json({ error: err.message });
    }
    next(err);
  }
});

sessionsRouter.get('/:agentId/chat', (req, res) => {
  const agent = requireAgent(req, res);
  if (!agent) return;

  const session = loadSession(agent.id);
  res.json({ transcript: session?.transcript ?? [], pending: getPendingTurn(agent.id) });
});

// Starts a one-off task in the background and answers at once; the result
// is saved on the task (GET /api/tasks/:taskId), so closing the panel that
// started it loses nothing.
sessionsRouter.post('/:agentId/tasks', messageJson, (req, res) => {
  const agent = requireAgent(req, res);
  if (!agent) return;
  const body = readMessageBody(req, res);
  if (!body) return;
  const { task } = startTask(agent, body.message, body.attachments);
  res.status(201).json({ task: summarize(task) });
});

sessionsRouter.get('/:agentId/tasks', (req, res) => {
  const agent = requireAgent(req, res);
  if (!agent) return;
  res.json({ tasks: listTasks(agent.id) });
});

sessionsRouter.get('/:agentId/status', (req, res) => {
  const agent = requireAgent(req, res);
  if (!agent) return;

  res.json({ status: getStatus(agent.id) });
});
