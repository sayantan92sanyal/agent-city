import { test, expect, vi } from 'vitest';
import { AGENT_TOOLS, DraftError, buildDraftArgs, draftAgent, draftPrompt } from '../src/agentDraft.js';

// A fake runClaude that emits the given result event and exits.
function runnerReturning(resultEvent, exitCode = 0) {
  const calls = [];
  const fn = vi.fn((options, onEvent) => {
    calls.push(options);
    if (resultEvent) onEvent(resultEvent);
    return { kill: vi.fn(), done: Promise.resolve({ exitCode, stderr: exitCode ? 'boom' : '' }) };
  });
  return { fn, calls };
}

const structured = {
  description: 'Reviews article drafts as an editor in chief. Use when the user shares a draft.',
  instructions: 'You are an editor in chief.\n\n## Steps\n1. Read the draft.',
  tools: ['WebSearch', 'WebFetch', 'Read'],
};

test('buildDraftArgs: schema-checked output, web tools only, no saved session', () => {
  const args = buildDraftArgs();
  expect(args.slice(0, 4)).toEqual(['-p', '--output-format', 'stream-json', '--verbose']);
  expect(args[args.indexOf('--tools') + 1]).toBe('WebSearch,WebFetch');
  expect(args).toContain('--no-session-persistence');
  const schema = JSON.parse(args[args.indexOf('--json-schema') + 1]);
  expect(schema.required).toEqual(['description', 'instructions', 'tools']);
  expect(schema.properties.tools.items.enum).toEqual(AGENT_TOOLS);
  expect(args.slice(-2)).toEqual(['--input-format', 'stream-json']);
});

test('draftPrompt includes the name and brief, and the current file when improving', () => {
  const fresh = draftPrompt({ name: 'article-reviewer', brief: 'Review my drafts' });
  expect(fresh).toContain('article-reviewer');
  expect(fresh).toContain('Review my drafts');
  expect(fresh).not.toContain('Current instructions');

  const improve = draftPrompt({
    name: 'article-reviewer',
    brief: 'Review my drafts',
    current: { instructions: 'Old body', tools: ['Agent'] },
  });
  expect(improve).toContain('Current instructions');
  expect(improve).toContain('Old body');
  expect(improve).toContain('Agent');
});

test('draftAgent returns the structured draft, dropping unknown tools', async () => {
  const { fn, calls } = runnerReturning({
    type: 'result',
    subtype: 'success',
    structured_output: { ...structured, tools: ['WebSearch', 'Teleport', 'Read'] },
  });
  const draft = await draftAgent({ name: 'article-reviewer', brief: 'Review my drafts' }, { runClaudeFn: fn });
  expect(draft).toEqual({ ...structured, tools: ['WebSearch', 'Read'] });
  const line = JSON.parse(calls[0].input);
  expect(line.message.content[0].text).toContain('Review my drafts');
});

test('draftAgent fails clearly when Claude errors or returns no draft', async () => {
  await expect(draftAgent({ name: 'x', brief: 'y' }, { runClaudeFn: runnerReturning(null, 1).fn })).rejects.toThrow(DraftError);
  const empty = runnerReturning({ type: 'result', subtype: 'success', structured_output: { description: '', instructions: 'x', tools: [] } });
  await expect(draftAgent({ name: 'x', brief: 'y' }, { runClaudeFn: empty.fn })).rejects.toThrow(/empty/);
});
