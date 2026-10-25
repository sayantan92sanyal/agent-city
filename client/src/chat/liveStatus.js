import { friendlyToolName } from '../transcriptFormat.js';

// Tools whose activity reads better as a plain phrase. ToolSearch is Claude
// loading a tool, which the user experiences as thinking.
const TOOL_PHRASES = {
  WebSearch: 'Searching the web',
  WebFetch: 'Reading a web page',
  ToolSearch: 'Thinking',
};

function activityPhrase(activity) {
  if (activity?.kind === 'thinking') return 'Thinking';
  // Local models report their own status, e.g. "Loading Llama… (first use takes a moment)…".
  if (activity?.kind === 'status') return String(activity.text ?? 'Working').replace(/…$/, '');
  if (activity?.kind === 'tool') return TOOL_PHRASES[activity.tool] ?? `Using ${friendlyToolName(activity.tool)}`;
  if (activity?.kind === 'retry') {
    return `Claude's servers are slow to respond, retrying (attempt ${activity.attempt} of ${activity.maxRetries})`;
  }
  return 'Working';
}

/** The status line under a live chat turn, e.g. "Searching the web… 0:42". */
export function liveStatusText(live, now = Date.now()) {
  const text = `${activityPhrase(live?.activity)}…`;
  const seconds = live?.startedAt ? Math.floor((now - live.startedAt) / 1000) : 0;
  if (seconds < 5) return text;
  return `${text} ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
