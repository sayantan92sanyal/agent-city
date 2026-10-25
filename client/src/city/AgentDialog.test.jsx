import { test, expect, vi, afterEach, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AgentDialog } from './AgentDialog.jsx';
import * as api from '../api.js';

beforeEach(() => {
  vi.spyOn(api, 'fetchTasks').mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const doneTask = {
  id: 't1',
  status: 'done',
  message: 'tidy the docs',
  seen: false,
  transcript: [
    { type: 'user_message', text: 'tidy the docs' },
    { type: 'result', is_error: false, result: 'one-off result' },
  ],
};

const agent = {
  id: 'proj-a',
  name: 'My Agent',
  description: 'Does things',
  tools: ['Read'],
  model: 'sonnet',
  projectPath: '/a',
  filePath: '/a/.claude/agents/my-agent.md',
};

test('shows name, description, and status text in a labelled dialog', () => {
  const { rerender } = render(<AgentDialog agent={agent} status="idle" onClose={() => {}} />);
  expect(screen.getByRole('dialog', { name: 'My Agent' })).toBeInTheDocument();
  expect(screen.getByText('Does things')).toBeInTheDocument();
  expect(screen.getByText('IDLE')).toBeInTheDocument();
  rerender(<AgentDialog agent={agent} status="working" onClose={() => {}} />);
  expect(screen.getByText('WORKING')).toBeInTheDocument();
});

test('TALK opens the ChatPanel for the agent', async () => {
  vi.spyOn(api, 'fetchChat').mockResolvedValue({ transcript: [{ type: 'message', text: 'previous turn' }], pending: null });
  render(<AgentDialog agent={agent} status="idle" onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'TALK' }));
  expect(api.fetchChat).toHaveBeenCalledWith(agent.id);
  await screen.findByText('previous turn');
});

test('GIVE TASK: RUN is disabled when blank, then starts the task and shows its result', async () => {
  const spy = vi.spyOn(api, 'startTask').mockResolvedValue({ id: 't1', status: 'running', message: 'tidy the docs' });
  vi.spyOn(api, 'fetchTask').mockResolvedValue(doneTask);
  vi.spyOn(api, 'markTaskSeen').mockResolvedValue();
  render(<AgentDialog agent={agent} status="idle" onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'GIVE TASK' }));
  expect(screen.getByRole('button', { name: 'RUN' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/task/i), { target: { value: 'tidy the docs' } });
  fireEvent.click(screen.getByRole('button', { name: 'RUN' }));
  expect(spy).toHaveBeenCalledWith(agent.id, 'tidy the docs', []);
  await screen.findByText('one-off result');
  expect(api.fetchTask).toHaveBeenCalledWith('t1');
  expect(api.markTaskSeen).toHaveBeenCalledWith('t1');
});

test('under StrictMode a submitted task is started exactly once', async () => {
  const spy = vi.spyOn(api, 'startTask').mockResolvedValue({ id: 't1', status: 'running', message: 'x' });
  vi.spyOn(api, 'fetchTask').mockResolvedValue(doneTask);
  vi.spyOn(api, 'markTaskSeen').mockResolvedValue();
  render(
    <StrictMode>
      <AgentDialog agent={agent} status="idle" onClose={() => {}} />
    </StrictMode>
  );
  fireEvent.click(screen.getByRole('button', { name: 'GIVE TASK' }));
  fireEvent.change(screen.getByLabelText(/task/i), { target: { value: 'tidy the docs' } });
  fireEvent.click(screen.getByRole('button', { name: 'RUN' }));
  await screen.findByText('one-off result');
  expect(spy).toHaveBeenCalledTimes(1);
});

test('a task that fails to start keeps the draft and shows why', async () => {
  vi.spyOn(api, 'startTask').mockRejectedValue(new Error('"a.zip" is not a supported file type'));
  render(<AgentDialog agent={agent} status="idle" onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'GIVE TASK' }));
  fireEvent.change(screen.getByLabelText(/task/i), { target: { value: 'tidy' } });
  fireEvent.click(screen.getByRole('button', { name: 'RUN' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/not a supported file type/);
  expect(screen.getByLabelText(/task/i)).toHaveValue('tidy');
});

test('recent tasks are listed with status and a NEW flag, and open their result', async () => {
  api.fetchTasks.mockResolvedValue([
    { id: 't1', status: 'done', message: 'tidy the docs', seen: false, startedAt: new Date().toISOString() },
    { id: 't2', status: 'running', message: 'still going', seen: false, startedAt: new Date().toISOString() },
  ]);
  vi.spyOn(api, 'fetchTask').mockResolvedValue(doneTask);
  vi.spyOn(api, 'markTaskSeen').mockResolvedValue();
  render(<AgentDialog agent={agent} status="idle" onClose={() => {}} />);

  const done = await screen.findByRole('button', { name: /tidy the docs/ });
  expect(done).toHaveTextContent('DONE');
  expect(done).toHaveTextContent('NEW');
  expect(screen.getByRole('button', { name: /still going/ })).toHaveTextContent('RUNNING');
  expect(screen.getByRole('button', { name: /still going/ })).not.toHaveTextContent('NEW');

  fireEvent.click(done);
  await screen.findByText('one-off result');
});

test('a broken agent shows file name and error, with only a CLOSE button', () => {
  const onClose = vi.fn();
  const broken = {
    id: 'x',
    name: 'bad.md',
    filePath: '/a/.claude/agents/bad.md',
    error: 'bad frontmatter',
  };
  render(<AgentDialog agent={broken} status="idle" onClose={onClose} />);
  expect(screen.getByText('bad frontmatter')).toBeInTheDocument();
  expect(screen.getAllByText(/bad\.md/).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: 'TALK' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'GIVE TASK' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'CLOSE' }));
  expect(onClose).toHaveBeenCalled();
});

test('IMPROVE opens Improve with Claude and BACK returns to the menu', () => {
  render(<AgentDialog agent={{ id: '/p::a', name: 'a', description: 'Does things', tools: [] }} status="idle" onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'IMPROVE' }));
  expect(screen.getByRole('button', { name: /improve with claude/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'BACK' }));
  expect(screen.getByRole('button', { name: 'TALK' })).toBeInTheDocument();
});

test('DELETE asks first, then moves the agent to the Trash', async () => {
  const spy = vi.spyOn(api, 'deleteAgent').mockResolvedValue({ trashedTo: '/Users/me/.Trash/a.md' });
  const onDeleted = vi.fn();
  const agent = { id: '/p::a', name: 'a', description: 'Does things', tools: [], filePath: '/p/.claude/agents/a.md' };
  render(<AgentDialog agent={agent} status="idle" onClose={() => {}} onDeleted={onDeleted} />);
  fireEvent.click(screen.getByRole('button', { name: 'DELETE' }));
  expect(screen.getByText(/Move/)).toHaveTextContent('Move a to the Trash?');
  expect(spy).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'MOVE TO TRASH' }));
  await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledWith(agent));
  expect(spy).toHaveBeenCalledWith('/p::a');
});
