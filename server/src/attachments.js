import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';

/**
 * Files the user attaches to a message: any file type.
 *
 * Each upload is stored once under `<home>/attachments/<uuid><ext>` and the
 * transcript keeps only its metadata `{ id, name, mediaType, size }`. When a
 * message is sent, the files are read back and handed to `claude` as content
 * blocks on stdin (`--input-format stream-json`), so the model sees images
 * and PDFs directly — no file tools needed by the agent. Word, RTF and
 * OpenDocument files arrive as their text (converted with macOS `textutil`);
 * any other file is named with its saved path for Claude to open with tools.
 */

export class AttachmentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AttachmentError';
  }
}

export const MAX_ATTACHMENTS = 10;

const IMAGE_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
// Converted document text beyond this is cut; Claude can still open the file.
const MAX_DOCUMENT_CHARS = 200_000;

// Formats macOS `textutil` turns into plain text.
const DOCUMENT_EXTENSIONS = new Set(['.docx', '.doc', '.rtf', '.odt']);

// Browsers report many text formats as '' or application/octet-stream, so
// text files are also recognised by extension.
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.yaml', '.yml', '.xml', '.html', '.css',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.py', '.rb', '.go', '.rs', '.java', '.c', '.h', '.cpp',
  '.sh', '.sql', '.toml', '.ini', '.log',
]);

const ID_PATTERN = /^[0-9a-f-]{36}$/;

function attachmentsDir() {
  const home = process.env.AGENT_PANEL_HOME || join(homedir(), '.agent-control-panel');
  return join(home, 'attachments');
}

/** 'image' | 'pdf' | 'text' | 'document' (Word and the like) | 'file' (anything else). */
export function attachmentKind(name, mediaType) {
  if (IMAGE_TYPES[mediaType]) return 'image';
  if (mediaType === 'application/pdf') return 'pdf';
  const ext = extname(String(name ?? '')).toLowerCase();
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  if (typeof mediaType === 'string' && (mediaType.startsWith('text/') || mediaType === 'application/json')) {
    return 'text';
  }
  return TEXT_EXTENSIONS.has(ext) ? 'text' : 'file';
}

// Documents and other files keep their own extension (so tools recognise
// them), reduced to plain letters and digits; anything odd becomes .bin.
function extensionFor(kind, mediaType, name) {
  if (kind === 'image') return IMAGE_TYPES[mediaType];
  if (kind === 'pdf') return '.pdf';
  if (kind === 'text') return '.txt';
  const ext = extname(String(name ?? '')).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '.bin';
}

function storedMediaType(kind, mediaType) {
  if (kind === 'text') return 'text/plain';
  return mediaType || 'application/octet-stream';
}

function findFile(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
  for (const ext of [...Object.values(IMAGE_TYPES), '.pdf', '.txt']) {
    const file = join(attachmentsDir(), `${id}${ext}`);
    if (existsSync(file)) return file;
  }
  const other = existsSync(attachmentsDir())
    ? readdirSync(attachmentsDir()).find((entry) => entry.startsWith(`${id}.`))
    : undefined;
  return other ? join(attachmentsDir(), other) : null;
}

function documentText(file) {
  try {
    const text = execFileSync('textutil', ['-convert', 'txt', '-stdout', file], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 30_000,
    });
    return text.length > MAX_DOCUMENT_CHARS ? `${text.slice(0, MAX_DOCUMENT_CHARS)}\n[…cut; open the file for the rest]` : text;
  } catch {
    return null;
  }
}

/**
 * Validates and stores uploads of the shape `{ name, mediaType, data }`
 * (`data` is base64). Returns their metadata. Throws AttachmentError with a
 * user-facing reason for anything unsupported or too large.
 * @param {unknown} uploads
 * @returns {Array<{id: string, name: string, mediaType: string, size: number}>}
 */
export function saveAttachments(uploads) {
  if (uploads === undefined || uploads === null) return [];
  if (!Array.isArray(uploads)) throw new AttachmentError('attachments must be an array');
  if (uploads.length > MAX_ATTACHMENTS) {
    throw new AttachmentError(`At most ${MAX_ATTACHMENTS} attachments per message`);
  }

  const prepared = uploads.map((upload) => {
    const { name, mediaType, data } = upload ?? {};
    if (typeof name !== 'string' || !name || typeof data !== 'string') {
      throw new AttachmentError('Each attachment needs a name and base64 data');
    }
    const kind = attachmentKind(name, mediaType);
    const bytes = Buffer.from(data, 'base64');
    const limit = { image: MAX_IMAGE_BYTES, pdf: MAX_PDF_BYTES, text: MAX_TEXT_BYTES }[kind] ?? MAX_FILE_BYTES;
    if (bytes.length === 0) throw new AttachmentError(`"${name}" is empty`);
    if (bytes.length > limit) {
      throw new AttachmentError(`"${name}" is too large (max ${Math.round(limit / 1024 / 1024)} MB for this type)`);
    }
    return { name: name.slice(0, 200), kind, mediaType: storedMediaType(kind, mediaType), bytes };
  });

  mkdirSync(attachmentsDir(), { recursive: true });
  return prepared.map(({ name, kind, mediaType, bytes }) => {
    const id = randomUUID();
    writeFileSync(join(attachmentsDir(), `${id}${extensionFor(kind, mediaType, name)}`), bytes);
    return { id, name, mediaType, size: bytes.length };
  });
}

/** The text of a text or Word-style attachment, or null for anything else. */
export function attachmentText(attachment) {
  const file = findFile(attachment?.id);
  if (!file) return null;
  const kind = attachmentKind(attachment.name, attachment.mediaType);
  if (kind === 'text') return readFileSync(file, 'utf8');
  return kind === 'document' ? documentText(file) : null;
}

/** An image attachment as a data: URL, or null for anything else. */
export function attachmentDataUrl(attachment) {
  const file = findFile(attachment?.id);
  if (!file || attachmentKind(attachment.name, attachment.mediaType) !== 'image') return null;
  return `data:${attachment.mediaType};base64,${readFileSync(file).toString('base64')}`;
}

/** Absolute path of a stored attachment, or null for an unknown/invalid id. */
export function attachmentPath(id) {
  return findFile(id);
}

/**
 * Builds the Anthropic content blocks for a user turn: one block per
 * attachment, then the message text (which also lists where each file is
 * saved, so agents with file tools can open or forward it).
 */
export function buildUserContent(message, attachments) {
  const blocks = [];
  const saved = [];
  for (const attachment of attachments ?? []) {
    const file = findFile(attachment.id);
    if (!file) continue;
    saved.push(`- ${attachment.name}: ${file}`);
    const kind = attachmentKind(attachment.name, attachment.mediaType);
    if (kind === 'image') {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: attachment.mediaType, data: readFileSync(file).toString('base64') },
      });
    } else if (kind === 'pdf') {
      blocks.push({
        type: 'document',
        title: attachment.name,
        source: { type: 'base64', media_type: 'application/pdf', data: readFileSync(file).toString('base64') },
      });
    } else if (kind === 'text' || kind === 'document') {
      const content = kind === 'text' ? readFileSync(file, 'utf8') : documentText(file);
      if (content !== null) {
        blocks.push({ type: 'text', text: `<attached_file name="${attachment.name}">\n${content}\n</attached_file>` });
      }
    }
  }
  const text = message.trim() ? message : 'Please look at the attached file(s).';
  const note =
    saved.length > 0
      ? `\n\n(Attached files, also saved at:\n${saved.join('\n')}\nIf a file's contents are not shown above, open it from its path with your tools.)`
      : '';
  blocks.push({ type: 'text', text: `${text}${note}` });
  return blocks;
}

/** The single stream-json stdin line carrying a user turn. */
export function streamJsonUserLine(content) {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`;
}
