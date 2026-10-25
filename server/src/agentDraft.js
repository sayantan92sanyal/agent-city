import { tmpdir } from 'node:os';
import { buildUserContent, streamJsonUserLine } from './attachments.js';
import { runClaude } from './cliRunner.js';

/**
 * Turns a user's rough brief into a Claude Code agent file's parts: a short
 * description (when to use the agent), full instructions (the file's body,
 * the agent's system prompt) and the tools it needs. The user reviews the
 * draft before anything is written.
 */

// Built-in tools an agent may be given; a draft never names anything else.
export const AGENT_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebSearch', 'WebFetch', 'Agent'];

export class DraftError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DraftError';
  }
}

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    instructions: { type: 'string' },
    tools: { type: 'array', items: { type: 'string', enum: AGENT_TOOLS } },
  },
  required: ['description', 'instructions', 'tools'],
  additionalProperties: false,
};

const DRAFT_SYSTEM_PROMPT = `You write Claude Code agent files. From the user's brief for an agent, produce three parts.

description: 1 to 3 plain sentences, under 400 characters. Claude reads it to decide when to hand work to this agent, so say what the agent does and when to use it (for example "Use when the user shares an article draft for review."). No lists, no markdown.

instructions: the body of the agent file, which becomes the agent's system prompt. Write it in Markdown, in the second person ("You are..."). Include:
- the agent's role and goal in one or two sentences;
- what input it expects and what to do when input is missing or unclear;
- a step-by-step process;
- concrete criteria or a checklist for every point the user listed: keep every requirement from the brief, sharpen it, and never drop one;
- the exact format of its answer (headings, order, how to rate or prioritise findings);
- rules and boundaries (for example: cite a source for every fact check; suggest edits rather than rewriting everything unless asked).
Be specific and practical, with no filler. Aim for 250 to 700 words.

tools: the fewest built-in tools the agent needs. WebSearch and WebFetch for anything on the internet (research, fact checks); Read, Glob and Grep to read files; Write and Edit only if it must create or change files; Bash only if it must run commands; Agent only if it must hand work to other agents.

Research: only if the brief asks you to research or prepare (for example "do some research on what a great article has"), use WebSearch and WebFetch to find current best practice and build concrete criteria from it into the instructions. Otherwise do not search; write from what you know.

When you improve an existing agent, keep its purpose and everything the user wrote, fix gaps and vague parts, and make the description match the instructions.`;

export function buildDraftArgs() {
  return [
    '-p', '--output-format', 'stream-json', '--verbose',
    '--model', 'sonnet',
    '--effort', 'medium',
    '--no-session-persistence',
    '--permission-mode', 'bypassPermissions',
    '--tools', 'WebSearch,WebFetch',
    '--system-prompt', DRAFT_SYSTEM_PROMPT,
    '--json-schema', JSON.stringify(DRAFT_SCHEMA),
    '--input-format', 'stream-json',
  ];
}

export function draftPrompt({ name, brief, current }) {
  const parts = [`Agent name: ${name}`, `Brief from the user:\n${brief}`];
  if (current) {
    parts.push(`Current instructions (the file body):\n${current.instructions || '(none)'}`);
    parts.push(`Current tools: ${(current.tools ?? []).join(', ') || '(none listed, so the default set)'}`);
    parts.push('Improve this agent.');
  } else {
    parts.push('Draft this new agent.');
  }
  return parts.join('\n\n');
}

/**
 * @returns {Promise<{description: string, instructions: string, tools: string[]}>}
 */
export async function draftAgent({ name, brief, current }, { runClaudeFn = runClaude } = {}) {
  let result = null;
  const run = runClaudeFn(
    {
      args: buildDraftArgs(),
      // No project folder: the draft must not pick up a project's settings.
      cwd: tmpdir(),
      input: streamJsonUserLine(buildUserContent(draftPrompt({ name, brief, current }), [])),
    },
    (event) => {
      if (event.type === 'result') result = event;
    }
  );
  const { exitCode, stderr } = await run.done;
  if (!result || result.is_error || exitCode !== 0) {
    const detail = (stderr ?? '').trim() || result?.result || `claude exited with code ${exitCode}`;
    throw new DraftError(`Claude could not draft the agent: ${detail}`);
  }
  const draft = result.structured_output ?? {};
  const description = String(draft.description ?? '').trim();
  const instructions = String(draft.instructions ?? '').trim();
  if (!description || !instructions) throw new DraftError('Claude returned an empty draft. Try again.');
  const tools = (Array.isArray(draft.tools) ? draft.tools : []).filter((tool) => AGENT_TOOLS.includes(tool));
  return { description, instructions, tools };
}
