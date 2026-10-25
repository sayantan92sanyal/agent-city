import { expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { runClaude } from '../src/cliRunner.js';

// Builds a fake child_process-like object: an EventEmitter with .stdout and
// .stderr EventEmitters, plus a .kill() spy. Emits the given stdout chunks
// (synchronously, one per microtask tick) then a 'close' event with exitCode.
function makeFakeChild({ chunks = [], stderrChunks = [], exitCode = 0, emitClose = true } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();

  queueMicrotask(() => {
    for (const chunk of chunks) {
      child.stdout.emit('data', Buffer.from(chunk));
    }
    for (const chunk of stderrChunks) {
      child.stderr.emit('data', Buffer.from(chunk));
    }
    if (emitClose) {
      child.emit('close', exitCode);
    }
  });

  return child;
}

test('runClaude merges env over process.env when given', async () => {
  const spawnFn = vi.fn(() => makeFakeChild({ exitCode: 0 }));
  await runClaude({ args: [], cwd: '/x', env: { FOO_TEST: 'bar' }, spawnFn }, () => {}).done;
  const opts = spawnFn.mock.calls[0][2];
  expect(opts.cwd).toBe('/x');
  expect(opts.env.FOO_TEST).toBe('bar');
  expect(opts.env.PATH).toBe(process.env.PATH);
});

function fakeSpawnWithChunks(chunks, exitCode = 0) {
  return vi.fn(() => makeFakeChild({ chunks, exitCode }));
}

function fakeSpawnExit(exitCode) {
  return vi.fn(() => makeFakeChild({ chunks: [], exitCode }));
}

// Fake child that emits 'error' instead of 'close' — simulates spawn failing
// outright (binary missing, EACCES, ...). Real child_process.spawn does not
// guarantee 'close'/'exit' follows an 'error'.
function fakeSpawnError(error) {
  return vi.fn(() => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    queueMicrotask(() => {
      child.emit('error', error);
    });
    return child;
  });
}

test('runClaude reassembles a line split across chunks and calls onEvent per event', async () => {
  const events = [];
  const spawnFn = fakeSpawnWithChunks(['{"type":"a"}\n{"type":"', 'b"}\n']);
  const { done } = runClaude({ args: ['-p'], cwd: '/tmp', spawnFn }, (e) => events.push(e));
  await done;
  expect(events).toEqual([{ type: 'a' }, { type: 'b' }]);
});

test('runClaude handles multiple complete lines arriving in a single chunk', async () => {
  const events = [];
  const spawnFn = fakeSpawnWithChunks(['{"type":"a"}\n{"type":"b"}\n{"type":"c"}\n']);
  const { done } = runClaude({ args: ['-p'], cwd: '/tmp', spawnFn }, (e) => events.push(e));
  await done;
  expect(events).toEqual([{ type: 'a' }, { type: 'b' }, { type: 'c' }]);
});

test('runClaude skips unparseable lines without throwing', async () => {
  const events = [];
  const spawnFn = fakeSpawnWithChunks(['not json\n{"type":"ok"}\n']);
  const { done } = runClaude({ args: ['-p'], cwd: '/tmp', spawnFn }, (e) => events.push(e));
  await done;
  expect(events).toEqual([{ type: 'ok' }]);
});

test('runClaude emits an event for a trailing line with no final newline, once the process closes', async () => {
  const events = [];
  const spawnFn = fakeSpawnWithChunks(['{"type":"a"}']);
  const { done } = runClaude({ args: ['-p'], cwd: '/tmp', spawnFn }, (e) => events.push(e));
  await done;
  expect(events).toEqual([{ type: 'a' }]);
});

test('done resolves with the process exit code', async () => {
  const spawnFn = fakeSpawnExit(2);
  const { done } = runClaude({ args: ['-p'], cwd: '/tmp', spawnFn }, () => {});
  expect(await done).toEqual({ exitCode: 2, stderr: '' });
});

test('runClaude passes args and cwd through to spawnFn', () => {
  const spawnFn = fakeSpawnExit(0);
  runClaude({ args: ['-p', '--foo'], cwd: '/some/dir', spawnFn }, () => {});
  expect(spawnFn).toHaveBeenCalledWith('claude', ['-p', '--foo'], { cwd: '/some/dir' });
});

test('kill() delegates to the underlying child process', () => {
  let capturedChild;
  const spawnFn = vi.fn(() => {
    capturedChild = makeFakeChild({ chunks: [], emitClose: false });
    return capturedChild;
  });
  const { kill } = runClaude({ args: ['-p'], cwd: '/tmp', spawnFn }, () => {});
  kill();
  expect(capturedChild.kill).toHaveBeenCalled();
});

test('done resolves exactly once with the correct exit code even if onEvent throws', async () => {
  const spawnFn = fakeSpawnWithChunks(['{"type":"a"}\n{"type":"b"}\n'], 3);
  const { done } = runClaude({ args: ['-p'], cwd: '/tmp', spawnFn }, () => {
    throw new Error('boom');
  });
  await expect(done).resolves.toEqual({ exitCode: 3, stderr: '' });
});

test('done resolves with exitCode: null and the error when spawning fails ("error" event, no "close")', async () => {
  const spawnError = new Error('ENOENT: claude not found');
  const spawnFn = fakeSpawnError(spawnError);
  const { done } = runClaude({ args: ['-p'], cwd: '/tmp', spawnFn }, () => {});
  // Resolving (rather than throwing/rejecting) proves no uncaught exception
  // propagated from the child's unhandled 'error' event.
  await expect(done).resolves.toEqual({ exitCode: null, error: spawnError, stderr: '' });
});

test('runClaude drains stderr and surfaces its text on done', async () => {
  const spawnFn = vi.fn(() =>
    makeFakeChild({
      stderrChunks: ['Error: When using --print, --output-format=stream-json ', 'requires --verbose\n'],
      exitCode: 1,
    }),
  );
  const { done } = runClaude({ args: ['-p'], cwd: '/tmp', spawnFn }, () => {});
  expect(await done).toEqual({
    exitCode: 1,
    stderr: 'Error: When using --print, --output-format=stream-json requires --verbose\n',
  });
});

test('runClaude keeps only a bounded tail of very large stderr output', async () => {
  const spawnFn = vi.fn(() =>
    makeFakeChild({ stderrChunks: ['x'.repeat(10000), 'THE-END'], exitCode: 1 }),
  );
  const { done } = runClaude({ args: ['-p'], cwd: '/tmp', spawnFn }, () => {});
  const { stderr } = await done;
  expect(stderr.length).toBeLessThanOrEqual(4000);
  expect(stderr.endsWith('THE-END')).toBe(true);
});

test('runClaude writes input to stdin and closes it', async () => {
  const child = makeFakeChild({ exitCode: 0 });
  child.stdin = { on: vi.fn(), end: vi.fn() };
  const spawnFn = vi.fn(() => child);
  await runClaude({ args: [], cwd: '/x', input: 'LINE\n', spawnFn }, () => {}).done;
  expect(child.stdin.end).toHaveBeenCalledWith('LINE\n');
});

test('runClaude leaves stdin alone when there is no input', async () => {
  const child = makeFakeChild({ exitCode: 0 });
  child.stdin = { on: vi.fn(), end: vi.fn() };
  await runClaude({ args: [], cwd: '/x', spawnFn: vi.fn(() => child) }, () => {}).done;
  expect(child.stdin.end).not.toHaveBeenCalled();
});
