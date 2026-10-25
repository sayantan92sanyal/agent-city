import { existsSync, statSync } from 'node:fs';
import { extname, isAbsolute, resolve } from 'node:path';

/** File types a chat may show, by extension. */
export const FILE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.html': 'text/html',
};

const WRITE_TOOLS = new Set(['Write', 'Edit']);
// Unwrapped paths stop at whitespace; paths wrapped in backticks, double
// quotes or a markdown link/image target may contain spaces.
const PATHS_IN_TEXT = [
  /(\/[^\s"'`)]+\.(?:png|jpe?g|gif|webp|svg|pdf|html))/gi,
  /`(\/[^`\n]+\.(?:png|jpe?g|gif|webp|svg|pdf|html))`/gi,
  /"(\/[^"\n]+\.(?:png|jpe?g|gif|webp|svg|pdf|html))"/gi,
  /\]\((\/[^)\n]+\.(?:png|jpe?g|gif|webp|svg|pdf|html))\)/gi,
];

function isShowable(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) return false;
  if (!FILE_TYPES[extname(path).toLowerCase()]) return false;
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Absolute paths of showable files Claude wrote or mentioned in a turn's
 * events: `file_path` of Write/Edit tool uses, plus absolute paths in
 * assistant text. Only existing files of an allowed type; de-duplicated.
 * `folder` is the chat's working folder (paths are already absolute, so it is
 * not needed to resolve them).
 */
export function extractFiles(events, folder) {
  const found = [];
  for (const event of events ?? []) {
    if (event?.type !== 'assistant') continue;
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'tool_use' && WRITE_TOOLS.has(block.name)) {
        found.push(block.input?.file_path);
      } else if (block?.type === 'text' && typeof block.text === 'string') {
        for (const pattern of PATHS_IN_TEXT) {
          for (const match of block.text.matchAll(pattern)) found.push(match[1]);
        }
      }
    }
  }
  return [...new Set(found.filter(isShowable).map((p) => resolve(p)))];
}
