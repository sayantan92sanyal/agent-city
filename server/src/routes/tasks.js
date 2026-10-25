import express from 'express';
import { getTask, markTaskSeen } from '../taskStore.js';

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
