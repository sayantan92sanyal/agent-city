import { beforeEach, expect, test } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgent, updateAgent, AgentExistsError } from '../src/agentWriter.js';
import { parseAgentFile } from '../src/agentFrontmatter.js';

let tempProject;

beforeEach(() => {
  tempProject = mkdtempSync(join(tmpdir(), 'acp-writer-'));
});

test('createAgent writes a parseable agent file', () => {
  const { filePath } = createAgent(tempProject, {
    name: 'Doc Writer', model: 'sonnet', description: 'Writes docs', tools: ['Read', 'Write'],
  });

  expect(existsSync(filePath)).toBe(true);
  const parsed = parseAgentFile(readFileSync(filePath, 'utf8'));
  expect(parsed.name).toBe('doc-writer');
  expect(parsed.description).toBe('Writes docs');
  expect(parsed.tools).toEqual(['Read', 'Write']);
  expect(parsed.model).toBe('sonnet');
});

test('the written frontmatter name is the slug (same as the filename), not the raw display name', () => {
  const { filePath, name } = createAgent(tempProject, {
    name: 'Code Reviewer', model: 'sonnet', description: 'Reviews code', tools: [],
  });
  const raw = readFileSync(filePath, 'utf8');
  expect(raw).toMatch(/^name: code-reviewer$/m);
  expect(raw).not.toContain('Code Reviewer');
  expect(name).toBe('code-reviewer');
  expect(filePath.endsWith(`${name}.md`)).toBe(true);
});

test('createAgent omits tools and model from the frontmatter when they are empty', () => {
  const { filePath } = createAgent(tempProject, {
    name: 'Bare', model: '', description: 'x', tools: [],
  });
  const raw = readFileSync(filePath, 'utf8');
  expect(raw).not.toMatch(/^tools:/m);
  expect(raw).not.toMatch(/^model:/m);
});

test('createAgent writes the file under <project>/.claude/agents/<slug>.md', () => {
  const { filePath } = createAgent(tempProject, {
    name: 'Doc Writer', model: 'sonnet', description: 'Writes docs', tools: [],
  });
  expect(filePath).toBe(join(tempProject, '.claude', 'agents', 'doc-writer.md'));
});

test('createAgent throws AgentExistsError on duplicate slug', () => {
  createAgent(tempProject, { name: 'Dup', model: 'sonnet', description: 'x', tools: [] });
  expect(() => createAgent(tempProject, { name: 'Dup', model: 'sonnet', description: 'y', tools: [] }))
    .toThrow(AgentExistsError);
});

test('duplicate detection is based on the slug, not the exact name', () => {
  createAgent(tempProject, { name: 'My Agent', model: 'sonnet', description: 'x', tools: [] });
  expect(() => createAgent(tempProject, { name: 'my   agent', model: 'sonnet', description: 'y', tools: [] }))
    .toThrow(AgentExistsError);
});

test('names with unicode and punctuation produce a safe ascii slug', () => {
  const { filePath } = createAgent(tempProject, {
    name: 'Café Résumé™ Agent!!', model: 'sonnet', description: 'x', tools: [],
  });
  expect(filePath).toBe(join(tempProject, '.claude', 'agents', 'caf-r-sum-agent.md'));
});

test('path-traversal-like names are confined to the project agents directory', () => {
  const { filePath } = createAgent(tempProject, {
    name: '../../etc/passwd', model: 'sonnet', description: 'x', tools: [],
  });
  const agentsDir = join(tempProject, '.claude', 'agents');
  expect(filePath.startsWith(agentsDir)).toBe(true);
  expect(existsSync(filePath)).toBe(true);
});

test('a very long name is truncated to a reasonable slug length', () => {
  const longName = 'a'.repeat(300);
  const { filePath } = createAgent(tempProject, {
    name: longName, model: 'sonnet', description: 'x', tools: [],
  });
  const slug = filePath.split('/').pop().replace(/\.md$/, '');
  expect(slug.length).toBeLessThanOrEqual(100);
});

test('an empty or entirely-punctuation name falls back to a default slug', () => {
  const { filePath } = createAgent(tempProject, {
    name: '!!!', model: 'sonnet', description: 'x', tools: [],
  });
  expect(filePath).toBe(join(tempProject, '.claude', 'agents', 'agent.md'));
});

test('createAgent writes instructions as the file body', () => {
  const { filePath } = createAgent(tempProject, {
    name: 'Reviewer', model: 'sonnet', description: 'Reviews drafts', tools: ['WebSearch'],
    instructions: 'You are an editor.\n\n## Steps\n1. Read the draft.',
  });
  expect(parseAgentFile(readFileSync(filePath, 'utf8')).systemPrompt).toBe('You are an editor.\n\n## Steps\n1. Read the draft.');
});

test('updateAgent rewrites description, instructions and tools, keeping other settings', () => {
  const filePath = join(tempProject, 'reviewer.md');
  writeFileSync(filePath, '---\nname: reviewer\ndescription: Old\ntools: Agent\nmodel: opus\ncolor: blue\n---\nOld body\n');
  updateAgent(filePath, { description: 'New description', instructions: 'New body', tools: ['WebSearch', 'Read'] });
  const raw = readFileSync(filePath, 'utf8');
  expect(parseAgentFile(raw)).toEqual({
    name: 'reviewer', description: 'New description', tools: ['WebSearch', 'Read'], model: 'opus', systemPrompt: 'New body',
  });
  expect(raw).toContain('color: blue');

  updateAgent(filePath, { description: 'D', instructions: 'B', tools: [] });
  expect(readFileSync(filePath, 'utf8')).not.toContain('tools:');
});
