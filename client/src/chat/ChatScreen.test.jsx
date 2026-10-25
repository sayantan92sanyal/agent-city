import { test, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ChatScreen } from './ChatScreen.jsx';
import * as chatApi from './chatApi.js';

const settings = { model: '', effort: 'high', disabledConnectors: [], folder: '/home/me' };

function makeChat(id, overrides = {}) {
  return { id, title: `Chat ${id}`, settings, sessionStarted: false, running: false, transcript: [], files: [], ...overrides };
}

function summary(chat) {
  return { id: chat.id, title: chat.title, updatedAt: '2026-10-23T10:00:00.000Z', running: chat.running };
}

function liveTurn(text, partialText) {
  return { userEntry: { type: 'user_message', text }, events: [], partialText };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.spyOn(chatApi, 'listChats').mockResolvedValue([]);
  vi.spyOn(chatApi, 'fetchChatSettings').mockResolvedValue({
    settings,
    models: [{ value: '', label: 'Default' }, { value: 'opus', label: 'Opus' }],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  });
  vi.spyOn(chatApi, 'fetchConnectors').mockResolvedValue({ connectors: [], error: null });
  vi.spyOn(chatApi, 'getChat').mockImplementation(async (id) => ({ chat: makeChat(id), live: null }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('lists chats and opens the newest', async () => {
  const newest = makeChat('b', { title: 'Newest', transcript: [{ type: 'user_message', text: 'from b' }] });
  chatApi.listChats.mockResolvedValue([summary(newest), summary(makeChat('a', { title: 'Older' }))]);
  chatApi.getChat.mockImplementation(async (id) => ({ chat: id === 'b' ? newest : makeChat(id), live: null }));

  render(<ChatScreen pollMs={10} />);

  expect(screen.getByRole('heading', { name: 'CHATS' })).toBeInTheDocument();
  expect(await screen.findByText('from b')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Older' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Newest' })).toHaveAttribute('aria-current', 'true');
  expect(chatApi.getChat).toHaveBeenCalledWith('b');
  expect(chatApi.getChat).not.toHaveBeenCalledWith('a');
});

test('shows an empty New chat state when there are no chats', async () => {
  render(<ChatScreen pollMs={10} />);
  expect(await screen.findByText(/no chats yet/i)).toBeInTheDocument();
  expect(chatApi.getChat).not.toHaveBeenCalled();
});

test('NEW CHAT creates and selects a chat', async () => {
  const created = makeChat('n', { title: 'New chat' });
  const createChat = vi.spyOn(chatApi, 'createChat').mockResolvedValue(created);

  render(<ChatScreen pollMs={10} />);
  await screen.findByText(/no chats yet/i);
  fireEvent.click(screen.getByRole('button', { name: '+ NEW CHAT' }));

  expect(await screen.findByRole('button', { name: 'New chat' })).toHaveAttribute('aria-current', 'true');
  expect(createChat).toHaveBeenCalledWith();
  await vi.waitFor(() => expect(chatApi.getChat).toHaveBeenCalledWith('n'));
  expect(screen.getByLabelText('Message')).toBeInTheDocument();
});

test('streams partial text then shows the final reply', async () => {
  const chat = makeChat('a', { running: true });
  chatApi.listChats.mockResolvedValue([summary(chat)]);
  const hel = deferred();
  const hello = deferred();
  const done = deferred();
  chatApi.getChat
    .mockReturnValueOnce(hel.promise)
    .mockReturnValueOnce(hello.promise)
    .mockReturnValueOnce(done.promise);

  render(<ChatScreen pollMs={10} />);

  await vi.waitFor(() => expect(chatApi.getChat).toHaveBeenCalledTimes(1));
  hel.resolve({ chat, live: liveTurn('hi', 'Hel') });
  expect(await screen.findByText('Hel')).toBeInTheDocument();
  expect(screen.getByText('hi')).toBeInTheDocument();

  await vi.waitFor(() => expect(chatApi.getChat).toHaveBeenCalledTimes(2));
  hello.resolve({ chat, live: liveTurn('hi', 'Hello') });
  expect(await screen.findByText('Hello')).toBeInTheDocument();
  expect(screen.queryByText('Hel')).toBeNull();

  await vi.waitFor(() => expect(chatApi.getChat).toHaveBeenCalledTimes(3));
  done.resolve({
    chat: makeChat('a', {
      transcript: [
        { type: 'user_message', text: 'hi' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello there' }] } },
      ],
    }),
    live: null,
  });
  expect(await screen.findByText('Hello there')).toBeInTheDocument();
  expect(screen.queryByText('Working…')).toBeNull();
  expect(document.querySelector('.transcript-streaming')).toBeNull();

  // Idle: polling stops.
  await new Promise((r) => setTimeout(r, 50));
  expect(chatApi.getChat).toHaveBeenCalledTimes(3);
});

test('shows what Claude is doing during a live turn', async () => {
  const chat = makeChat('a', { running: true });
  chatApi.listChats.mockResolvedValue([summary(chat)]);
  chatApi.getChat.mockResolvedValue({
    chat,
    live: { ...liveTurn('hi', ''), activity: { kind: 'tool', tool: 'WebSearch' }, startedAt: Date.now() },
  });

  render(<ChatScreen pollMs={10} />);

  expect(await screen.findByText('Searching the web…')).toBeInTheDocument();
});

test('the token meter adds finished replies and the live one', async () => {
  const chat = makeChat('a', {
    running: true,
    transcript: [
      { type: 'user_message', text: 'hi' },
      { type: 'result', subtype: 'success', usage: { input_tokens: 2, cache_read_input_tokens: 9998, output_tokens: 300 } },
    ],
  });
  chatApi.listChats.mockResolvedValue([summary(chat)]);
  chatApi.getChat.mockResolvedValue({ chat, live: { ...liveTurn('more', ''), usage: { input: 5000, output: 200 } } });

  render(<ChatScreen pollMs={10} />);

  expect(await screen.findByRole('meter', { name: 'Input tokens' })).toHaveAttribute('aria-valuenow', '15000');
  expect(screen.getByRole('meter', { name: 'Output tokens' })).toHaveAttribute('aria-valuenow', '500');
});

test('shows Stop while running and calls stopChat', async () => {
  const chat = makeChat('a', { running: true });
  chatApi.listChats.mockResolvedValue([summary(chat)]);
  chatApi.getChat.mockResolvedValue({ chat, live: liveTurn('hi', 'Thinking') });
  const stopChat = vi.spyOn(chatApi, 'stopChat').mockResolvedValue(true);

  render(<ChatScreen pollMs={10} />);

  const stop = await screen.findByRole('button', { name: 'Stop' });
  expect(stop).toHaveAttribute('type', 'button');
  // Send becomes Stop: no Send button while the turn runs.
  expect(screen.getByLabelText('Message').closest('form').querySelector('button[type="submit"]')).toBeNull();
  fireEvent.click(stop);
  expect(stopChat).toHaveBeenCalledWith('a');
});

test('sending shows the message at once and starts polling', async () => {
  const chat = makeChat('a');
  chatApi.listChats.mockResolvedValue([summary(chat)]);
  chatApi.getChat.mockResolvedValueOnce({ chat, live: null });
  const send = deferred();
  const sendChatMessage = vi.spyOn(chatApi, 'sendChatMessage').mockReturnValue(send.promise);
  const poll = deferred();
  chatApi.getChat.mockReturnValueOnce(poll.promise);
  chatApi.getChat.mockResolvedValue({ chat: { ...chat, running: true }, live: liveTurn('hello claude', 'Hi') });

  render(<ChatScreen pollMs={10} />);
  await vi.waitFor(() => expect(chatApi.getChat).toHaveBeenCalledTimes(1));
  const box = await screen.findByLabelText('Message');
  fireEvent.change(box, { target: { value: 'hello claude' } });
  fireEvent.keyDown(box, { key: 'Enter' });

  expect(await screen.findByText('hello claude')).toBeInTheDocument();
  expect(sendChatMessage).toHaveBeenCalledWith('a', 'hello claude', []);
  send.resolve({ ...chat, running: true });
  await vi.waitFor(() => expect(chatApi.getChat).toHaveBeenCalledTimes(2));
  poll.resolve({ chat: { ...chat, running: true }, live: liveTurn('hello claude', 'Hi') });
  expect(await screen.findByText('Hi')).toBeInTheDocument();
  expect(screen.getAllByText('hello claude')).toHaveLength(1);
});

test('a 409 send keeps the draft and shows the busy message', async () => {
  const chat = makeChat('a');
  chatApi.listChats.mockResolvedValue([summary(chat)]);
  const busy = Object.assign(new Error('Claude is still replying in this chat.'), { status: 409 });
  vi.spyOn(chatApi, 'sendChatMessage').mockRejectedValue(busy);

  render(<ChatScreen pollMs={10} />);
  await vi.waitFor(() => expect(chatApi.getChat).toHaveBeenCalledWith('a'));
  const box = await screen.findByLabelText('Message');
  fireEvent.change(box, { target: { value: 'again' } });
  fireEvent.keyDown(box, { key: 'Enter' });

  expect(await screen.findByRole('alert')).toHaveTextContent('Claude is still replying in this chat.');
  await vi.waitFor(() => expect(screen.getByLabelText('Message')).toHaveValue('again'));
  expect(document.querySelector('.transcript-user')).toBeNull();
  // It reloads the chat to follow the turn already running.
  await vi.waitFor(() => expect(chatApi.getChat).toHaveBeenCalledTimes(2));
});

test('switching chats stops polling the old one and never shows its stream', async () => {
  const a = makeChat('a', { title: 'Alpha', running: true });
  const b = makeChat('b', { title: 'Beta', transcript: [{ type: 'user_message', text: 'from beta' }] });
  chatApi.listChats.mockResolvedValue([summary(a), summary(b)]);
  const oldPoll = deferred();
  chatApi.getChat
    .mockResolvedValueOnce({ chat: a, live: liveTurn('hi', 'A1') })
    .mockReturnValueOnce(oldPoll.promise)
    .mockResolvedValue({ chat: b, live: null });

  render(<ChatScreen pollMs={10} />);
  expect(await screen.findByText('A1')).toBeInTheDocument();
  await vi.waitFor(() => expect(chatApi.getChat).toHaveBeenCalledTimes(2));

  fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
  expect(await screen.findByText('from beta')).toBeInTheDocument();
  expect(screen.queryByText('A1')).toBeNull();

  oldPoll.resolve({ chat: a, live: liveTurn('hi', 'OLD') });
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByText('OLD')).toBeNull();
  expect(screen.getByText('from beta')).toBeInTheDocument();
  const aCalls = chatApi.getChat.mock.calls.filter(([id]) => id === 'a');
  expect(aCalls).toHaveLength(2);
});

test('delete removes the chat after confirm', async () => {
  const a = makeChat('a', { title: 'Alpha' });
  const b = makeChat('b', { title: 'Beta' });
  chatApi.listChats.mockResolvedValue([summary(a), summary(b)]);
  chatApi.getChat.mockImplementation(async (id) => ({ chat: id === 'a' ? a : b, live: null }));
  const deleteChat = vi.spyOn(chatApi, 'deleteChat').mockResolvedValue(undefined);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);

  render(<ChatScreen pollMs={10} />);
  const list = await screen.findByRole('list', { name: 'Chats' });
  await within(list).findByRole('button', { name: 'Alpha' });

  fireEvent.click(screen.getByRole('button', { name: 'Delete Alpha' }));
  expect(confirm).toHaveBeenCalledWith('Delete this chat?');
  expect(deleteChat).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Delete Alpha' }));
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Alpha' })).toBeNull());
  expect(deleteChat).toHaveBeenCalledWith('a');
  expect(screen.getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-current', 'true');
});

test('changing the model saves it through updateChat and updates the bar', async () => {
  const chat = makeChat('a');
  chatApi.listChats.mockResolvedValue([summary(chat)]);
  vi.spyOn(chatApi, 'updateChat').mockResolvedValue({ ...chat, settings: { ...settings, model: 'opus' } });

  render(<ChatScreen pollMs={10} />);
  const select = await screen.findByLabelText('Model');
  await screen.findByRole('option', { name: 'Opus' });
  fireEvent.change(select, { target: { value: 'opus' } });

  expect(chatApi.updateChat).toHaveBeenCalledWith('a', { settings: { model: 'opus' } });
  await vi.waitFor(() => expect(screen.getByLabelText('Model')).toHaveValue('opus'));
});

test('two quick settings changes both apply, each PATCH carrying only its field', async () => {
  const chat = makeChat('a');
  chatApi.listChats.mockResolvedValue([summary(chat)]);
  const first = deferred();
  const second = deferred();
  vi.spyOn(chatApi, 'updateChat').mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

  render(<ChatScreen pollMs={10} />);
  await screen.findByRole('option', { name: 'Opus' });
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'opus' } });
  expect(screen.getByLabelText('Model')).toHaveValue('opus');
  fireEvent.change(screen.getByLabelText('Effort'), { target: { value: 'max' } });
  expect(screen.getByLabelText('Model')).toHaveValue('opus');
  expect(screen.getByLabelText('Effort')).toHaveValue('max');

  expect(chatApi.updateChat.mock.calls).toEqual([
    ['a', { settings: { model: 'opus' } }],
    ['a', { settings: { effort: 'max' } }],
  ]);
  // The first reply only knows about the model; the effort must survive it.
  first.resolve({ ...chat, settings: { ...settings, model: 'opus' } });
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.getByLabelText('Effort')).toHaveValue('max');
  second.resolve({ ...chat, settings: { ...settings, model: 'opus', effort: 'max' } });
  await vi.waitFor(() => expect(screen.getByLabelText('Effort')).toHaveValue('max'));
  expect(screen.getByLabelText('Model')).toHaveValue('opus');
});

test('the folder is locked once the chat has messages', async () => {
  const chat = makeChat('a', { transcript: [{ type: 'user_message', text: 'hi' }] });
  chatApi.listChats.mockResolvedValue([summary(chat)]);
  chatApi.getChat.mockResolvedValue({ chat, live: null });

  render(<ChatScreen pollMs={10} />);
  expect(await screen.findByRole('button', { name: 'Folder' })).toBeDisabled();
});

test('a rejected settings change shows the server error', async () => {
  const chat = makeChat('a');
  chatApi.listChats.mockResolvedValue([summary(chat)]);
  vi.spyOn(chatApi, 'updateChat').mockRejectedValue(new Error('Folder does not exist'));

  render(<ChatScreen pollMs={10} />);
  await screen.findByRole('option', { name: 'Opus' });
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'opus' } });

  expect(await screen.findByText('Folder does not exist')).toBeInTheDocument();
  // The optimistic value is rolled back to the saved one.
  await vi.waitFor(() => expect(screen.getByLabelText('Model')).toHaveValue(''));
});

test('opening another chat remounts the transcript so it starts at the newest entry', async () => {
  const a = makeChat('a', { title: 'Alpha', transcript: [{ type: 'user_message', text: 'from alpha' }] });
  const b = makeChat('b', { title: 'Beta', transcript: [{ type: 'user_message', text: 'from beta' }] });
  chatApi.listChats.mockResolvedValue([summary(a), summary(b)]);
  chatApi.getChat.mockImplementation(async (id) => ({ chat: id === 'a' ? a : b, live: null }));
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;

  render(<ChatScreen pollMs={10} />);
  await screen.findByText('from alpha');
  const firstList = screen.getByTestId('chat-screen-transcript');
  scroll.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
  await screen.findByText('from beta');
  expect(screen.getByTestId('chat-screen-transcript')).not.toBe(firstList);
  expect(scroll).toHaveBeenCalled();
});
