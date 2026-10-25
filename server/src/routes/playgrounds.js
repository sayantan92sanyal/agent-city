import express from 'express';
import {
  createPlayground,
  InvalidPlaygroundNameError,
  PlaygroundExistsError,
  PlaygroundDeleteError,
  trashPlayground,
} from '../playgroundWriter.js';

export const playgroundsRouter = express.Router();

playgroundsRouter.post('/', express.json(), (req, res, next) => {
  const name = req.body?.name;
  if (typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'name must be a non-empty string' });
  }
  try {
    const { projectPath, projectName } = createPlayground(name);
    res.status(201).json({ playground: { projectPath, projectName, agents: [] } });
  } catch (err) {
    if (err instanceof InvalidPlaygroundNameError) return res.status(400).json({ error: err.message });
    if (err instanceof PlaygroundExistsError) return res.status(409).json({ error: err.message });
    next(err);
  }
});

// Deleting a playground moves its whole folder to the Trash.
playgroundsRouter.delete('/', express.json(), (req, res, next) => {
  const projectPath = req.body?.projectPath;
  if (typeof projectPath !== 'string' || projectPath === '') {
    return res.status(400).json({ error: 'projectPath must be a non-empty string' });
  }
  try {
    res.json({ trashedTo: trashPlayground(projectPath) });
  } catch (err) {
    if (err instanceof PlaygroundDeleteError) return res.status(400).json({ error: err.message });
    next(err);
  }
});
