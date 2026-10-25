import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseAgentFile } from './agentFrontmatter.js';

const MAX_DEPTH = 6;

function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function scanAgentsDir(agentsDir, projectPath) {
  const agents = [];
  for (const entry of safeReaddir(agentsDir)) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const filePath = join(agentsDir, entry.name);
    try {
      const raw = readFileSync(filePath, 'utf8');
      const parsed = parseAgentFile(raw);
      agents.push({
        id: `${projectPath}::${parsed.name}`,
        name: parsed.name,
        description: parsed.description,
        tools: parsed.tools,
        model: parsed.model,
        instructions: parsed.systemPrompt,
        projectPath,
        filePath,
      });
    } catch (err) {
      agents.push({
        id: `${projectPath}::${entry.name}`,
        projectPath,
        filePath,
        error: err.message,
      });
    }
  }
  return agents;
}

// Recursively walks `dir` (bounded to MAX_DEPTH levels below the root) looking
// for `.claude/agents` directories. Each one found marks `dir` as a project;
// does not recurse further below a project directory.
function walk(dir, depth, projects) {
  const agentsDir = join(dir, '.claude', 'agents');
  if (isDirectory(agentsDir)) {
    projects.push({
      projectPath: dir,
      projectName: basename(dir),
      agents: scanAgentsDir(agentsDir, dir),
    });
    return;
  }

  if (depth >= MAX_DEPTH) return;

  for (const entry of safeReaddir(dir)) {
    if (!entry.isDirectory() || shouldSkipDir(entry.name)) continue;
    walk(join(dir, entry.name), depth + 1, projects);
  }
}

// Directories that can be enormous and never contain a project worth
// listing: `node_modules` and any dot-directory (`.git`, `.cache`, ...).
// A project's own `.claude/agents` is still found, because it is checked
// directly above rather than reached by recursing into `.claude`.
function shouldSkipDir(name) {
  return name === 'node_modules' || name.startsWith('.');
}

export function scanProjects(roots) {
  const projects = [];
  for (const root of roots) {
    if (!isDirectory(root)) continue;
    walk(root, 0, projects);
  }
  return projects;
}
