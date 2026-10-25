import { test, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TokenMeter, usageFromTranscript, formatTokens } from './TokenMeter.jsx';

afterEach(cleanup);

const result = (usage) => ({ type: 'result', subtype: 'success', usage });

test('usageFromTranscript adds up every reply, counting cache re-reads as input', () => {
  const entries = [
    { type: 'user_message', text: 'hi' },
    { type: 'assistant', message: { usage: { input_tokens: 999, output_tokens: 999 } } },
    result({ input_tokens: 2, cache_creation_input_tokens: 9998, cache_read_input_tokens: 11611, output_tokens: 1110 }),
    { type: 'user_message', text: 'more' },
    result({ input_tokens: 6, cache_read_input_tokens: 70661, output_tokens: 1422 }),
    { type: 'result', subtype: 'error' },
  ];
  expect(usageFromTranscript(entries)).toEqual({ input: 92278, output: 2532 });
  expect(usageFromTranscript([])).toEqual({ input: 0, output: 0 });
});

test('formatTokens keeps numbers short', () => {
  expect(formatTokens(850)).toBe('850');
  expect(formatTokens(52641)).toBe('52.6k');
  expect(formatTokens(1250000)).toBe('1.25M');
});

test('shows an input and an output bar sized by their share of all tokens', () => {
  render(<TokenMeter input={90000} output={10000} />);
  const input = screen.getByRole('meter', { name: 'Input tokens' });
  const output = screen.getByRole('meter', { name: 'Output tokens' });
  expect(input).toHaveAttribute('aria-valuenow', '90000');
  expect(input.firstChild).toHaveStyle({ width: '90%' });
  expect(output.firstChild).toHaveStyle({ width: '10%' });
  expect(screen.getByText('90k')).toBeInTheDocument();
  expect(screen.getByText('10k')).toBeInTheDocument();
});

test('shows nothing before any tokens are used', () => {
  const { container } = render(<TokenMeter input={0} output={0} />);
  expect(container).toBeEmptyDOMElement();
});
