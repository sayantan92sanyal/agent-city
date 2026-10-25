/**
 * Parses one line of `claude --output-format stream-json` output.
 *
 * Returns the parsed value, or `null` for a blank/whitespace-only line or a
 * line that fails to parse as JSON. Never throws.
 */
export function parseStreamJsonLine(line) {
  if (typeof line !== 'string' || line.trim() === '') {
    return null;
  }

  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
