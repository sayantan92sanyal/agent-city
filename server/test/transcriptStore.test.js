import { beforeEach, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSession, saveSession } from '../src/transcriptStore.js';

beforeEach(() => {
  process.env.AGENT_PANEL_HOME = mkdtempSync(join(tmpdir(), 'acp-state-'));
});

test('loadSession returns null when nothing has been saved for the agent', () => {
  expect(loadSession('/some/project::agent')).toBeNull();
});

test('saveSession then loadSession round-trips sessionId and transcript', () => {
  const data = { sessionId: 'abc-123', transcript: [{ type: 'message', text: 'hi' }] };
  saveSession('/some/project::agent', data);
  expect(loadSession('/some/project::agent')).toEqual(data);
});

test('agent ids containing slashes and colons are stored safely (no crash, round-trips)', () => {
  const id = '/Users/me/projects/foo::my agent';
  const data = { sessionId: 'xyz', transcript: [] };
  saveSession(id, data);
  expect(loadSession(id)).toEqual(data);
});

test('sessions for different agent ids do not collide', () => {
  saveSession('a::one', { sessionId: 's1', transcript: [] });
  saveSession('a::two', { sessionId: 's2', transcript: [] });
  expect(loadSession('a::one').sessionId).toBe('s1');
  expect(loadSession('a::two').sessionId).toBe('s2');
});
