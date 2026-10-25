import { beforeEach, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanProjects } from '../src/agentScanner.js';

const validAgent = `---
name: reviewer
description: Reviews code
tools: Read, Grep
model: sonnet
---
You review code.
`;

const malformedAgent = `---javascript
globalThis.x = 1;
---
Body
`;

let tempRoot;
let projectAPath;
let projectBPath;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'acp-scanner-'));
  projectAPath = join(tempRoot, 'projectA');
  projectBPath = join(tempRoot, 'projectB');

  mkdirSync(join(projectAPath, '.claude', 'agents'), { recursive: true });
  mkdirSync(join(projectBPath, '.claude', 'agents'), { recursive: true });

  writeFileSync(join(projectAPath, '.claude', 'agents', 'reviewer.md'), validAgent);
  writeFileSync(join(projectBPath, '.claude', 'agents', 'reviewer.md'), validAgent);
  writeFileSync(join(projectBPath, '.claude', 'agents', 'broken.md'), malformedAgent);
});

test('finds agents grouped by project', () => {
  const projects = scanProjects([tempRoot]);
  expect(projects.map((p) => p.projectPath).sort()).toEqual([projectAPath, projectBPath].sort());
});

test('two projects can each have an agent with the same name without id collision', () => {
  const projects = scanProjects([tempRoot]);
  const ids = projects.flatMap((p) => p.agents.map((a) => a.id));
  expect(new Set(ids).size).toBe(ids.length);
});

test('a malformed agent file is reported with an error, not thrown', () => {
  const projects = scanProjects([tempRoot]);
  const projectB = projects.find((p) => p.projectPath === projectBPath);
  const broken = projectB.agents.find((a) => a.error);
  expect(broken).toBeTruthy();
  expect(broken.name).toBeUndefined();
  expect(broken.tools).toBeUndefined();
  expect(broken.model).toBeUndefined();
});

test('a root that does not exist is skipped without throwing', () => {
  expect(() => scanProjects(['/no/such/path', tempRoot])).not.toThrow();
  const projects = scanProjects(['/no/such/path', tempRoot]);
  expect(projects.map((p) => p.projectPath).sort()).toEqual([projectAPath, projectBPath].sort());
});

test('valid agent entry has expected fields', () => {
  const projects = scanProjects([tempRoot]);
  const projectA = projects.find((p) => p.projectPath === projectAPath);
  expect(projectA.projectName).toBe('projectA');
  expect(projectA.agents).toEqual([
    {
      id: `${projectAPath}::reviewer`,
      name: 'reviewer',
      description: 'Reviews code',
      tools: ['Read', 'Grep'],
      model: 'sonnet',
      instructions: 'You review code.',
      projectPath: projectAPath,
      filePath: join(projectAPath, '.claude', 'agents', 'reviewer.md'),
    },
  ]);
});

test('does not descend into node_modules or dot-directories', () => {
  const skipped = [
    join(tempRoot, 'node_modules', 'some-pkg'),
    join(tempRoot, '.git', 'nested'),
    join(tempRoot, '.cache', 'nested'),
    join(tempRoot, 'projectC', 'node_modules', 'dep'),
  ];
  for (const dir of skipped) {
    mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'agents', 'reviewer.md'), validAgent);
  }

  const paths = scanProjects([tempRoot]).map((p) => p.projectPath);
  for (const dir of skipped) {
    expect(paths).not.toContain(dir);
  }
  // Regular projects (whose own `.claude/agents` is found directly) still are.
  expect(paths.sort()).toEqual([projectAPath, projectBPath].sort());
});

test('does not descend into a project deeper than the depth bound', () => {
  const deepPath = join(
    tempRoot,
    'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'tooDeep',
  );
  mkdirSync(join(deepPath, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(deepPath, '.claude', 'agents', 'reviewer.md'), validAgent);

  const projects = scanProjects([tempRoot]);
  expect(projects.some((p) => p.projectPath === deepPath)).toBe(false);
});
