// `--verbose` is required by the CLI whenever `--print` and
// `--output-format stream-json` are combined; without it every invocation
// exits 1 with "requires --verbose".
const BASE_ARGS = ['-p', '--output-format', 'stream-json', '--verbose'];

// No `--tools` here: `--agent` already limits the agent to the tools in its
// file, while `--tools` would cap the whole session, so any helper agent it
// starts (through the Agent tool) would lose its own tools too. (Checked with
// claude: with `--tools Read,Glob,Agent` a general-purpose helper could not
// write a file; with only `--agent` it could.)
function commonArgs(agentName) {
  return [
    ...BASE_ARGS,
    '--agent', agentName,
    '--permission-mode', 'bypassPermissions',
  ];
}

// The literal `--` ends option parsing, so a message that itself starts with
// `-` is always treated as the positional prompt, never as a flag.
// A `null` message means the turn (with attachments) arrives on stdin as one
// stream-json user message instead.
function promptArgs(message) {
  return message === null ? ['--input-format', 'stream-json'] : ['--', message];
}

export function buildStartArgs({ agentName, sessionId, message }) {
  return [...commonArgs(agentName), '--session-id', sessionId, ...promptArgs(message)];
}

export function buildResumeArgs({ agentName, sessionId, message }) {
  return [...commonArgs(agentName), '--resume', sessionId, ...promptArgs(message)];
}

export function buildMayorArgs({ sessionId, resume, message, mcpConfigPath, addDirs, systemPrompt }) {
  return [
    ...BASE_ARGS,
    '--permission-mode', 'bypassPermissions',
    '--mcp-config', mcpConfigPath,
    '--append-system-prompt', systemPrompt,
    ...addDirs.flatMap((d) => ['--add-dir', d]),
    resume ? '--resume' : '--session-id', sessionId,
    ...promptArgs(message),
  ];
}

export function buildOneOffArgs({ agentName, message }) {
  return [...commonArgs(agentName), '--no-session-persistence', ...promptArgs(message)];
}
