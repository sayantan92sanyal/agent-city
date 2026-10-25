import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function stateDir() {
  const home = process.env.AGENT_PANEL_HOME || join(homedir(), '.agent-control-panel');
  return join(home, 'state');
}

// Agent ids look like "<projectPath>::<name>" and can contain slashes, colons,
// and spaces, none of which are safe to use directly as a filename.
function sessionFile(agentId) {
  return join(stateDir(), `${encodeURIComponent(agentId)}.json`);
}

// Returns null when nothing has been saved yet for this agent, or when the
// file is missing/unreadable/malformed — treated the same as "no session".
export function loadSession(agentId) {
  const file = sessionFile(agentId);
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (!data || typeof data.sessionId !== 'string' || !Array.isArray(data.transcript)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

// Write to a temp file and rename it into place so readers never see a partial file.
export function saveSession(agentId, data) {
  mkdirSync(stateDir(), { recursive: true });
  const file = sessionFile(agentId);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}
