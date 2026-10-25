import { test, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { FolderPicker } from './FolderPicker.jsx';
import * as chatApi from './chatApi.js';

const home = {
  path: '/home/me',
  parent: '/home',
  folders: ['code', 'docs'],
  quickPicks: [{ label: 'Home', path: '/home/me' }],
};

beforeEach(() => {
  vi.spyOn(chatApi, 'fetchFolders').mockImplementation(async (path) => {
    if (path === '/home/me/code') return { path, parent: '/home/me', folders: [], quickPicks: home.quickPicks };
    if (path === '/nope') throw new Error('Not a folder');
    return home;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('navigates into a sub-folder and up to the parent', async () => {
  render(<FolderPicker value="/home/me" onPick={() => {}} onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'code' }));
  expect(chatApi.fetchFolders).toHaveBeenCalledWith('/home/me/code');
  expect(await screen.findByText('/home/me/code')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Up' }));
  expect(chatApi.fetchFolders).toHaveBeenLastCalledWith('/home/me');
});

test('a bad pasted path shows the server error and keeps the previous path', async () => {
  render(<FolderPicker value="/home/me" onPick={() => {}} onClose={() => {}} />);
  await screen.findByText('/home/me');
  fireEvent.change(screen.getByLabelText('Paste a path'), { target: { value: '/nope' } });
  fireEvent.click(screen.getByRole('button', { name: 'Go' }));
  expect(await screen.findByText('Not a folder')).toBeInTheDocument();
  expect(screen.getByText('/home/me')).toBeInTheDocument();
});

test('Use this folder picks the current path', async () => {
  const onPick = vi.fn();
  render(<FolderPicker value="/home/me" onPick={onPick} onClose={() => {}} />);
  await screen.findByText('/home/me');
  fireEvent.click(screen.getByRole('button', { name: 'Use this folder' }));
  expect(onPick).toHaveBeenCalledWith('/home/me');
});
