import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function configDir() {
  return process.env.AGENT_PANEL_HOME || join(homedir(), '.agent-control-panel');
}

function configFile() {
  return join(configDir(), 'config.json');
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((r) => typeof r === 'string');
}

// Malformed or unexpectedly shaped files are treated the same as "no config yet".
export function getRoots() {
  const file = configFile();
  if (!existsSync(file)) return [];
  try {
    const roots = JSON.parse(readFileSync(file, 'utf8'))?.roots;
    return isStringArray(roots) ? roots : [];
  } catch {
    return [];
  }
}

// Write to a temp file and rename it into place so readers never see a partial file.
export function setRoots(roots) {
  mkdirSync(configDir(), { recursive: true });
  const file = configFile();
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ roots }, null, 2));
  renameSync(tmp, file);
}
