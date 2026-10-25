import { test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ChatPanel } from './ChatPanel.jsx';
import * as api from '../api.js';

const agentId = '/a::doc-writer';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('loads and displays existing transcript on mount', async () => {
  vi.spyOn(api, 'fetchChat').mockResolvedValue({ transcript: [{ type: 'message', text: 'hello there' }], pending: null });

  render(<ChatPanel agentId={agentId} onClose={() => {}} />);

  await screen.findByText('hello there');
  expect(api.fetchChat).toHaveBeenCalledWith(agentId);
});

test('sending a message appends the new transcript entries', async () => {
  vi.spyOn(api, 'fetchChat').mockResolvedValue({ transcript: [{ type: 'message', text: 'hi' }], pending: null });
  const sendChatSpy = vi.spyOn(api, 'sendChat').mockResolvedValue([
    { type: 'message', text: 'hi' },
    { type: 'message', text: 'response' },
  ]);

  render(<ChatPanel agentId={agentId} onClose={() => {}} />);
  await screen.findByText('hi');

  fireEvent.change(screen.getByLabelText(/message/i), { target: { value: 'next message' } });
  fireEvent.click(screen.getByRole('button', { name: /send/i }));

  await screen.findByText('response');
  expect(sendChatSpy).toHaveBeenCalledWith(agentId, 'next message', []);
  // Earlier history is still there, not lost or duplicated.
  expect(screen.getAllByText('hi')).toHaveLength(1);
});

test('shows an already-running message instead of crashing on a 409', async () => {
  vi.spyOn(api, 'fetchChat').mockResolvedValue({ transcript: [], pending: null });
  const err = new Error('sendChat failed: 409');
  err.status = 409;
  vi.spyOn(api, 'sendChat').mockRejectedValue(err);

  render(<ChatPanel agentId={agentId} onClose={() => {}} />);
  await vi.waitFor(() => expect(api.fetchChat).toHaveBeenCalled());

  fireEvent.change(screen.getByLabelText(/message/i), { target: { value: 'hi' } });
  fireEvent.click(screen.getByRole('button', { name: /send/i }));

  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent(/already running/i);
});

test('clicking close calls onClose', async () => {
  vi.spyOn(api, 'fetchChat').mockResolvedValue({ transcript: [], pending: null });
  const onClose = vi.fn();
  render(<ChatPanel agentId={agentId} onClose={onClose} />);
  await vi.waitFor(() => expect(api.fetchChat).toHaveBeenCalled());

  fireEvent.click(screen.getByRole('button', { name: /close/i }));
  expect(onClose).toHaveBeenCalled();
});

test('renders real stream-json events as readable text, hiding init/tool-result noise', async () => {
  vi.spyOn(api, 'fetchChat').mockResolvedValue({ transcript: [
    { type: 'user_message', text: 'say hello' },
    { type: 'system', subtype: 'init', session_id: 'secret-session' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello from the agent' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'raw tool output' }] } },
    { type: 'result', is_error: false, result: 'Hello from the agent' },
  ], pending: null });

  render(<ChatPanel agentId={agentId} onClose={() => {}} />);

  await screen.findByText('Hello from the agent');
  expect(screen.getByText('say hello')).toBeInTheDocument();
  const transcript = screen.getByTestId('chat-transcript');
  expect(transcript).not.toHaveTextContent('secret-session');
  expect(transcript).not.toHaveTextContent('raw tool output');
  expect(transcript).not.toHaveTextContent('{');
  // The result event duplicating the final assistant text is not repeated.
  expect(screen.getAllByText('Hello from the agent')).toHaveLength(1);
});

test('the user\'s message appears in the transcript immediately while the turn runs', async () => {
  vi.spyOn(api, 'fetchChat').mockResolvedValue({ transcript: [], pending: null });
  let resolveSend;
  vi.spyOn(api, 'sendChat').mockReturnValue(
    new Promise((resolve) => {
      resolveSend = resolve;
    })
  );

  render(<ChatPanel agentId={agentId} onClose={() => {}} />);
  await vi.waitFor(() => expect(api.fetchChat).toHaveBeenCalled());

  fireEvent.change(screen.getByLabelText(/message/i), { target: { value: 'my question' } });
  fireEvent.click(screen.getByRole('button', { name: /send/i }));

  expect(await screen.findByText('my question')).toBeInTheDocument();

  resolveSend([
    { type: 'user_message', text: 'my question' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'my answer' }] } },
  ]);
  await screen.findByText('my answer');
  expect(screen.getAllByText('my question')).toHaveLength(1);
});

test('shows the server\'s real error text when a send fails', async () => {
  vi.spyOn(api, 'fetchChat').mockResolvedValue({ transcript: [], pending: null });
  const err = new Error('message must be a non-empty string');
  err.status = 400;
  vi.spyOn(api, 'sendChat').mockRejectedValue(err);

  render(<ChatPanel agentId={agentId} onClose={() => {}} />);
  await vi.waitFor(() => expect(api.fetchChat).toHaveBeenCalled());

  fireEvent.change(screen.getByLabelText(/message/i), { target: { value: 'hi' } });
  fireEvent.click(screen.getByRole('button', { name: /send/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent('message must be a non-empty string');
  // The unsent text is given back for a retry.
  expect(screen.getByLabelText(/message/i)).toHaveValue('hi');
});

test('reopened mid-turn, it shows the running message, then the reply once saved', async () => {
  vi.spyOn(api, 'fetchChat')
    .mockResolvedValueOnce({ transcript: [], pending: { type: 'user_message', text: 'long job' } })
    .mockResolvedValue({
      transcript: [
        { type: 'user_message', text: 'long job' },
        { type: 'result', is_error: false, result: 'finished it' },
      ],
      pending: null,
    });

  render(<ChatPanel agentId={agentId} onClose={() => {}} pollMs={10} />);

  expect(await screen.findByText('long job')).toBeInTheDocument();
  expect(screen.getByText('Working…')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();

  await screen.findByText('finished it');
  expect(screen.getAllByText('long job')).toHaveLength(1);
  expect(screen.queryByText('Working…')).toBeNull();
});
