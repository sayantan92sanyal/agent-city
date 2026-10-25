import { test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CreateAgentModal } from './CreateAgentModal.jsx';
import * as api from '../api.js';

const projectPath = '/a';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('submit is disabled until name and description are filled', () => {
  render(<CreateAgentModal projectPath={projectPath} onCreated={() => {}} onCancel={() => {}} />);

  const submitButton = screen.getByRole('button', { name: /create/i });
  expect(submitButton).toBeDisabled();

  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Doc Writer' } });
  expect(submitButton).toBeDisabled();

  fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'writes docs' } });
  expect(submitButton).not.toBeDisabled();
});

test('submit stays disabled when only description is filled', () => {
  render(<CreateAgentModal projectPath={projectPath} onCreated={() => {}} onCancel={() => {}} />);

  fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'writes docs' } });

  expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();
});

const serverAgentResponse = {
  projectPath: '/a',
  name: 'Doc Writer',
  model: 'sonnet',
  description: 'writes docs',
  tools: ['Read', 'Write'],
  filePath: '/a/.claude/agents/doc-writer.md',
};

test('submitting calls createAgent with the typed values, tools split into an array', async () => {
  const createAgentSpy = vi.spyOn(api, 'createAgent').mockResolvedValue(serverAgentResponse);
  const onCreated = vi.fn();

  render(<CreateAgentModal projectPath={projectPath} onCreated={onCreated} onCancel={() => {}} />);

  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Doc Writer' } });
  fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'writes docs' } });
  fireEvent.change(screen.getByLabelText(/tools/i), { target: { value: 'Read, Write,' } });

  fireEvent.click(screen.getByRole('button', { name: /create/i }));

  await vi.waitFor(() => {
    expect(createAgentSpy).toHaveBeenCalledWith(projectPath, {
      name: 'Doc Writer',
      model: 'sonnet',
      description: 'writes docs',
      tools: ['Read', 'Write'],
    });
  });

  await vi.waitFor(() => {
    expect(onCreated).toHaveBeenCalledWith(serverAgentResponse);
  });
});

test('shows an error and does not call onCreated when the agent name already exists (409)', async () => {
  vi.spyOn(api, 'createAgent').mockRejectedValue(new Error('createAgent failed: 409'));
  const onCreated = vi.fn();

  render(<CreateAgentModal projectPath={projectPath} onCreated={onCreated} onCancel={() => {}} />);

  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Doc Writer' } });
  fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'writes docs' } });

  fireEvent.click(screen.getByRole('button', { name: /create/i }));

  await vi.waitFor(() => {
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
  expect(onCreated).not.toHaveBeenCalled();
});

test('clicking cancel calls onCancel', () => {
  const onCancel = vi.fn();
  render(<CreateAgentModal projectPath={projectPath} onCreated={() => {}} onCancel={onCancel} />);

  fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

  expect(onCancel).toHaveBeenCalled();
});

test('ticking "Can call other agents" appends Agent without duplicating', async () => {
  const spy = vi.spyOn(api, 'createAgent').mockResolvedValue(serverAgentResponse);
  render(<CreateAgentModal projectPath={projectPath} onCreated={() => {}} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Boss' } });
  fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'bosses' } });
  fireEvent.change(screen.getByLabelText(/tools/i), { target: { value: 'Read, Agent' } });
  fireEvent.click(screen.getByLabelText('Can call other agents in this playground'));
  fireEvent.click(screen.getByRole('button', { name: /create/i }));
  await vi.waitFor(() => expect(spy).toHaveBeenCalled());
  expect(spy.mock.calls[0][1].tools).toEqual(['Read', 'Agent']);
});

test('with no tools typed, the checkbox keeps the full default set instead of only Agent', async () => {
  const spy = vi.spyOn(api, 'createAgent').mockResolvedValue(serverAgentResponse);
  render(<CreateAgentModal projectPath={projectPath} onCreated={() => {}} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Boss' } });
  fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'bosses' } });
  fireEvent.click(screen.getByLabelText('Can call other agents in this playground'));
  fireEvent.click(screen.getByRole('button', { name: /create/i }));
  await vi.waitFor(() => expect(spy).toHaveBeenCalled());
  expect(spy.mock.calls[0][1].tools).toEqual([]);
});

test('Draft with Claude fills description, instructions and tools for review', async () => {
  const draftSpy = vi.spyOn(api, 'draftAgent').mockResolvedValue({
    description: 'Reviews article drafts. Use when the user shares one.',
    instructions: 'You are an editor in chief.',
    tools: ['WebSearch', 'WebFetch'],
  });
  const createSpy = vi.spyOn(api, 'createAgent').mockResolvedValue(serverAgentResponse);
  render(<CreateAgentModal projectPath={projectPath} onCreated={() => {}} onCancel={() => {}} />);
  const draftButton = screen.getByRole('button', { name: /draft with claude/i });
  expect(draftButton).toBeDisabled();

  fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'article-reviewer' } });
  fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'review my drafts' } });
  fireEvent.click(draftButton);

  await vi.waitFor(() => expect(screen.getByLabelText(/description/i)).toHaveValue('Reviews article drafts. Use when the user shares one.'));
  expect(draftSpy).toHaveBeenCalledWith({ name: 'article-reviewer', brief: 'review my drafts' });
  expect(screen.getByLabelText(/instructions/i)).toHaveValue('You are an editor in chief.');
  expect(screen.getByLabelText(/tools/i)).toHaveValue('WebSearch, WebFetch');

  fireEvent.change(screen.getByLabelText(/instructions/i), { target: { value: 'You are a strict editor in chief.' } });
  fireEvent.click(screen.getByRole('button', { name: /create/i }));
  await vi.waitFor(() => expect(createSpy).toHaveBeenCalled());
  expect(createSpy.mock.calls[0][1]).toEqual({
    name: 'article-reviewer',
    model: 'sonnet',
    description: 'Reviews article drafts. Use when the user shares one.',
    instructions: 'You are a strict editor in chief.',
    tools: ['WebSearch', 'WebFetch'],
  });
});

test('a failed draft shows the error and keeps what was typed', async () => {
  vi.spyOn(api, 'draftAgent').mockRejectedValue(new Error('Claude could not draft the agent: boom'));
  render(<CreateAgentModal projectPath={projectPath} onCreated={() => {}} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'x' } });
  fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'my brief' } });
  fireEvent.click(screen.getByRole('button', { name: /draft with claude/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  expect(screen.getByLabelText(/description/i)).toHaveValue('my brief');
});

test('ticking the checkbox adds Agent when not typed', async () => {
  const spy = vi.spyOn(api, 'createAgent').mockResolvedValue(serverAgentResponse);
  render(<CreateAgentModal projectPath={projectPath} onCreated={() => {}} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Boss' } });
  fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'bosses' } });
  fireEvent.change(screen.getByLabelText(/tools/i), { target: { value: 'Read' } });
  fireEvent.click(screen.getByLabelText('Can call other agents in this playground'));
  fireEvent.click(screen.getByRole('button', { name: /create/i }));
  await vi.waitFor(() => expect(spy).toHaveBeenCalled());
  expect(spy.mock.calls[0][1].tools).toEqual(['Read', 'Agent']);
});
