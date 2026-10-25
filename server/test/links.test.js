import { beforeEach, expect, test } from 'vitest';
import { startLink, endLink, activeLinks, isLinkTarget, clearLinks } from '../src/links.js';

beforeEach(() => clearLinks());

test('start/active/end round-trip', () => {
  const id = startLink({ from: 'mayor', to: 'a1', label: 'hello' });
  expect(typeof id).toBe('string');
  const links = activeLinks();
  expect(links).toHaveLength(1);
  expect(links[0]).toMatchObject({ id, from: 'mayor', to: 'a1', label: 'hello' });
  expect(typeof links[0].startedAt).toBe('number');
  endLink(id);
  expect(activeLinks()).toEqual([]);
});

test('isLinkTarget is true only while a link to the agent is active', () => {
  expect(isLinkTarget('a1')).toBe(false);
  const id = startLink({ from: 'mayor', to: 'a1', label: 'x' });
  expect(isLinkTarget('a1')).toBe(true);
  expect(isLinkTarget('a2')).toBe(false);
  endLink(id);
  expect(isLinkTarget('a1')).toBe(false);
});

test('endLink of an unknown id is a no-op', () => {
  expect(() => endLink('nope')).not.toThrow();
});
