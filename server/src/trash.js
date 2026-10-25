import { existsSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';

function trashDir() {
  return process.env.AGENT_PANEL_TRASH_DIR || join(homedir(), '.Trash');
}

/**
 * Moves a file or folder into the user's Trash (deleting from Agent City is
 * always recoverable). A name already in the Trash gets a time suffix, as
 * Finder does. Returns where it went.
 */
export function moveToTrash(path) {
  const name = basename(path);
  let target = join(trashDir(), name);
  if (existsSync(target)) {
    const ext = extname(name);
    const stem = ext ? name.slice(0, -ext.length) : name;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    target = join(trashDir(), `${stem} ${stamp}${ext}`);
  }
  renameSync(path, target);
  return target;
}
