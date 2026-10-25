import { beforeEach, test, expect, vi } from 'vitest';
import {
  disallowedToolsFor,
  disallowedToolsForTurn,
  listConnectors,
  parseMcpList,
  resetConnectorsForTest,
} from '../src/chat/connectors.js';

beforeEach(() => {
  resetConnectorsForTest();
  vi.restoreAllMocks();
});

const SAMPLE = `Checking MCP server health…

claude.ai Google Calendar: https://calendarmcp.googleapis.com/mcp/v1 - ✔ Connected
claude.ai Canva: https://mcp.canva.com/mcp - ! Needs authentication
my-db: npx db-mcp - ✗ Failed to connect
`;

test('parseMcpList reads claude.ai and local servers with status and tool prefix', () => {
  expect(parseMcpList(SAMPLE)).toEqual([
    { name: 'Google Calendar', source: 'claude.ai', status: 'connected', toolPrefix: 'mcp__claude_ai_Google_Calendar' },
    { name: 'Canva', source: 'claude.ai', status: 'needs-auth', toolPrefix: 'mcp__claude_ai_Canva' },
    { name: 'my-db', source: 'local', status: 'failed', toolPrefix: 'mcp__my-db' },
  ]);
});

test('disallowedToolsFor maps disabled names to prefixes and ignores unknown ones', () => {
  expect(disallowedToolsFor(['Canva', 'Nope'], parseMcpList(SAMPLE))).toEqual(['mcp__claude_ai_Canva']);
});

test('listConnectors caches, and reports failures without throwing', async () => {
  const run = vi.fn().mockResolvedValue(SAMPLE);
  await listConnectors({ fresh: true, run });
  await listConnectors({ run });
  expect(run).toHaveBeenCalledTimes(1);
  const failed = await listConnectors({ fresh: true, run: () => Promise.reject(new Error('boom')) });
  expect(failed).toEqual({ connectors: [], error: 'boom' });
});

test('a failed run does not overwrite a good cache', async () => {
  await listConnectors({ fresh: true, run: () => Promise.resolve(SAMPLE) });
  const failed = await listConnectors({ fresh: true, run: () => Promise.reject(new Error('boom')) });
  expect(failed.error).toBe('boom');
  const cached = await listConnectors({ run: () => Promise.reject(new Error('should not run')) });
  expect(cached.error).toBeNull();
  expect(cached.connectors).toHaveLength(3);
});

test('a turn with nothing disabled never runs claude mcp list', () => {
  const run = vi.fn().mockResolvedValue(SAMPLE);
  expect(disallowedToolsForTurn([], { run })).toEqual([]);
  expect(run).not.toHaveBeenCalled();
});

test('concurrent lookups share one claude mcp list', async () => {
  let release;
  const run = vi.fn(() => new Promise((r) => { release = r; }));
  const a = listConnectors({ fresh: true, run });
  const b = listConnectors({ fresh: true, run });
  disallowedToolsForTurn(['Canva'], { run });
  release(SAMPLE);
  const [ra, rb] = await Promise.all([a, b]);
  expect(run).toHaveBeenCalledTimes(1);
  expect(ra).toEqual(rb);
  expect(ra.connectors).toHaveLength(3);
});

test('a stale cache is used at once and refreshed in the background', async () => {
  await listConnectors({ fresh: true, run: () => Promise.resolve(SAMPLE) });
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + 10 * 60 * 1000);
  let release;
  const run = vi.fn(() => new Promise((r) => { release = r; }));
  expect(disallowedToolsForTurn(['Canva'], { run })).toEqual(['mcp__claude_ai_Canva']);
  expect(run).toHaveBeenCalledTimes(1);
  release('claude.ai Canva: https://x - ✔ Connected\n');
  await listConnectors({ run });
  expect((await listConnectors({ run })).connectors).toEqual([
    { name: 'Canva', source: 'claude.ai', status: 'connected', toolPrefix: 'mcp__claude_ai_Canva' },
  ]);
  expect(run).toHaveBeenCalledTimes(1);
});

test('with no discovery yet, disabled names become derived claude.ai prefixes', () => {
  const run = vi.fn(() => Promise.reject(new Error('offline')));
  expect(disallowedToolsForTurn(['Google Calendar', 'Gmail'], { run })).toEqual([
    'mcp__claude_ai_Google_Calendar',
    'mcp__claude_ai_Gmail',
  ]);
  expect(run).toHaveBeenCalledTimes(1);
});
