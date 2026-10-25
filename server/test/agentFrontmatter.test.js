import { expect, test } from 'vitest';
import { parseAgentFile, serializeAgentFile } from '../src/agentFrontmatter.js';

const raw = `---
name: code-reviewer
description: Reviews pull requests for bugs
tools: Read, Grep, Bash
model: sonnet
---
You are a careful code reviewer.
`;

test('parseAgentFile extracts frontmatter and body', () => {
  const agent = parseAgentFile(raw);
  expect(agent).toEqual({
    name: 'code-reviewer',
    description: 'Reviews pull requests for bugs',
    tools: ['Read', 'Grep', 'Bash'],
    model: 'sonnet',
    systemPrompt: 'You are a careful code reviewer.',
  });
});

test('serializeAgentFile round-trips through parseAgentFile', () => {
  const agent = parseAgentFile(raw);
  expect(parseAgentFile(serializeAgentFile(agent))).toEqual(agent);
});

test('parseAgentFile returns empty defaults for missing frontmatter fields', () => {
  const agent = parseAgentFile('---\nname: bare\n---\nBody\n');
  expect(agent).toEqual({
    name: 'bare',
    description: '',
    tools: [],
    model: '',
    systemPrompt: 'Body',
  });
});

test('parseAgentFile trims whitespace around tool names and drops empty entries', () => {
  const agent = parseAgentFile('---\nname: a\ntools: " Read ,, Grep ,"\n---\n');
  expect(agent.tools).toEqual(['Read', 'Grep']);
});

const probe = '__agentFrontmatterProbe';

function expectNoProbe(fn) {
  try {
    expect(fn).toThrow();
    expect(globalThis[probe]).toBeUndefined();
  } finally {
    delete globalThis[probe];
  }
}

test.each(['javascript', 'js'])(
  'parseAgentFile rejects %s front matter without executing it',
  (lang) => {
    const raw = `---${lang}\nglobalThis.${probe} = 'executed';\n---\nBody\n`;
    expectNoProbe(() => parseAgentFile(raw));
  },
);

test.each(['javascript', 'js'])(
  'serializeAgentFile rejects a %s systemPrompt without executing it',
  (lang) => {
    const agent = {
      name: 'a',
      description: 'd',
      tools: [],
      model: '',
      systemPrompt: `---${lang}\nglobalThis.${probe} = 'executed';\n---\nBody`,
    };
    expectNoProbe(() => serializeAgentFile(agent));
  },
);

test('parseAgentFile rejects json front matter', () => {
  expect(() => parseAgentFile('---json\n{"name": "j"}\n---\nBody\n')).toThrow();
});

test('parseAgentFile rejects unregistered front matter languages', () => {
  expect(() => parseAgentFile('---coffee\nname: c\n---\nBody\n')).toThrow();
});

test('parseAgentFile still accepts explicit yaml front matter', () => {
  expect(parseAgentFile('---yaml\nname: y\n---\nBody\n').name).toBe('y');
});

test('serializeAgentFile omits the tools and model keys entirely when they are empty', () => {
  const out = serializeAgentFile({
    name: 'a',
    description: 'd',
    tools: [],
    model: '',
    systemPrompt: 'Hi',
  });
  expect(out).not.toMatch(/^tools:/m);
  expect(out).not.toMatch(/^model:/m);
  expect(out).toMatch(/^name: a$/m);
  expect(out).toMatch(/^description: d$/m);
  const parsed = parseAgentFile(out);
  expect(parsed.tools).toEqual([]);
  expect(parsed.model).toBe('');
});

test('serializeAgentFile writes tools as a comma-separated string', () => {
  const out = serializeAgentFile({
    name: 'a',
    description: 'd',
    tools: ['Read', 'Grep'],
    model: 'haiku',
    systemPrompt: 'Hi',
  });
  expect(out).toContain('Read, Grep');
  expect(parseAgentFile(out).tools).toEqual(['Read', 'Grep']);
});
