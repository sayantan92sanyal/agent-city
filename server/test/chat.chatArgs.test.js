import { test, expect } from 'vitest';
import { buildChatArgs, chatSystemPrompt, CHAT_SYSTEM_PROMPT, CHAT_TOOLS, STE_PROMPT } from '../src/chat/chatArgs.js';

const now = new Date(2026, 9, 25, 15, 30);

test('first turn: session id, effort, stdin input, system prompt, bypass', () => {
  expect(buildChatArgs({ sessionId: 's1', resume: false, model: '', effort: 'high', disallowedTools: [], folder: '/Users/me', now })).toEqual([
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-mode', 'bypassPermissions', '--system-prompt', chatSystemPrompt({ folder: '/Users/me', now }),
    '--system-prompt-snapshot', 'off', '--tools', CHAT_TOOLS.join(','),
    '--effort', 'high', '--session-id', 's1', '--input-format', 'stream-json',
  ]);
});

test('resume, model and blocked connectors', () => {
  const args = buildChatArgs({ sessionId: 's1', resume: true, model: 'opus', effort: 'max', disallowedTools: ['mcp__claude_ai_Gmail'] });
  expect(args).toContain('--resume');
  expect(args).not.toContain('--session-id');
  expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual(['--model', 'opus']);
  expect(args.slice(args.indexOf('--disallowedTools'), args.indexOf('--disallowedTools') + 2)).toEqual(['--disallowedTools', 'mcp__claude_ai_Gmail']);
  expect(args.slice(-2)).toEqual(['--input-format', 'stream-json']);
});

test('multiple blocked connectors are joined into one flag', () => {
  const args = buildChatArgs({ sessionId: 's', resume: false, model: '', effort: 'low', disallowedTools: ['mcp__a', 'mcp__b'] });
  expect(args.filter((a) => a === '--disallowedTools')).toHaveLength(1);
  expect(args[args.indexOf('--disallowedTools') + 1]).toBe('mcp__a,mcp__b');
});

test('accepts the fable model', () => {
  const args = buildChatArgs({ sessionId: 's', resume: false, model: 'fable', effort: 'high', disallowedTools: [] });
  expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual(['--model', 'fable']);
});

test('rejects an unknown effort or model', () => {
  expect(() => buildChatArgs({ sessionId: 's', resume: false, model: 'gpt', effort: 'high', disallowedTools: [] })).toThrow(/model/);
  expect(() => buildChatArgs({ sessionId: 's', resume: false, model: '', effort: 'huge', disallowedTools: [] })).toThrow(/effort/);
});

test('the system prompt sends weather questions to the live Open-Meteo forecast and the weather card', () => {
  expect(CHAT_SYSTEM_PROMPT).toContain('https://api.open-meteo.com/v1/forecast');
  expect(CHAT_SYSTEM_PROMPT).toContain('```weather');
});

test('Simplified Technical English adds the ASD-STE100 rules to the one system prompt', () => {
  const args = buildChatArgs({ sessionId: 's', resume: false, model: '', effort: 'high', disallowedTools: [], folder: '/f', simplifiedEnglish: true, now });
  expect(args.filter((a) => a === '--system-prompt')).toHaveLength(1);
  expect(args).not.toContain('--append-system-prompt');
  const prompt = args[args.indexOf('--system-prompt') + 1];
  expect(prompt.startsWith(CHAT_SYSTEM_PROMPT)).toBe(true);
  expect(prompt.endsWith(STE_PROMPT)).toBe(true);
  expect(STE_PROMPT).toContain('ASD-STE100');
});

test("the system prompt replaces Claude Code's and gives the date, folder and platform", () => {
  const prompt = chatSystemPrompt({ folder: '/Users/me/Documents', now });
  expect(prompt).toContain('You are Claude, made by Anthropic.');
  expect(prompt).toContain('Today is Sunday, October 25, 2026');
  expect(prompt).not.toContain('3:30');
  expect(prompt).toContain('macOS, in the folder /Users/me/Documents');
  expect(prompt).toContain('ToolSearch');
  expect(prompt).not.toContain('ASD-STE100');
});

test('chat gets only the tools a conversation needs, including ToolSearch for connectors', () => {
  expect(CHAT_TOOLS).toEqual(['Bash', 'Read', 'Write', 'WebSearch', 'WebFetch', 'ToolSearch']);
});
