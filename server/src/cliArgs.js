// `--verbose` is required by the CLI whenever `--print` and
// `--output-format stream-json` are combined; without it every invocation
// exits 1 with "requires --verbose".
const BASE_ARGS = ['-p', '--output-format', 'stream-json', '--verbose'];

// `--tools` restricts which built-in tools are available to the session.
// (`--allowedTools` is only a permission auto-approve list and restricts
// nothing under `bypassPermissions`.) An empty/unset tools list means
// "inherit the default tool set", so the flag is omitted entirely in that
// case — passing `--tools ''` would instead disable *all* tools.
function toolsArgs(tools) {
  const list = (tools ?? []).filter(Boolean);
  return list.length > 0 ? ['--tools', list.join(',')] : [];
}

function commonArgs(agentName, tools) {
  return [
    ...BASE_ARGS,
    '--agent', agentName,
    ...toolsArgs(tools),
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

export function buildStartArgs({ agentName, tools, sessionId, message }) {
  return [...commonArgs(agentName, tools), '--session-id', sessionId, ...promptArgs(message)];
}

export function buildResumeArgs({ agentName, tools, sessionId, message }) {
  return [...commonArgs(agentName, tools), '--resume', sessionId, ...promptArgs(message)];
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

export function buildOneOffArgs({ agentName, tools, message }) {
  return [...commonArgs(agentName, tools), '--no-session-persistence', ...promptArgs(message)];
}
