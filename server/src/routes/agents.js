import express from 'express';
import { getProjects, clearProjectsCache, isKnownProjectPath, findAgentById } from '../projectsCache.js';
import { createAgent, updateAgent, AgentExistsError } from '../agentWriter.js';
import { draftAgent, DraftError } from '../agentDraft.js';
import { moveToTrash } from '../trash.js';

export const agentsRouter = express.Router();

// An explicit list request always rescans (and refreshes the cache that the
// per-agent session/status routes resolve against).
agentsRouter.get('/', (_req, res) => {
  const projects = getProjects({ fresh: true });
  res.json({ projects });
});

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

agentsRouter.post('/', express.json(), (req, res) => {
  const { projectPath, name, model, description, tools, instructions } = req.body ?? {};

  if (!isNonEmptyString(projectPath)) {
    return res.status(400).json({ error: 'projectPath must be a non-empty string' });
  }
  if (!isNonEmptyString(name)) {
    return res.status(400).json({ error: 'name must be a non-empty string' });
  }
  if (!isNonEmptyString(description)) {
    return res.status(400).json({ error: 'description must be a non-empty string' });
  }
  if (tools !== undefined && !isStringArray(tools)) {
    return res.status(400).json({ error: 'tools must be an array of strings' });
  }
  if (instructions !== undefined && typeof instructions !== 'string') {
    return res.status(400).json({ error: 'instructions must be a string' });
  }

  // Only allow writing into a project the scanner actually discovered under
  // the configured roots — never an arbitrary absolute path from the client.
  if (!isKnownProjectPath(projectPath, { fresh: true })) {
    return res.status(400).json({ error: 'projectPath is not a known project under the configured roots' });
  }

  try {
    const { filePath, name: slug } = createAgent(projectPath, { name, model, description, tools, instructions });
    // The new agent must be resolvable by the session/status routes right away.
    clearProjectsCache();
    res.status(201).json({
      agent: {
        id: `${projectPath}::${slug}`,
        projectPath,
        name: slug,
        displayName: name,
        model,
        description,
        tools,
        filePath,
      },
    });
  } catch (err) {
    if (err instanceof AgentExistsError) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }
});

// Claude turns a brief (and, when improving, the agent's current file) into a
// description, instructions and tools for the user to review. Nothing is
// written here; drafting can take a minute when the brief asks for research.
agentsRouter.post('/draft', express.json(), async (req, res, next) => {
  const { name, brief, current } = req.body ?? {};
  if (!isNonEmptyString(name) || !isNonEmptyString(brief)) {
    return res.status(400).json({ error: 'name and brief must be non-empty strings' });
  }
  if (current !== undefined) {
    const valid =
      current && typeof current === 'object' &&
      (current.instructions === undefined || typeof current.instructions === 'string') &&
      (current.tools === undefined || isStringArray(current.tools));
    if (!valid) return res.status(400).json({ error: 'current must hold instructions (string) and tools (strings)' });
  }
  try {
    res.json({ draft: await draftAgent({ name, brief, current }) });
  } catch (err) {
    if (err instanceof DraftError) return res.status(502).json({ error: err.message });
    next(err);
  }
});

// Saves a reviewed draft over an existing agent's file.
agentsRouter.patch('/:agentId/definition', express.json(), (req, res) => {
  const agent = findAgentById(req.params.agentId, { fresh: true });
  if (!agent || agent.error) return res.status(404).json({ error: 'agent not found' });
  const { description, instructions, tools } = req.body ?? {};
  if (!isNonEmptyString(description) || typeof instructions !== 'string' || !isStringArray(tools)) {
    return res.status(400).json({ error: 'description (non-empty), instructions and tools are required' });
  }
  updateAgent(agent.filePath, { description, instructions, tools });
  clearProjectsCache();
  res.json({ agent: { ...agent, description, instructions, tools } });
});

// Deleting an agent moves its file to the Trash, so it can be restored.
agentsRouter.delete('/:agentId', (req, res) => {
  const agent = findAgentById(req.params.agentId, { fresh: true });
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  const trashedTo = moveToTrash(agent.filePath);
  clearProjectsCache();
  res.json({ trashedTo });
});
