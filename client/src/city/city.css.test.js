// @vitest-environment node
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// jsdom does not apply stylesheets, so the city's styling contract is
// checked at the source level.
const css = readFileSync(new URL('./city.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('../main.jsx', import.meta.url), 'utf8');
const baseCss = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

const zIndexOf = (body) => Number(/z-index: (-?\d+)/.exec(body)?.[1]);

function ruleBody(selector) {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing rule for ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

test('main.jsx loads the pixel font and the city stylesheet', () => {
  expect(main).toMatch(/import '@fontsource\/press-start-2p';/);
  expect(main).toMatch(/import '\.\/city\/city\.css';/);
});

test('the city uses the pixel font and a scrollable viewport', () => {
  expect(ruleBody('.app.app-city')).toMatch(/font-family: 'Press Start 2P'/);
  expect(ruleBody('.city-viewport')).toMatch(/overflow: auto/);
});

test('long names are truncated with an ellipsis at the agreed widths', () => {
  expect(ruleBody('.city-sign-text')).toMatch(/max-width: 18ch/);
  expect(ruleBody('.city-sign-text')).toMatch(/text-overflow: ellipsis/);
  // Capped at the 64px agent cell so same-row neighbours' labels never meet.
  expect(ruleBody('.city-name')).toMatch(/max-width: min\(12ch, 64px\)/);
  expect(ruleBody('.city-name')).toMatch(/text-overflow: ellipsis/);
});

test('idle characters bob with a stepped animation that respects reduced motion', () => {
  expect(ruleBody(".city-agent[data-status='idle'] .city-figure")).toMatch(
    /animation: city-bob [^;]*steps\(/
  );
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  expect(reduced).toMatch(/\.city-figure/);
  expect(reduced).toMatch(/animation: none/);
});

test('the map is its own stacking context, below the dialog overlays', () => {
  const viewport = ruleBody('.city-viewport');
  expect(viewport).toMatch(/isolation: isolate/);
  expect(viewport).toMatch(/position: relative/);
  const mapZ = zIndexOf(viewport);
  expect(Number.isFinite(mapZ)).toBe(true);

  const start = baseCss.indexOf('.modal-overlay,\n.panel-overlay {');
  expect(start).toBeGreaterThanOrEqual(0);
  const overlayZ = zIndexOf(baseCss.slice(start, baseCss.indexOf('}', start)));
  expect(overlayZ).toBeGreaterThan(mapZ);
  // The HUD must not create a layer that could cover the overlays either.
  const hudZ = zIndexOf(ruleBody('.city-hud'));
  expect(Number.isFinite(hudZ) ? hudZ : 0).toBeLessThan(overlayZ);
});

test('transcripts use a proportional reading font at >= 14px, not the pixel font', () => {
  const body = ruleBody('.app-city .transcript');
  expect(body).toMatch(/font-family: var\(--reading-font\)/);
  expect(body).toMatch(/--reading-font: ui-sans-serif/);
  expect(Number(/font-size: (\d+)px/.exec(body)?.[1])).toBeGreaterThanOrEqual(14);
});

test('dialog body text and inputs use a readable monospace at >= 12px', () => {
  const body = ruleBody('.app-city .modal,\n.app-city .panel');
  expect(body).toMatch(/font-family: ui-monospace/);
  const size = Number(/font-size: (\d+)px/.exec(body)?.[1]);
  expect(size).toBeGreaterThanOrEqual(12);

  const fields = ruleBody('.app-city .modal input,\n.app-city .modal select,\n.app-city .modal textarea,\n.app-city .panel input,\n.app-city .panel select,\n.app-city .panel textarea');
  expect(fields).toMatch(/font-family: ui-monospace/);
  expect(Number(/font-size: (\d+)px/.exec(fields)?.[1])).toBeGreaterThanOrEqual(12);

  // Headings and buttons in dialogs keep the pixel font.
  expect(ruleBody('.app-city .modal h2,\n.app-city .panel h2')).toMatch(/font-family: 'Press Start 2P'/);
  expect(ruleBody('.app-city .modal button,\n.app-city .panel button')).toMatch(
    /font-family: 'Press Start 2P'/
  );
});
