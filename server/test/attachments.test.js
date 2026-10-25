import { beforeEach, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AttachmentError,
  attachmentKind,
  attachmentPath,
  buildUserContent,
  saveAttachments,
  streamJsonUserLine,
} from '../src/attachments.js';

const b64 = (text) => Buffer.from(text).toString('base64');

beforeEach(() => {
  process.env.AGENT_PANEL_HOME = mkdtempSync(join(tmpdir(), 'acp-att-'));
});

test('attachmentKind recognises images, PDFs and text (by type or extension)', () => {
  expect(attachmentKind('a.png', 'image/png')).toBe('image');
  expect(attachmentKind('a.pdf', 'application/pdf')).toBe('pdf');
  expect(attachmentKind('a.csv', 'text/csv')).toBe('text');
  expect(attachmentKind('notes.md', '')).toBe('text');
  expect(attachmentKind('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('document');
  expect(attachmentKind('old.doc', '')).toBe('document');
  expect(attachmentKind('a.zip', 'application/zip')).toBe('file');
  expect(attachmentKind('logo.svg', 'image/svg+xml')).toBe('file');
});

test('any other file is accepted and kept with a safe version of its extension', () => {
  const [zip, odd] = saveAttachments([
    { name: 'data.zip', mediaType: 'application/zip', data: b64('ZIP') },
    { name: 'weird.p/h p', mediaType: '', data: b64('X') },
  ]);
  expect(attachmentPath(zip.id)).toMatch(/\.zip$/);
  expect(attachmentPath(odd.id)).toMatch(/\.bin$/);
  expect(zip.mediaType).toBe('application/zip');
});

test('other files are named in the message with their path, for Claude to open', () => {
  const metas = saveAttachments([{ name: 'model.xlsx', mediaType: 'application/vnd.ms-excel', data: b64('XLS') }]);
  const blocks = buildUserContent('summarise', metas);
  expect(blocks).toHaveLength(1);
  expect(blocks[0].text).toContain(`- model.xlsx: ${attachmentPath(metas[0].id)}`);
  expect(blocks[0].text).toContain('open it from its path');
});

test.skipIf(process.platform !== 'darwin')('Word documents arrive as their text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-docx-'));
  writeFileSync(join(dir, 'in.txt'), 'Quarterly plan: grow revenue 20%.');
  execFileSync('textutil', ['-convert', 'docx', join(dir, 'in.txt'), '-output', join(dir, 'plan.docx')]);
  const data = readFileSync(join(dir, 'plan.docx')).toString('base64');
  const metas = saveAttachments([{ name: 'plan.docx', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data }]);
  const [doc] = buildUserContent('review this', metas);
  expect(doc.type).toBe('text');
  expect(doc.text).toMatch(/^<attached_file name="plan\.docx">\n/);
  expect(doc.text).toContain('Quarterly plan: grow revenue 20%.');
});

test('saveAttachments stores files and returns metadata only', () => {
  const [meta] = saveAttachments([{ name: 'shot.png', mediaType: 'image/png', data: b64('PNGDATA') }]);
  expect(meta).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), name: 'shot.png', mediaType: 'image/png', size: 7 });
  expect(readFileSync(attachmentPath(meta.id), 'utf8')).toBe('PNGDATA');
});

test('saveAttachments rejects unsupported, empty and non-array input', () => {
  expect(() => saveAttachments([{ name: 'a.txt', mediaType: 'text/plain', data: '' }])).toThrow(/empty/);
  expect(() => saveAttachments('nope')).toThrow(AttachmentError);
  expect(saveAttachments(undefined)).toEqual([]);
});

test('attachmentPath refuses ids that are not uuids (no path traversal)', () => {
  expect(attachmentPath('../../etc/passwd')).toBeNull();
  expect(attachmentPath('00000000-0000-0000-0000-000000000000')).toBeNull();
});

test('buildUserContent emits image, document and text blocks, then the message', () => {
  const metas = saveAttachments([
    { name: 'shot.png', mediaType: 'image/png', data: b64('IMG') },
    { name: 'doc.pdf', mediaType: 'application/pdf', data: b64('PDF') },
    { name: 'notes.md', mediaType: '', data: b64('# hi') },
  ]);
  const blocks = buildUserContent('what is this?', metas);
  expect(blocks[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64('IMG') } });
  expect(blocks[1]).toMatchObject({ type: 'document', title: 'doc.pdf', source: { media_type: 'application/pdf', data: b64('PDF') } });
  expect(blocks[2].text).toBe('<attached_file name="notes.md">\n# hi\n</attached_file>');
  expect(blocks[3].text).toMatch(/^what is this\?\n\n\(Attached files, also saved at:\n- shot\.png: \//);
});

test('a blank message with attachments gets a default prompt', () => {
  const metas = saveAttachments([{ name: 'a.txt', mediaType: 'text/plain', data: b64('x') }]);
  expect(buildUserContent('  ', metas).at(-1).text).toMatch(/^Please look at the attached file\(s\)\./);
});

test('streamJsonUserLine is one newline-terminated user message', () => {
  const line = streamJsonUserLine([{ type: 'text', text: 'hi' }]);
  expect(line.endsWith('\n')).toBe(true);
  expect(JSON.parse(line)).toEqual({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } });
});
