import { spawn } from 'node:child_process';
import { parseStreamJsonLine } from './streamJsonParser.js';

const MAX_STDERR_CHARS = 4000;

/**
 * Spawns `claude` as a child process and streams its newline-delimited
 * `stream-json` stdout through `onEvent`.
 *
 * @param {object} options
 * @param {string[]} options.args - argv to pass to `claude`.
 * @param {string} options.cwd - working directory for the spawned process.
 * @param {string} [options.input] - written to stdin, which is then closed.
 * @param {typeof spawn} [options.spawnFn] - injectable spawn function, for tests.
 * @param {(event: object) => void} onEvent - called once per parsed event.
 * @returns {{ kill(): void, done: Promise<{ exitCode: number|null, stderr: string, error?: Error }> }}
 *   `stderr` is the (tail of the) child's stderr output, so callers can show
 *   the CLI's real error text rather than a bare exit code.
 */
export function runClaude({ args, cwd, env, input, spawnFn = spawn }, onEvent) {
  const child = spawnFn('claude', args, env ? { cwd, env: { ...process.env, ...env } } : { cwd });
  // With `--input-format stream-json` the prompt is written to stdin; closing
  // it tells the CLI there are no further turns.
  if (input !== undefined) {
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  }

  let buffer = '';
  let stderr = '';

  const emitLine = (line) => {
    const parsed = parseStreamJsonLine(line);
    if (parsed === null) {
      return;
    }
    try {
      onEvent(parsed);
    } catch {
      // onEvent failures must never prevent `done` from settling.
    }
  };

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      emitLine(line);
    }
  });

  // Always drain stderr: the CLI's real error text (bad flag, unknown agent,
  // expired auth, dead --resume id, ...) only appears here, and an undrained
  // pipe could also fill up and stall the child. Only the tail is kept.
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > MAX_STDERR_CHARS) {
      stderr = stderr.slice(-MAX_STDERR_CHARS);
    }
  });

  const done = new Promise((resolve) => {
    let settled = false;

    child.on('close', (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      if (buffer !== '') {
        emitLine(buffer);
        buffer = '';
      }
      resolve({ exitCode, stderr });
    });

    // Node emits 'error' (not a rejected promise) when the process can't be
    // spawned at all (missing binary, EACCES, ...). With no listener here,
    // EventEmitter's default behavior is to throw, crashing the whole
    // backend process. 'close'/'exit' are also not guaranteed to follow an
    // 'error', so `done` could otherwise hang forever. Settle `done` instead
    // of throwing, keeping this module's "never throws" contract.
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ exitCode: null, error, stderr });
    });
  });

  return {
    kill: () => child.kill(),
    done,
  };
}
