import { beforeEach, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const runOneOffMock = vi.fn();
vi.mock('../src/sessionManager.js', () => ({
  runOneOff: (...args) => runOneOffMock(...args),
}));

const { startTask, getTask, listTasks, markTaskSeen, unseenTaskCounts } = await import('../src/taskStore.js');

const agent = { id: '/p::writer', name: 'writer' };
const ok = [{ type: 'result', result: 'all done', is_error: false }];

beforeEach(() => {
  process.env.AGENT_PANEL_HOME = mkdtempSync(join(tmpdir(), 'acp-tasks-'));
  runOneOffMock.mockReset();
});

test('a task is saved as running at once, and its result is saved when the run ends', async () => {
  let finish;
  runOneOffMock.mockReturnValue(new Promise((r) => (finish = r)));
  const { task, finished } = startTask(agent, 'write it', []);

  expect(getTask(task.id)).toMatchObject({ status: 'running', agentId: agent.id, message: 'write it', seen: false });
  expect(runOneOffMock).toHaveBeenCalledWith(agent, 'write it', []);

  finish(ok);
  await finished;
  const done = getTask(task.id);
  expect(done).toMatchObject({ status: 'done', transcript: ok, seen: false });
  expect(done.finishedAt).toBeTruthy();
  expect(done.error).toBeUndefined();
});

test('an error result or a thrown run marks the task failed with the reason', async () => {
  runOneOffMock.mockResolvedValueOnce([{ type: 'result', result: 'nope', is_error: true }]);
  const a = startTask(agent, 'x');
  await a.finished;
  expect(getTask(a.task.id)).toMatchObject({ status: 'failed', error: 'nope' });

  runOneOffMock.mockRejectedValueOnce(new Error('spawn failed'));
  const b = startTask(agent, 'y');
  await b.finished;
  expect(getTask(b.task.id)).toMatchObject({ status: 'failed', error: 'spawn failed' });
});

test('finished tasks count as unseen until opened', async () => {
  runOneOffMock.mockResolvedValue(ok);
  const { task, finished } = startTask(agent, 'x');
  expect(unseenTaskCounts()).toEqual({}); // running tasks are not "results" yet
  await finished;
  expect(unseenTaskCounts()).toEqual({ [agent.id]: 1 });
  markTaskSeen(task.id);
  expect(unseenTaskCounts()).toEqual({});
  expect(getTask(task.id).seen).toBe(true);
});

test('listTasks is newest first, per agent, without transcripts', async () => {
  runOneOffMock.mockResolvedValue(ok);
  const first = startTask(agent, 'first');
  await first.finished;
  await new Promise((r) => setTimeout(r, 5));
  const second = startTask(agent, 'second');
  await second.finished;
  await startTask({ id: '/p::other', name: 'other' }, 'elsewhere').finished;

  const list = listTasks(agent.id);
  expect(list.map((t) => t.message)).toEqual(['second', 'first']);
  expect(list[0].transcript).toBeUndefined();
});

test('a task left "running" by a previous server process reads as failed', () => {
  const id = '11111111-1111-1111-1111-111111111111';
  const dir = join(process.env.AGENT_PANEL_HOME, 'tasks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ id, agentId: agent.id, status: 'running', startedAt: 'x', seen: false }));
  expect(getTask(id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/restarted/) });
  expect(unseenTaskCounts()).toEqual({ [agent.id]: 1 });
});

test('getTask and markTaskSeen refuse ids that are not uuids', () => {
  expect(getTask('../config')).toBeNull();
  expect(markTaskSeen('../config')).toBeNull();
});
