import express from 'express';
import { getRoots, setRoots } from '../config.js';

export const configRouter = express.Router();

configRouter.get('/roots', (_req, res) => {
  res.json({ roots: getRoots() });
});

configRouter.put('/roots', express.json(), (req, res) => {
  const roots = req.body?.roots;
  if (!Array.isArray(roots) || !roots.every((r) => typeof r === 'string')) {
    return res.status(400).json({ error: 'body must be { roots: string[] }' });
  }
  setRoots(roots);
  res.json({ roots });
});
