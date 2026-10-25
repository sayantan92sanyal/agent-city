import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FILE_TYPES, extractFiles } from '../src/chat/chatFiles.js';

let folder;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'chat-files-'));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

const assistant = (...content) => ({ type: 'assistant', message: { content } });
const write = (file_path, name = 'Write') => ({ type: 'tool_use', name, input: { file_path } });
const text = (t) => ({ type: 'text', text: t });

describe('extractFiles', () => {
  it('maps allowed extensions to media types', () => {
    expect(FILE_TYPES).toMatchObject({
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.html': 'text/html',
    });
  });

  it('finds Write/Edit file paths and absolute paths in text', () => {
    const png = join(folder, 'chart.png');
    const pdf = join(folder, 'report.pdf');
    const html = join(folder, 'page.html');
    for (const f of [png, pdf, html]) writeFileSync(f, 'x');
    const events = [
      assistant(write(png)),
      assistant(write(html, 'Edit')),
      assistant(text(`Saved it to ${pdf}. Enjoy!`)),
    ];
    expect(extractFiles(events, folder)).toEqual([png, html, pdf]);
  });

  it('ignores missing files, non-allowed types and relative paths', () => {
    const script = join(folder, 'run.sh');
    writeFileSync(script, 'x');
    writeFileSync(join(folder, 'rel.png'), 'x');
    const events = [
      assistant(write(join(folder, 'missing.png'))),
      assistant(write(script)),
      assistant(write('rel.png')),
      assistant(text(`See ${join(folder, 'gone.pdf')} and ./rel.png`)),
    ];
    expect(extractFiles(events, folder)).toEqual([]);
  });

  it('ignores tool uses other than Write/Edit and non-assistant events', () => {
    const png = join(folder, 'a.png');
    writeFileSync(png, 'x');
    const events = [
      assistant({ type: 'tool_use', name: 'Read', input: { file_path: png } }),
      { type: 'user', message: { content: [text(png)] } },
    ];
    expect(extractFiles(events, folder)).toEqual([]);
  });

  it('finds spaced paths in backticks, double quotes and markdown targets', () => {
    const spaced = join(folder, 'My Folder');
    mkdirSync(spaced);
    const png = join(spaced, 'sales chart.png');
    const pdf = join(spaced, 'final report.pdf');
    const html = join(spaced, 'page view.html');
    for (const f of [png, pdf, html]) writeFileSync(f, 'x');
    const events = [
      assistant(text(`Saved to \`${png}\`.`)),
      assistant(text(`![chart](${png}) and [report](${pdf})`)),
      assistant(text(`Open "${html}" in a browser.`)),
    ];
    expect(extractFiles(events, folder)).toEqual([png, pdf, html]);
  });

  it('stores resolved paths', () => {
    const png = join(folder, 'chart.png');
    writeFileSync(png, 'x');
    const events = [assistant(write(`${folder}/./chart.png`))];
    expect(extractFiles(events, folder)).toEqual([png]);
  });

  it('de-duplicates paths', () => {
    const png = join(folder, 'chart.png');
    writeFileSync(png, 'x');
    const events = [assistant(write(png)), assistant(text(`Here: ${png}`)), assistant(write(png, 'Edit'))];
    expect(extractFiles(events, folder)).toEqual([png]);
  });
});
