import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { AgentSprite, MayorSprite, Desk, colorForName } from './sprites.jsx';

describe('colorForName', () => {
  test('is stable and differs for different names', () => {
    expect(colorForName('growth')).toBe(colorForName('growth'));
    expect(colorForName('growth')).not.toBe(colorForName('finance'));
    const m = colorForName('growth').match(/^hsl\((\d+), (\d+)%, (\d+)%\)$/);
    expect(m).toBeTruthy();
    expect(+m[2]).toBeGreaterThanOrEqual(55);
    expect(+m[2]).toBeLessThanOrEqual(70);
    expect(+m[3]).toBeGreaterThanOrEqual(45);
    expect(+m[3]).toBeLessThanOrEqual(55);
  });
});

afterEach(cleanup);

describe('sprites', () => {
  test('AgentSprite working and idle render different shapes', () => {
    const w = render(<AgentSprite color="#36c" pose="working" />).container.innerHTML;
    const i = render(<AgentSprite color="#36c" pose="idle" />).container.innerHTML;
    expect(w).not.toBe(i);
  });

  test('AgentSprite attributes', () => {
    const { getByTestId } = render(<AgentSprite color="#36c" pose="working" />);
    const svg = getByTestId('agent-sprite');
    expect(svg.getAttribute('data-pose')).toBe('working');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
  });

  test('MayorSprite and Desk render hidden svgs', () => {
    const { getByTestId } = render(
      <>
        <MayorSprite />
        <Desk />
      </>,
    );
    expect(getByTestId('mayor-sprite').getAttribute('aria-hidden')).toBe('true');
    expect(getByTestId('desk').getAttribute('aria-hidden')).toBe('true');
  });
});
