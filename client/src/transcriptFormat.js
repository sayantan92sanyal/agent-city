/**
 * Turns stored transcript entries into display rows.
 *
 * Entries are either app-generated (`{type:'user_message', text}` for the
 * user's own message, `{type:'error', error}` for a failed claude run) or raw
 * `claude --output-format stream-json` events, whose real shapes are:
 *   {type:'system', subtype:'init', ...}                          -> hidden
 *   {type:'assistant', message:{content:[{type:'text', text}, {type:'tool_use', name}, ...]}}
 *   {type:'user', message:{content:[{type:'tool_result', ...}]}}  -> hidden (tool output)
 *   {type:'result', result, is_error, subtype}
 *
 * Chats also store `{type:'stopped'}` / `{type:'interrupted'}` markers, shown
 * as quiet 'note' rows.
 *
 * A display row is `{ kind, text }`, kind one of 'user' | 'assistant' |
 * 'tool' | 'error' | 'bridge' | 'note'. User rows may also carry
 * `attachments`. Entries with nothing useful to show yield `null`.
 */

const ASK_TOOL = 'mcp__city__ask_agent';
// Mayor bridge tools are rendered specially (ask_agent) or hidden (list_agents).
const MAYOR_TOOLS = new Set([ASK_TOOL, 'mcp__city__list_agents', 'ToolSearch']);

/** `mcp__claude_ai_Google_Calendar__list_calendars` -> `Google Calendar · list calendars`. */
export function friendlyToolName(name) {
  const match = /^mcp__claude_ai_(.+?)__(.+)$/.exec(String(name));
  if (!match) return name;
  return `${match[1].replace(/_/g, ' ')} · ${match[2].replace(/_/g, ' ')}`;
}

function agentNameFromId(agentId) {
  const id = String(agentId ?? '');
  const index = id.lastIndexOf('::');
  return index >= 0 && id.slice(index + 2) ? id.slice(index + 2) : id;
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
  }
  return '';
}

function contentBlocks(entry) {
  const content = entry?.message?.content;
  if (Array.isArray(content)) return content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return [];
}

function describeAssistant(entry) {
  const blocks = contentBlocks(entry);
  const text = blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
    .trim();
  if (text) {
    // Local model replies name their model ("Llama 3.2 3B · local").
    const model = entry.message?.model;
    return typeof model === 'string' && model.endsWith('· local') ? { kind: 'assistant', text, speaker: model } : { kind: 'assistant', text };
  }

  const toolNames = blocks
    .filter((block) => block?.type === 'tool_use')
    .map((block) => block.name)
    .filter((name) => name && !MAYOR_TOOLS.has(name));
  if (toolNames.length > 0) return { kind: 'tool', text: `[used ${toolNames.map(friendlyToolName).join(', ')}]` };

  return null;
}

function describeResult(entry) {
  const text = typeof entry.result === 'string' ? entry.result.trim() : '';
  if (entry.is_error) {
    return { kind: 'error', text: `Error: ${text || entry.subtype || 'claude reported an error'}` };
  }
  return text ? { kind: 'assistant', text } : null;
}

/**
 * Describes one transcript entry as a display row, or `null` to hide it.
 * @param {unknown} entry
 * @returns {{kind: string, text: string} | null}
 */
export function describeEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return entry == null ? null : { kind: 'assistant', text: String(entry) };
  }

  switch (entry.type) {
    case 'user_message': {
      const row = { kind: 'user', text: String(entry.text ?? '') };
      if (Array.isArray(entry.attachments) && entry.attachments.length > 0) row.attachments = entry.attachments;
      return row;
    }
    case 'error':
      return { kind: 'error', text: `Error: ${entry.error ?? 'unknown error'}` };
    case 'stopped':
      return { kind: 'note', text: 'Stopped.' };
    case 'interrupted':
      return { kind: 'note', text: 'Interrupted — the app restarted before Claude finished.' };
    case 'chat_files':
      return Array.isArray(entry.files) && entry.files.length > 0 ? { kind: 'files', files: entry.files } : null;
    case 'system':
      return null;
    case 'assistant':
      if (entry.message) return describeAssistant(entry);
      break;
    case 'user':
      // Raw tool results fed back to the model — noise for a human reader.
      return null;
    case 'result':
      return describeResult(entry);
    default:
      break;
  }

  // Simple app/legacy entries that carry their text directly.
  if (typeof entry.text === 'string') return { kind: 'assistant', text: entry.text };
  if (typeof entry.error === 'string') return { kind: 'error', text: `Error: ${entry.error}` };
  // Unknown event types (rate-limit notices, stream deltas, ...) are hidden
  // rather than dumped as raw JSON.
  return null;
}

/**
 * Formats a whole transcript into display rows, dropping hidden entries.
 * A successful `result` event normally repeats the turn's final assistant
 * text verbatim, so it is dropped when it duplicates the previous row.
 * @param {Array<unknown>} entries
 * @returns {Array<{kind: string, text: string}>}
 */
export function formatTranscript(entries) {
  const rows = [];
  // tool_use id -> agent name, for pairing ask_agent calls with their results.
  const asks = new Map();
  for (const entry of entries ?? []) {
    if (entry?.type === 'assistant' && entry.message) {
      const row = describeEntry(entry);
      if (row) rows.push(row);
      for (const block of contentBlocks(entry)) {
        if (block?.type !== 'tool_use') continue;
        if (block.name !== ASK_TOOL) continue;
        const name = agentNameFromId(block.input?.agent_id);
        asks.set(block.id, name);
        rows.push({ kind: 'bridge', speaker: `MAYOR → ${name}`, text: String(block.input?.message ?? '') });
      }
      continue;
    }
    if (entry?.type === 'user') {
      for (const block of contentBlocks(entry)) {
        if (block?.type === 'tool_result' && asks.has(block.tool_use_id)) {
          rows.push({
            kind: 'bridge',
            speaker: `${asks.get(block.tool_use_id)} → MAYOR`,
            text: resultText(block.content),
          });
        }
      }
      continue; // other raw tool results (incl. list_agents) stay hidden
    }
    const row = describeEntry(entry);
    if (!row) continue;
    const previous = rows[rows.length - 1];
    if (
      entry?.type === 'result' &&
      row.kind === 'assistant' &&
      previous?.kind === 'assistant' &&
      previous.text === row.text
    ) {
      continue;
    }
    rows.push(row);
  }
  return rows;
}

// Error rows already start with "Error:", so they get no separate label.
const SPEAKER_LABELS = { user: 'You', assistant: 'Agent', tool: 'Tool' };

export function speakerLabel(kind, row, assistantLabel = SPEAKER_LABELS.assistant) {
  if (kind === 'bridge') return row?.speaker ?? '';
  if (kind === 'assistant') return row?.speaker ?? assistantLabel;
  return SPEAKER_LABELS[kind] ?? '';
}
