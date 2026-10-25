import { expect, test } from 'vitest';
import { finalReply } from '../src/mayor/finalReply.js';

test('returns the last result text', () => {
  expect(
    finalReply([
      { type: 'user_message', text: 'q' },
      { type: 'result', result: 'one', is_error: false },
      { type: 'result', result: 'two', is_error: false },
    ]),
  ).toEqual({ reply: 'two' });
});

test('is_error result becomes an error', () => {
  expect(finalReply([{ type: 'result', result: 'bad thing', is_error: true }])).toEqual({ error: 'bad thing' });
});

test('only an error entry yields that error', () => {
  expect(finalReply([{ type: 'user_message', text: 'q' }, { type: 'error', error: 'spawn failed' }])).toEqual({
    error: 'spawn failed',
  });
});

test('nothing yields a default error', () => {
  expect(finalReply([])).toEqual({ error: 'agent produced no answer' });
});
