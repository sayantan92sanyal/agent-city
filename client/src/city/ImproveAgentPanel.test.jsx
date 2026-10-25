import { test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ImproveAgentPanel } from './ImproveAgentPanel.jsx';
import * as api from '../api.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const agent = {
  id: '/p::article-reviewer',
  name: 'article-reviewer',
  description: 'The agent will review the draft of my article.',
  instructions: '',
  tools: ['Agent'],
};
const draft = {
  description: 'Reviews article drafts as an editor in chief.',
  instructions: 'You are an editor in chief.',
  tools: ['WebSearch', 'WebFetch', 'Read'],
};

test('drafts from the current agent plus requested changes, then saves the reviewed version', async () => {
  const draftSpy = vi.spyOn(api, 'draftAgent').mockResolvedValue(draft);
  const saveSpy = vi.spyOn(api, 'saveAgentDefinition').mockResolvedValue({ ...agent, ...draft });
  const onSaved = vi.fn();
  render(<ImproveAgentPanel agent={agent} onSaved={onSaved} onBack={() => {}} />);

  fireEvent.change(screen.getByLabelText(/what should change/i), { target: { value: 'Be stricter on grammar' } });
  fireEvent.click(screen.getByRole('button', { name: /improve with claude/i }));

  expect(await screen.findByLabelText(/^description/i)).toHaveValue(draft.description);
  expect(draftSpy).toHaveBeenCalledWith({
    name: 'article-reviewer',
    brief: 'The agent will review the draft of my article.\n\nChanges the user wants: Be stricter on grammar',
    current: { instructions: '', tools: ['Agent'] },
  });
  expect(screen.getByLabelText(/instructions/i)).toHaveValue('You are an editor in chief.');
  expect(screen.getByLabelText(/tools/i)).toHaveValue('WebSearch, WebFetch, Read');

  fireEvent.change(screen.getByLabelText(/tools/i), { target: { value: 'WebSearch, Read' } });
  fireEvent.click(screen.getByRole('button', { name: 'SAVE' }));
  await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...agent, ...draft }));
  expect(saveSpy).toHaveBeenCalledWith(agent.id, { ...draft, tools: ['WebSearch', 'Read'] });
});

test('shows a failed draft and stays on the first step', async () => {
  vi.spyOn(api, 'draftAgent').mockRejectedValue(new Error('Claude could not draft the agent: boom'));
  render(<ImproveAgentPanel agent={agent} onSaved={() => {}} onBack={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /improve with claude/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  expect(screen.getByRole('button', { name: /improve with claude/i })).toBeInTheDocument();
});
