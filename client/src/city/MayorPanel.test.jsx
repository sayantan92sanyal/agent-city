import { test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MayorPanel } from './MayorPanel.jsx';
import * as api from '../api.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('loads and shows the Mayor transcript under a MAYOR heading', async () => {
  vi.spyOn(api, 'fetchMayorChat').mockResolvedValue([{ type: 'user_message', text: 'hello mayor' }]);
  render(<MayorPanel links={[]} agentsById={{}} onClose={() => {}} />);
  await screen.findByText('hello mayor');
  expect(screen.getByRole('heading', { name: 'MAYOR' })).toBeInTheDocument();
});

test('sending shows the user message, then the returned transcript', async () => {
  vi.spyOn(api, 'fetchMayorChat').mockResolvedValue([]);
  let resolveSend;
  vi.spyOn(api, 'sendMayorChat').mockReturnValue(new Promise((r) => (resolveSend = r)));
  render(<MayorPanel links={[]} agentsById={{}} onClose={() => {}} />);
  await vi.waitFor(() => expect(api.fetchMayorChat).toHaveBeenCalled());

  fireEvent.change(screen.getByLabelText(/message/i), { target: { value: 'ask around' } });
  fireEvent.click(screen.getByRole('button', { name: /send/i }));
  await screen.findByText('ask around');
  expect(api.sendMayorChat).toHaveBeenCalledWith('ask around', []);

  resolveSend([
    { type: 'user_message', text: 'ask around' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'done asking' }] } },
  ]);
  await screen.findByText('done asking');
  expect(screen.getAllByText('ask around')).toHaveLength(1);
});

test('a 409 shows the Mayor-is-busy alert', async () => {
  vi.spyOn(api, 'fetchMayorChat').mockResolvedValue([]);
  const err = new Error('busy');
  err.status = 409;
  vi.spyOn(api, 'sendMayorChat').mockRejectedValue(err);
  render(<MayorPanel links={[]} agentsById={{}} onClose={() => {}} />);
  await vi.waitFor(() => expect(api.fetchMayorChat).toHaveBeenCalled());

  fireEvent.change(screen.getByLabelText(/message/i), { target: { value: 'hi' } });
  fireEvent.click(screen.getByRole('button', { name: /send/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Mayor is still busy/i);
});

test('WAITING ON lists mayor links by agent name and label, and hides when empty', async () => {
  vi.spyOn(api, 'fetchMayorChat').mockResolvedValue([]);
  const links = [
    { id: 'l1', from: 'mayor', to: '/p::growth', label: 'checking users' },
    { id: 'l2', from: 'mayor', to: '/q::ops', label: 'checking uptime' },
    { id: 'l3', from: '/p::a', to: '/p::b', label: 'ignored' },
  ];
  const { rerender } = render(
    <MayorPanel links={links} agentsById={{ '/p::growth': { name: 'Growth Guru' } }} onClose={() => {}} />
  );
  expect(screen.getByRole('heading', { name: 'WAITING ON' })).toBeInTheDocument();
  expect(screen.getByText(/Growth Guru/)).toHaveTextContent('checking users');
  expect(screen.getByText(/ops/)).toHaveTextContent('checking uptime');
  expect(screen.queryByText(/ignored/)).toBeNull();

  rerender(<MayorPanel links={[links[2]]} agentsById={{}} onClose={() => {}} />);
  expect(screen.queryByRole('heading', { name: 'WAITING ON' })).toBeNull();
  await vi.waitFor(() => expect(api.fetchMayorChat).toHaveBeenCalled());
});

test('labels Mayor replies MAYOR, not Agent', async () => {
  vi.spyOn(api, 'fetchMayorChat').mockResolvedValue([
    { type: 'assistant', message: { content: [{ type: 'text', text: 'greetings' }] } },
  ]);
  render(<MayorPanel onClose={() => {}} />);
  await screen.findByText('greetings');
  expect(screen.getByText('MAYOR', { selector: '.transcript-speaker' })).toBeInTheDocument();
  expect(screen.queryByText('Agent')).toBeNull();
});

test('reopened mid-turn shows the working row and disables Send', async () => {
  vi.spyOn(api, 'fetchMayorChat').mockResolvedValue([]);
  render(<MayorPanel mayorStatus="working" onClose={() => {}} />);
  await screen.findByText(/The Mayor is working/);
  fireEvent.change(screen.getByLabelText(/message/i), { target: { value: 'hi' } });
  expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
});

test('working -> idle refetches and shows the new reply', async () => {
  const fetchSpy = vi.spyOn(api, 'fetchMayorChat').mockResolvedValueOnce([]);
  const { rerender } = render(<MayorPanel mayorStatus="working" onClose={() => {}} />);
  await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  fetchSpy.mockResolvedValueOnce([
    { type: 'assistant', message: { content: [{ type: 'text', text: 'fresh reply' }] } },
  ]);
  rerender(<MayorPanel mayorStatus="idle" onClose={() => {}} />);
  await screen.findByText('fresh reply');
  expect(fetchSpy).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(/The Mayor is working/)).toBeNull();
});
