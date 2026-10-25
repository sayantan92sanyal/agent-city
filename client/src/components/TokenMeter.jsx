/**
 * Tokens a conversation has used, from the `result` event that ends each
 * reply (it totals every API request of that reply). Input includes text
 * Claude re-reads from its prompt cache, which is most of it.
 */
export function usageFromTranscript(entries) {
  const total = { input: 0, output: 0 };
  for (const entry of entries) {
    const usage = entry?.type === 'result' ? entry.usage : null;
    if (!usage) continue;
    total.input +=
      (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    total.output += usage.output_tokens ?? 0;
  }
  return total;
}

export function formatTokens(count) {
  if (count >= 1_000_000) return `${Number((count / 1_000_000).toFixed(2))}M`;
  if (count >= 1_000) return `${Number((count / 1_000).toFixed(1))}k`;
  return String(count);
}

function Bar({ label, value, total }) {
  const share = total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
  return (
    <div className="token-meter-row">
      <span className="token-meter-label">{label}</span>
      <span
        className={`token-meter-bar token-meter-${label.toLowerCase()}`}
        role="meter"
        aria-label={`${label} tokens`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={value}
      >
        <span style={{ width: `${share}%` }} />
      </span>
      <span className="token-meter-value">{formatTokens(value)}</span>
    </div>
  );
}

/** Two bars, input and output, each sized by its share of the conversation's tokens. */
export function TokenMeter({ input, output }) {
  const total = input + output;
  if (total === 0) return null;
  return (
    <div
      className="token-meter"
      title={`This conversation: ${input.toLocaleString()} input tokens (including cache re-reads), ${output.toLocaleString()} output tokens`}
    >
      <Bar label="Input" value={input} total={total} />
      <Bar label="Output" value={output} total={total} />
    </div>
  );
}
