// @vitest-environment node
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// jsdom does not apply stylesheets, so this guards the contract at the source
// level: the stylesheet is loaded by the app entry point, and idle/working
// status lights get distinct, sized, colored styling in light and dark.
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.jsx', import.meta.url), 'utf8');

function ruleBody(selector) {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing rule for ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

test('main.jsx imports the stylesheet', () => {
  expect(main).toMatch(/import '\.\/styles\.css';/);
});

test('the status light is a visible, sized dot', () => {
  const base = ruleBody('.status-light');
  expect(base).toMatch(/width:/);
  expect(base).toMatch(/height:/);
  expect(base).toMatch(/border-radius: 50%/);
});

test('idle and working lights use different color tokens', () => {
  expect(ruleBody('.status-light.status-idle')).toMatch(/background: var\(--status-idle\)/);
  expect(ruleBody('.status-light.status-working')).toMatch(/background: var\(--status-working\)/);
});

test('status colors are redefined for dark mode', () => {
  const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
  expect(dark).toMatch(/--status-idle:/);
  expect(dark).toMatch(/--status-working:/);
});

test('overlays are fixed-position with a backdrop', () => {
  const overlay = ruleBody('.panel-overlay');
  expect(overlay).toMatch(/position: fixed/);
  expect(overlay).toMatch(/background: var\(--backdrop\)/);
});
