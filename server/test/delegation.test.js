import { beforeEach, expect, test } from 'vitest';
import { createDelegationTracker } from '../src/delegation.js';
import { activeLinks, clearLinks } from '../src/links.js';

const from = { id: '/p::strategy', projectPath: '/p' };
const toolUse = (name, id = 'toolu_1', input = { subagent_type: 'growth', description: 'do growth things' }) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id, name, input }] },
});
const toolResult = (id = 'toolu_1') => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'done' }] },
});

beforeEach(() => clearLinks());

test('Agent tool_use starts a link and tool_result ends it', () => {
  const t = createDelegationTracker({ fromAgent: from });
  t.onEvent(toolUse('Agent'));
  expect(activeLinks()).toMatchObject([{ from: '/p::strategy', to: '/p::growth', label: 'do growth things' }]);
  t.onEvent(toolResult());
  expect(activeLinks()).toEqual([]);
});

test('Task name also works', () => {
  const t = createDelegationTracker({ fromAgent: from });
  t.onEvent(toolUse('Task'));
  expect(activeLinks()).toHaveLength(1);
});

test('other tools and missing subagent_type are ignored', () => {
  const t = createDelegationTracker({ fromAgent: from });
  t.onEvent(toolUse('Read'));
  t.onEvent(toolUse('Agent', 'toolu_2', { description: 'x' }));
  expect(activeLinks()).toEqual([]);
});

test('close ends dangling links', () => {
  const t = createDelegationTracker({ fromAgent: from });
  t.onEvent(toolUse('Agent'));
  t.close();
  expect(activeLinks()).toEqual([]);
});
