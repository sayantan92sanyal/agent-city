import { describe, it, expect } from 'vitest';
import { liveStatusText } from './liveStatus.js';

const at = (seconds) => ({ startedAt: 1_000_000, now: 1_000_000 + seconds * 1000 });

describe('liveStatusText', () => {
  it('says Working… before anything is known, without a timer at first', () => {
    const { startedAt, now } = at(1);
    expect(liveStatusText({ activity: null, startedAt }, now)).toBe('Working…');
    expect(liveStatusText(null, now)).toBe('Working…');
  });

  it('names thinking, web searches and other tools', () => {
    const { startedAt, now } = at(1);
    expect(liveStatusText({ activity: { kind: 'thinking' }, startedAt }, now)).toBe('Thinking…');
    expect(liveStatusText({ activity: { kind: 'tool', tool: 'WebSearch' }, startedAt }, now)).toBe('Searching the web…');
    expect(liveStatusText({ activity: { kind: 'tool', tool: 'WebFetch' }, startedAt }, now)).toBe('Reading a web page…');
    expect(liveStatusText({ activity: { kind: 'tool', tool: 'ToolSearch' }, startedAt }, now)).toBe('Thinking…');
    expect(liveStatusText({ activity: { kind: 'tool', tool: 'mcp__claude_ai_Google_Calendar__list_events' }, startedAt }, now))
      .toBe('Using Google Calendar · list events…');
  });

  it('explains API retries', () => {
    const { startedAt, now } = at(1);
    expect(liveStatusText({ activity: { kind: 'retry', attempt: 2, maxRetries: 10 }, startedAt }, now))
      .toBe("Claude's servers are slow to respond, retrying (attempt 2 of 10)…");
  });

  it('adds the elapsed time once a turn takes a few seconds', () => {
    const { startedAt, now } = at(72);
    expect(liveStatusText({ activity: { kind: 'thinking' }, startedAt }, now)).toBe('Thinking… 1:12');
    expect(liveStatusText({ activity: null, startedAt }, at(5).now)).toBe('Working… 0:05');
  });
});

describe('local model status', () => {
  it('shows the server status text as it is', () => {
    const { startedAt, now } = at(1);
    expect(liveStatusText({ activity: { kind: 'status', text: 'Loading Llama 3.2 3B Instruct (first use takes a moment)…' }, startedAt }, now))
      .toBe('Loading Llama 3.2 3B Instruct (first use takes a moment)…');
  });
});
