import { test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ChatSettingsBar } from './ChatSettingsBar.jsx';
import * as chatApi from './chatApi.js';

const settings = { model: '', effort: 'high', disabledConnectors: [], folder: '/home/me' };
const models = [{ value: '', label: 'Default' }, { value: 'opus', label: 'Opus' }];
const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
const connectors = [
  { name: 'github', source: 'user', status: 'connected', toolPrefix: 'mcp__github' },
  { name: 'slack', source: 'user', status: 'needs-auth', toolPrefix: 'mcp__slack' },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(props = {}) {
  const onChange = vi.fn();
  const onRefreshConnectors = vi.fn();
  render(
    <ChatSettingsBar
      settings={settings}
      models={models}
      efforts={efforts}
      connectors={connectors}
      connectorsError={null}
      folderLocked={false}
      onChange={onChange}
      onRefreshConnectors={onRefreshConnectors}
      {...props}
    />
  );
  return { onChange, onRefreshConnectors };
}

test('changing model or effort changes only that field', () => {
  const { onChange } = setup();
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'opus' } });
  expect(onChange).toHaveBeenLastCalledWith({ model: 'opus' });
  fireEvent.change(screen.getByLabelText('Effort'), { target: { value: 'max' } });
  expect(onChange).toHaveBeenLastCalledWith({ effort: 'max' });
});

test('unchecking a connector disables it; count reflects enabled connected ones', () => {
  const { onChange } = setup();
  expect(screen.getByRole('button', { name: 'Connectors' })).toHaveTextContent('1');
  fireEvent.click(screen.getByRole('button', { name: 'Connectors' }));
  fireEvent.click(screen.getByRole('checkbox', { name: /github/ }));
  expect(onChange).toHaveBeenCalledWith({ disabledConnectors: ['github'] });
});

test('a needs-auth connector is disabled with a hint', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Connectors' }));
  expect(screen.getByRole('checkbox', { name: /slack/ })).toBeDisabled();
  expect(screen.getByText('Sign in via the Claude desktop app')).toBeInTheDocument();
});

test('Refresh calls onRefreshConnectors', () => {
  const { onRefreshConnectors } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Connectors' }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(onRefreshConnectors).toHaveBeenCalled();
});

test('a connectors error is shown while the rest of the bar still works', () => {
  const { onChange } = setup({ connectors: [], connectorsError: 'claude mcp list failed' });
  fireEvent.click(screen.getByRole('button', { name: 'Connectors' }));
  expect(screen.getByText('claude mcp list failed')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'opus' } });
  expect(onChange).toHaveBeenCalledWith({ model: 'opus' });
});

test('folder button shows the basename and is disabled when locked', () => {
  setup({ folderLocked: true });
  const button = screen.getByRole('button', { name: 'Folder' });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('title', 'Folder is fixed after the first message');
  expect(button).toHaveTextContent('me');
});

test('Escape closes the connectors popover', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Connectors' }));
  expect(screen.getByRole('dialog', { name: 'Connectors list' })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Connectors list' })).toBeNull();
});

test('a mousedown outside closes the popover; inside keeps it open', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Connectors' }));
  fireEvent.mouseDown(screen.getByRole('checkbox', { name: /github/ }));
  expect(screen.getByRole('dialog', { name: 'Connectors list' })).toBeInTheDocument();
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole('dialog', { name: 'Connectors list' })).toBeNull();
});

test('opening the folder picker closes the connectors popover', async () => {
  vi.spyOn(chatApi, 'fetchFolders').mockResolvedValue({ path: '/home/me', parent: '/home', folders: [], quickPicks: [] });
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Connectors' }));
  fireEvent.click(screen.getByRole('button', { name: 'Folder' }));
  expect(screen.queryByRole('dialog', { name: 'Connectors list' })).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Choose folder' })).toBeInTheDocument();
  expect(await screen.findByText('/home/me')).toBeInTheDocument();
});

test('the STE switch turns Simplified Technical English on and off', () => {
  const { onChange } = setup();
  const ste = screen.getByRole('switch', { name: /Simplified Technical English/ });
  expect(ste).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(ste);
  expect(onChange).toHaveBeenCalledWith({ simplifiedEnglish: true });
  cleanup();

  const again = setup({ settings: { ...settings, simplifiedEnglish: true } });
  const on = screen.getByRole('switch', { name: /Simplified Technical English/ });
  expect(on).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(on);
  expect(again.onChange).toHaveBeenCalledWith({ simplifiedEnglish: false });
});

test('local models are grouped separately; effort and connectors switch off for them', () => {
  const withLocal = [...models, { value: 'local:llama', label: 'Llama 3.2 3B · local', local: true }];
  const { onChange } = setup({ models: withLocal });
  const picker = screen.getByLabelText('Model');
  expect(picker.querySelector('optgroup[label="On this Mac (no tools)"] option')).toHaveTextContent('Llama 3.2 3B · local');
  expect(screen.getByLabelText('Effort')).not.toBeDisabled();
  fireEvent.change(picker, { target: { value: 'local:llama' } });
  expect(onChange).toHaveBeenCalledWith({ model: 'local:llama' });
  cleanup();

  setup({ models: withLocal, settings: { ...settings, model: 'local:llama' } });
  expect(screen.getByLabelText('Effort')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Connectors' })).toBeDisabled();
  expect(screen.getByRole('switch', { name: /Simplified Technical English/ })).not.toBeDisabled();
});
