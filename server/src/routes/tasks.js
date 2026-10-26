import express from 'express';
import { findAgentById } from '../projectsCache.js';
import { continueTask, getTask, markTaskSeen, NoFollowUpError, summarize, TaskBusyError } from '../taskStore.js';
import { messageJson, readMessageBody } from './messageBody.js';

export const tasksRouter = express.Router();

tasksRouter.get('/:taskId', (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task) {
    res.status(404).json({ error: 'task not found' });
    return;
  }
  res.json({ task });
});

tasksRouter.post('/:taskId/seen', (req, res) => {
  const task = markTaskSeen(req.params.taskId);
  if (!task) {
    res.status(404).json({ error: 'task not found' });
    return;
  }
  res.json({ ok: true });
});

// Sends a follow-up to a finished task. Like starting a task, it answers at
// once with the running task, and the reply is saved on the task.
tasksRouter.post('/:taskId/messages', messageJson, (req, res) => {
  const existing = getTask(req.params.taskId);
  if (!existing) {
    res.status(404).json({ error: 'task not found' });
    return;
  }
  const agent = findAgentById(existing.agentId);
  if (!agent) {
    res.status(404).json({ error: 'The agent for this task no longer exists.' });
    return;
  }
  const body = readMessageBody(req, res);
  if (!body) return;
  try {
    const { task } = continueTask(agent, existing.id, body.message, body.attachments);
    res.json({ task: summarize(task) });
  } catch (err) {
    if (err instanceof TaskBusyError || err instanceof NoFollowUpError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
});
