import { spawn } from 'node:child_process';
import os from 'node:os';

const CACHE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 60_000;
const LINE = /^(claude\.ai )?(.+?): .* - (✔ Connected|! Needs authentication|✗ .*)$/;

export function parseMcpList(text) {
  const connectors = [];
  for (const raw of text.split('\n')) {
    const m = LINE.exec(raw.trim());
    if (!m) continue;
    const [, claudeAi, name, state] = m;
    const status = state.startsWith('✔') ? 'connected' : state.startsWith('!') ? 'needs-auth' : 'failed';
    connectors.push({
      name,
      source: claudeAi ? 'claude.ai' : 'local',
      status,
      toolPrefix: claudeAi ? `mcp__claude_ai_${name.replace(/[^A-Za-z0-9]/g, '_')}` : `mcp__${name}`,
    });
  }
  return connectors;
}

export function disallowedToolsFor(disabledNames, connectors) {
  const disabled = new Set(disabledNames);
  return connectors.filter((c) => disabled.has(c.name)).map((c) => c.toolPrefix);
}

function runMcpList() {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['mcp', 'list'], { cwd: os.homedir(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error('Timed out listing connectors'));
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => finish(reject, new Error(`Could not run claude: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) finish(resolve, out);
      else finish(reject, new Error(err.trim() || `claude mcp list exited with code ${code}`));
    });
  });
}

let cache = null; // { at, connectors }
let inFlight = null; // one shared `claude mcp list` at a time

/** Test helper: forgets the cache and any in-flight lookup. */
export function resetConnectorsForTest() {
  cache = null;
  inFlight = null;
}

function refresh(run) {
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const connectors = parseMcpList(await run());
        cache = { at: Date.now(), connectors };
        return { connectors, error: null };
      } catch (e) {
        return { connectors: [], error: e.message };
      } finally {
        inFlight = null;
      }
    })();
  }
  return inFlight;
}

const isFresh = () => cache && Date.now() - cache.at < CACHE_MS;

export async function listConnectors({ fresh = false, run = runMcpList } = {}) {
  if (!fresh && isFresh()) return { connectors: cache.connectors, error: null };
  return refresh(run);
}

/** The prefix a claude.ai connector's tools carry, derived from its name. */
const derivedPrefix = (name) => `mcp__claude_ai_${name.replace(/[^A-Za-z0-9]/g, '_')}`;

/**
 * `--disallowedTools` prefixes for a turn, without making it wait on
 * `claude mcp list`: none needed when nothing is disabled; otherwise the
 * cached connectors (refreshed in the background when stale), or prefixes
 * derived from the names when discovery has never succeeded.
 */
export function disallowedToolsForTurn(disabledNames, { run = runMcpList } = {}) {
  if (disabledNames.length === 0) return [];
  if (!isFresh()) refresh(run);
  if (!cache) return disabledNames.map(derivedPrefix);
  return disallowedToolsFor(disabledNames, cache.connectors);
}
