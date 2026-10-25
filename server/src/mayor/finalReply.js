/**
 * Extracts the final answer from a transcript of stream-json events.
 * @returns {{ reply: string } | { error: string }}
 */
export function finalReply(events) {
  const list = Array.isArray(events) ? events : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (e?.type === 'result') {
      const text = typeof e.result === 'string' ? e.result : '';
      return e.is_error ? { error: text || 'agent reported an error' } : { reply: text };
    }
  }
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (e?.type === 'error') return { error: String(e.error) };
  }
  return { error: 'agent produced no answer' };
}
