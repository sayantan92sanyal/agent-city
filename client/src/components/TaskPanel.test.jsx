import { test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TaskPanel } from './TaskPanel.jsx';
import * as api from '../api.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const running = { id: 't1', status: 'running', message: 'do the thing', seen: false };
const done = {
  ...running,
  status: 'done',
  transcript: [
    { type: 'user_message', text: 'do the thing' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'all done' }] } },
  ],
};

test('shows the task while it runs, polls, then shows the result and marks it read', async () => {
  vi.spyOn(api, 'fetchTask').mockResolvedValueOnce(running).mockResolvedValue(done);
  vi.spyOn(api, 'markTaskSeen').mockResolvedValue();

  render(<TaskPanel taskId="t1" initialTask={running} pollMs={10} onClose={() => {}} />);

  expect(screen.getByText('do the thing')).toBeInTheDocument();
  expect(screen.getByText(/result is saved/i)).toBeInTheDocument();

  await screen.findByText('all done');
  expect(screen.getAllByText('do the thing')).toHaveLength(1);
  expect(screen.queryByText(/result is saved/i)).toBeNull();
  await waitFor(() => expect(api.markTaskSeen).toHaveBeenCalledWith('t1'));
});

test('an already-read result is not marked again', async () => {
  vi.spyOn(api, 'fetchTask').mockResolvedValue({ ...done, seen: true });
  const seen = vi.spyOn(api, 'markTaskSeen').mockResolvedValue();
  render(<TaskPanel taskId="t1" onClose={() => {}} />);
  await screen.findByText('all done');
  expect(seen).not.toHaveBeenCalled();
});

test('a failed task shows its error', async () => {
  vi.spyOn(api, 'fetchTask').mockResolvedValue({ ...running, status: 'failed', error: 'The server restarted before this task finished.', transcript: [] });
  vi.spyOn(api, 'markTaskSeen').mockResolvedValue();
  render(<TaskPanel taskId="t1" onClose={() => {}} />);
  expect(await screen.findByText(/server restarted/)).toBeInTheDocument();
});

test('closing stops polling', async () => {
  const fetchSpy = vi.spyOn(api, 'fetchTask').mockResolvedValue(running);
  const onClose = vi.fn();
  const { unmount } = render(<TaskPanel taskId="t1" pollMs={10} onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalled();
  await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  unmount();
  const calls = fetchSpy.mock.calls.length;
  await new Promise((r) => setTimeout(r, 50));
  expect(fetchSpy.mock.calls.length).toBe(calls);
});

test('a finished task takes a follow-up, shows it while it runs, then shows the reply', async () => {
  const finished = { ...done, sessionId: 's1', seen: true };
  const followUp = { type: 'user_message', text: 'and per agent?' };
  const reply = { type: 'assistant', message: { content: [{ type: 'text', text: 'per agent: fine' }] } };
  vi.spyOn(api, 'fetchTask')
    .mockResolvedValueOnce(finished)
    .mockResolvedValueOnce({ ...finished, status: 'running', pending: followUp })
    .mockResolvedValue({ ...finished, transcript: [...done.transcript, followUp, reply] });
  const send = vi.spyOn(api, 'sendTaskFollowUp').mockResolvedValue({ ...finished, status: 'running', pending: followUp, transcript: undefined });

  render(<TaskPanel taskId="t1" pollMs={10} onClose={() => {}} />);
  await screen.findByText('all done');
  const box = screen.getByRole('textbox', { name: 'Follow-up' });
  fireEvent.change(box, { target: { value: 'and per agent?' } });
  fireEvent.keyDown(box, { key: 'Enter' });

  await waitFor(() => expect(send).toHaveBeenCalledWith('t1', 'and per agent?', []));
  expect(await screen.findByText('and per agent?')).toBeInTheDocument();
  expect(screen.getByText('all done')).toBeInTheDocument();
  expect(await screen.findByText('per agent: fine')).toBeInTheDocument();
});

test('the follow-up box waits while the task runs, and is hidden for tasks without a session', async () => {
  vi.spyOn(api, 'fetchTask').mockResolvedValue({ ...running, sessionId: 's1' });
  const { unmount } = render(<TaskPanel taskId="t1" onClose={() => {}} />);
  fireEvent.change(await screen.findByRole('textbox', { name: 'Follow-up' }), { target: { value: 'hi' } });
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  unmount();

  vi.spyOn(api, 'fetchTask').mockResolvedValue({ ...done, seen: true });
  render(<TaskPanel taskId="t1" onClose={() => {}} />);
  await screen.findByText('all done');
  expect(screen.queryByRole('textbox', { name: 'Follow-up' })).toBeNull();
});

test('a refused follow-up shows the reason and keeps the draft', async () => {
  vi.spyOn(api, 'fetchTask').mockResolvedValue({ ...done, sessionId: 's1', seen: true });
  vi.spyOn(api, 'sendTaskFollowUp').mockRejectedValue(new Error('This task is still running.'));
  render(<TaskPanel taskId="t1" onClose={() => {}} />);
  await screen.findByText('all done');
  const box = screen.getByRole('textbox', { name: 'Follow-up' });
  fireEvent.change(box, { target: { value: 'more please' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(await screen.findByRole('alert')).toHaveTextContent('still running');
  expect(box).toHaveValue('more please');
});
