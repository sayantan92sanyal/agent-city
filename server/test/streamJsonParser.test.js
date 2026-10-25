import { expect, test } from 'vitest';
import { parseStreamJsonLine } from '../src/streamJsonParser.js';

test('parses a valid JSON line', () => {
  expect(parseStreamJsonLine('{"type":"text","text":"hi"}')).toEqual({ type: 'text', text: 'hi' });
});

test('returns null for a blank line', () => {
  expect(parseStreamJsonLine('')).toBeNull();
});

test('returns null for a whitespace-only line', () => {
  expect(parseStreamJsonLine('   ')).toBeNull();
});

test('returns null instead of throwing on malformed JSON', () => {
  expect(parseStreamJsonLine('not json')).toBeNull();
});

test('returns null instead of throwing on truncated JSON', () => {
  expect(parseStreamJsonLine('{"type":"a"')).toBeNull();
});

test('parses a bare JSON scalar without throwing', () => {
  expect(parseStreamJsonLine('42')).toBe(42);
});
