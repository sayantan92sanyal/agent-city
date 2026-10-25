import { test, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { App } from './App.jsx';
import * as api from './api.js';
import * as chatApi from './chat/chatApi.js';

const agent = {
  id: '/a::reviewer',
  name: 'reviewer',
  description: 'Reviews',
  tools: [],
  model: 'sonnet',
  projectPath: '/a',
  filePath: '/a/.claude/agents/reviewer.md',
};

beforeEach(() => {
  vi.spyOn(api, 'fetchCityStatus').mockResolvedValue({ agents: {}, mayor: 'idle', links: [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.location.hash = '';
});

test('saving settings refetches the agent list and closes the panel', async () => {
  const fetchAgents = vi
    .spyOn(api, 'fetchAgents')
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ projectPath: '/a', projectName: 'a', agents: [agent] }]);
  vi.spyOn(api, 'fetchRoots').mockResolvedValue([]);
  vi.spyOn(api, 'saveRoots').mockResolvedValue(['/a']);

  render(<App />);
  await vi.waitFor(() => expect(fetchAgents).toHaveBeenCalledTimes(1));

  fireEvent.click(screen.getByRole('button', { name: /settings/i }));
  await vi.waitFor(() => expect(api.fetchRoots).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

  await screen.findByText('reviewer');
  expect(fetchAgents).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('dialog', { name: /settings/i })).not.toBeInTheDocument();
});

test('the Rescan button refetches the agent list', async () => {
  const fetchAgents = vi
    .spyOn(api, 'fetchAgents')
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ projectPath: '/a', projectName: 'a', agents: [agent] }]);

  render(<App />);
  const rescan = await screen.findByRole('button', { name: /rescan/i });

  fireEvent.click(rescan);

  await screen.findByText('reviewer');
  expect(fetchAgents).toHaveBeenCalledTimes(2);
});

test('the HUD shows playground, agent and working counts', async () => {
  const writer = { ...agent, id: '/b::writer', name: 'writer', projectPath: '/b' };
  vi.spyOn(api, 'fetchAgents').mockResolvedValue([
    { projectPath: '/a', projectName: 'a', agents: [agent] },
    { projectPath: '/b', projectName: 'b', agents: [writer] },
    { projectPath: '/c', projectName: 'c', agents: [] },
  ]);
  api.fetchCityStatus.mockResolvedValue({
    agents: { '/b::writer': 'working', '/a::reviewer': 'idle', '/gone::x': 'working' },
    mayor: 'idle',
    links: [],
  });

  render(<App />);

  expect(screen.getByRole('heading', { name: 'AGENT CITY' })).toBeInTheDocument();
  expect(await screen.findByText('PLAYGROUNDS 3')).toBeInTheDocument();
  expect(screen.getByText('AGENTS 2')).toBeInTheDocument();
  expect(await screen.findByText('WORKING 1')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'writer, working' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '+ PLAYGROUND' })).toBeInTheDocument();
});

test('the rail switches between the city and the chat screen, keeping the view in the hash', async () => {
  vi.spyOn(api, 'fetchAgents').mockResolvedValue([]);
  vi.spyOn(chatApi, 'listChats').mockResolvedValue([]);
  window.location.hash = '';

  render(<App />);
  const rail = screen.getByRole('navigation', { name: 'Views' });
  const city = within(rail).getByRole('button', { name: 'City' });
  const chat = within(rail).getByRole('button', { name: 'Chat' });
  expect(city).toHaveAttribute('aria-pressed', 'true');
  expect(chat).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('button', { name: 'Mayor, idle' })).toBeInTheDocument();

  fireEvent.click(chat);
  expect(await screen.findByRole('heading', { name: 'CHATS' })).toBeInTheDocument();
  expect(window.location.hash).toBe('#chat');
  expect(chat).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('heading', { name: 'AGENT CITY' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Mayor, idle' })).toBeNull();

  fireEvent.click(city);
  expect(await screen.findByRole('button', { name: 'Mayor, idle' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'AGENT CITY' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'CHATS' })).toBeNull();
  expect(window.location.hash).toBe('');
});

test('opening the app at #chat shows the chat screen', async () => {
  vi.spyOn(api, 'fetchAgents').mockResolvedValue([]);
  vi.spyOn(chatApi, 'listChats').mockResolvedValue([]);
  window.location.hash = '#chat';

  render(<App />);
  expect(screen.getByRole('heading', { name: 'CHATS' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-pressed', 'true');
  await vi.waitFor(() => expect(chatApi.listChats).toHaveBeenCalled());
});

test('a hire post opens the create-agent modal for that project and reloads after create', async () => {
  const fetchAgents = vi
    .spyOn(api, 'fetchAgents')
    .mockResolvedValueOnce([{ projectPath: '/a', projectName: 'a', agents: [] }])
    .mockResolvedValueOnce([{ projectPath: '/a', projectName: 'a', agents: [agent] }]);
  const createAgent = vi.spyOn(api, 'createAgent').mockResolvedValue(agent);

  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Hire an agent in a' }));

  const dialog = screen.getByRole('dialog', { name: 'Create agent' });
  expect(dialog).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'reviewer' } });
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Reviews' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));

  await screen.findByRole('button', { name: 'reviewer, idle' });
  expect(createAgent).toHaveBeenCalledWith('/a', expect.objectContaining({ name: 'reviewer' }));
  expect(fetchAgents).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('dialog', { name: 'Create agent' })).not.toBeInTheDocument();
});
