import { expect, test } from 'vitest';
import { buildStartArgs, buildResumeArgs, buildOneOffArgs, buildMayorArgs } from '../src/cliArgs.js';

test('buildMayorArgs pins exact flags for start and resume', () => {
  const base = { mcpConfigPath: '/m/mcp.json', addDirs: ['/a', '/b'], systemPrompt: 'SYS', message: 'hi', sessionId: 'sid' };
  const head = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions',
    '--mcp-config', '/m/mcp.json', '--append-system-prompt', 'SYS', '--add-dir', '/a', '--add-dir', '/b'];
  expect(buildMayorArgs({ ...base, resume: false })).toEqual([...head, '--session-id', 'sid', '--', 'hi']);
  expect(buildMayorArgs({ ...base, resume: true })).toEqual([...head, '--resume', 'sid', '--', 'hi']);
});

test('buildStartArgs pins exact flags', () => {
  expect(buildStartArgs({ agentName: 'reviewer', tools: ['Read', 'Bash'], sessionId: 'uuid-1', message: 'hi' }))
    .toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--agent', 'reviewer',
              '--tools', 'Read,Bash', '--permission-mode', 'bypassPermissions',
              '--session-id', 'uuid-1', '--', 'hi']);
});

test('buildResumeArgs uses --resume instead of --session-id', () => {
  expect(buildResumeArgs({ agentName: 'reviewer', tools: ['Read'], sessionId: 'uuid-1', message: 'go on' }))
    .toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--agent', 'reviewer',
              '--tools', 'Read', '--permission-mode', 'bypassPermissions',
              '--resume', 'uuid-1', '--', 'go on']);
});

test('buildOneOffArgs adds --no-session-persistence and no session id', () => {
  expect(buildOneOffArgs({ agentName: 'reviewer', tools: ['Read'], message: 'task' }))
    .toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--agent', 'reviewer',
              '--tools', 'Read', '--permission-mode', 'bypassPermissions',
              '--no-session-persistence', '--', 'task']);
});

test('all builders always include --verbose (required by -p + stream-json)', () => {
  const builders = [
    buildStartArgs({ agentName: 'a', tools: [], sessionId: 's', message: 'm' }),
    buildResumeArgs({ agentName: 'a', tools: [], sessionId: 's', message: 'm' }),
    buildOneOffArgs({ agentName: 'a', tools: [], message: 'm' }),
  ];
  for (const args of builders) {
    expect(args).toContain('--verbose');
  }
});

test('an empty tools list omits --tools entirely (inherit the default set) in every builder', () => {
  expect(buildStartArgs({ agentName: 'reviewer', tools: [], sessionId: 'uuid-1', message: 'hi' }))
    .toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--agent', 'reviewer',
              '--permission-mode', 'bypassPermissions', '--session-id', 'uuid-1', '--', 'hi']);
  expect(buildResumeArgs({ agentName: 'reviewer', tools: [], sessionId: 'uuid-1', message: 'hi' }))
    .toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--agent', 'reviewer',
              '--permission-mode', 'bypassPermissions', '--resume', 'uuid-1', '--', 'hi']);
  expect(buildOneOffArgs({ agentName: 'reviewer', tools: [], message: 'hi' }))
    .toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--agent', 'reviewer',
              '--permission-mode', 'bypassPermissions', '--no-session-persistence', '--', 'hi']);
});

test('undefined tools is treated like an empty list', () => {
  expect(buildOneOffArgs({ agentName: 'reviewer', tools: undefined, message: 'hi' }))
    .not.toContain('--tools');
});

test('never passes --allowedTools', () => {
  expect(buildOneOffArgs({ agentName: 'r', tools: ['Read'], message: 'hi' })).not.toContain('--allowedTools');
});

test('a message starting with "-" comes after a literal "--" so it is positional', () => {
  const args = buildOneOffArgs({ agentName: 'r', tools: ['Read'], message: '--help me' });
  expect(args.slice(-2)).toEqual(['--', '--help me']);
});

test('a null message switches every builder to stream-json stdin input', () => {
  const tail = ['--input-format', 'stream-json'];
  expect(buildStartArgs({ agentName: 'a', tools: [], sessionId: 's', message: null }).slice(-2)).toEqual(tail);
  expect(buildResumeArgs({ agentName: 'a', tools: [], sessionId: 's', message: null }).slice(-2)).toEqual(tail);
  expect(buildOneOffArgs({ agentName: 'a', tools: [], message: null }).slice(-2)).toEqual(tail);
  const mayor = buildMayorArgs({ sessionId: 's', resume: false, message: null, mcpConfigPath: '/m', addDirs: [], systemPrompt: 'S' });
  expect(mayor.slice(-2)).toEqual(tail);
  expect(mayor).not.toContain('--');
});
