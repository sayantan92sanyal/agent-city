import { test, expect } from 'vitest';
import { describeEntry, formatTranscript, speakerLabel } from './transcriptFormat.js';

// Shapes taken from real `claude -p --output-format stream-json --verbose` output.
const initEvent = { type: 'system', subtype: 'init', session_id: 's1', tools: ['Read'], model: 'claude' };
const assistantText = {
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'there' }] },
};
const assistantToolUse = {
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x' } }] },
};
const toolResult = {
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file contents' }] },
};
const resultEvent = { type: 'result', subtype: 'success', is_error: false, result: 'Hello there' };

test('assistant events render the concatenated text blocks from message.content', () => {
  expect(describeEntry(assistantText)).toEqual({ kind: 'assistant', text: 'Hello there' });
});

test('system/init events are hidden', () => {
  expect(describeEntry(initEvent)).toBeNull();
});

test('raw tool-result (user) events are hidden, never dumped as JSON', () => {
  expect(describeEntry(toolResult)).toBeNull();
});

test('an assistant tool_use with no text collapses to a one-line summary', () => {
  expect(describeEntry(assistantToolUse)).toEqual({ kind: 'tool', text: '[used Read]' });
});

test('a result event renders its result text', () => {
  expect(describeEntry(resultEvent)).toEqual({ kind: 'assistant', text: 'Hello there' });
});

test('an error result event renders as an error', () => {
  expect(describeEntry({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '' }))
    .toEqual({ kind: 'error', text: 'Error: error_during_execution' });
});

test('the user\'s own message renders as a user row', () => {
  expect(describeEntry({ type: 'user_message', text: 'hi' })).toEqual({ kind: 'user', text: 'hi' });
});

test('app error entries render their error text', () => {
  expect(describeEntry({ type: 'error', error: 'claude exited with code 1: bad flag' }))
    .toEqual({ kind: 'error', text: 'Error: claude exited with code 1: bad flag' });
});

test('unknown event types are hidden rather than shown as raw JSON', () => {
  expect(describeEntry({ type: 'rate_limit_event', foo: 1 })).toBeNull();
});

test('simple entries carrying a top-level text still render', () => {
  expect(describeEntry({ type: 'message', text: 'legacy' })).toEqual({ kind: 'assistant', text: 'legacy' });
});

test('formatTranscript renders a full real turn as a readable back-and-forth', () => {
  const rows = formatTranscript([
    { type: 'user_message', text: 'say hello' },
    initEvent,
    assistantToolUse,
    toolResult,
    assistantText,
    resultEvent,
  ]);
  expect(rows).toEqual([
    { kind: 'user', text: 'say hello' },
    { kind: 'tool', text: '[used Read]' },
    { kind: 'assistant', text: 'Hello there' },
  ]);
  expect(JSON.stringify(rows)).not.toContain('session_id');
});

test('formatTranscript keeps a result whose text differs from the last assistant text', () => {
  const rows = formatTranscript([assistantText, { ...resultEvent, result: 'Different summary' }]);
  expect(rows.map((r) => r.text)).toEqual(['Hello there', 'Different summary']);
});

const askCall = {
  type: 'assistant',
  message: {
    content: [
      { type: 'tool_use', id: 'toolu_a', name: 'mcp__city__ask_agent', input: { agent_id: '/p/proj::growth', message: 'How many users?' } },
    ],
  },
};
const askResult = {
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_a', content: [{ type: 'text', text: 'About ' }, { type: 'text', text: '40' }] }] },
};

test('ask_agent call and result render with MAYOR arrow speakers', () => {
  const rows = formatTranscript([askCall, askResult]);
  expect(rows).toEqual([
    { kind: 'bridge', speaker: 'MAYOR → growth', text: 'How many users?' },
    { kind: 'bridge', speaker: 'growth → MAYOR', text: 'About 40' },
  ]);
  expect(speakerLabel('bridge', rows[0])).toBe('MAYOR → growth');
});

test('ask_agent string results work', () => {
  const rows = formatTranscript([
    askCall,
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_a', content: 'plain' }] } },
  ]);
  expect(rows[1]).toEqual({ kind: 'bridge', speaker: 'growth → MAYOR', text: 'plain' });
});

test('list_agents calls and results are hidden', () => {
  const rows = formatTranscript([
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_l', name: 'mcp__city__list_agents', input: {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_l', content: 'a, b' }] } },
  ]);
  expect(rows).toEqual([]);
});

test('unmatched tool results stay hidden as before', () => {
  expect(formatTranscript([toolResult])).toEqual([]);
});

test('speakerLabel names each speaker, and leaves error rows unlabelled', () => {
  expect(speakerLabel('user')).toBe('You');
  expect(speakerLabel('assistant')).toBe('Agent');
  expect(speakerLabel('error')).toBe('');
});

test('speakerLabel accepts an assistant label override', () => {
  expect(speakerLabel('assistant', undefined, 'MAYOR')).toBe('MAYOR');
  expect(speakerLabel('user', undefined, 'MAYOR')).toBe('You');
});

test('ToolSearch tool uses are hidden', () => {
  const rows = formatTranscript([
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'ToolSearch', input: {} }] } },
  ]);
  expect(rows).toEqual([]);
});

test('stopped and interrupted entries become note rows', () => {
  expect(formatTranscript([{ type: 'user_message', text: 'hi' }, { type: 'stopped' }, { type: 'interrupted' }])).toEqual([
    { kind: 'user', text: 'hi' },
    { kind: 'note', text: 'Stopped.' },
    { kind: 'note', text: 'Interrupted — the app restarted before Claude finished.' },
  ]);
  expect(speakerLabel('note')).toBe('');
});

test('chat_files becomes a files row; claude.ai tool names are friendly', () => {
  const files = [{ path: '/a.png', name: 'a.png', mediaType: 'image/png' }];
  expect(describeEntry({ type: 'chat_files', files })).toEqual({ kind: 'files', files });
  const tool = (name) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name }] } });
  expect(describeEntry(tool('mcp__claude_ai_Google_Calendar__list_calendars')).text).toBe('[used Google Calendar · list calendars]');
  expect(describeEntry(tool('Bash')).text).toBe('[used Bash]');
});

test('a local model reply is labelled with that model, not Claude', () => {
  const rows = formatTranscript([
    { type: 'assistant', message: { model: 'Llama 3.2 3B · local', content: [{ type: 'text', text: 'Hi' }] } },
    { type: 'assistant', message: { model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Hello' }] } },
  ]);
  expect(speakerLabel('assistant', rows[0], 'Claude')).toBe('Llama 3.2 3B · local');
  expect(speakerLabel('assistant', rows[1], 'Claude')).toBe('Claude');
});
