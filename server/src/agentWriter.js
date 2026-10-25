import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serializeAgentFile, updateAgentFile } from './agentFrontmatter.js';

export class AgentExistsError extends Error {
  constructor(slug) {
    super(`an agent with slug "${slug}" already exists`);
    this.name = 'AgentExistsError';
    this.slug = slug;
  }
}

// Converts an arbitrary agent name into a filesystem-safe slug: lowercase,
// alphanumerics only, dash-separated. Anything else (unicode letters,
// punctuation, path separators like `/` or `..`, whitespace) collapses to a
// single `-`, so the resulting slug can never contain a path separator and
// cannot escape the project's `.claude/agents` directory. Long names are
// truncated to keep file names reasonable.
function slugify(name) {
  const slug = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/g, '');
  return slug || 'agent';
}

export function createAgent(projectPath, { name, model, description, tools, instructions = '' }) {
  const slug = slugify(name);
  const agentsDir = join(projectPath, '.claude', 'agents');
  mkdirSync(agentsDir, { recursive: true });
  const filePath = join(agentsDir, `${slug}.md`);

  // The frontmatter `name` is what `claude --agent <name>` resolves against,
  // and Claude Code's convention is a lowercase-hyphenated identifier, so the
  // slug (also used for the filename) is written rather than the raw display
  // name.
  const content = serializeAgentFile({
    name: slug,
    description,
    tools: tools ?? [],
    model,
    systemPrompt: instructions,
  });

  try {
    // 'wx' fails atomically if the file already exists, avoiding a
    // check-then-write race against a concurrent createAgent call.
    writeFileSync(filePath, content, { flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') {
      throw new AgentExistsError(slug);
    }
    throw err;
  }

  return { filePath, name: slug };
}

/** Saves a reviewed draft over an existing agent file. */
export function updateAgent(filePath, { description, instructions, tools }) {
  const raw = readFileSync(filePath, 'utf8');
  writeFileSync(filePath, updateAgentFile(raw, { description, systemPrompt: instructions, tools }));
}
