import { test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NewPlaygroundDialog } from './NewPlaygroundDialog.jsx';
import * as api from '../api.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('BUILD is disabled for blank or whitespace names', () => {
  render(<NewPlaygroundDialog onCreated={() => {}} onCancel={() => {}} />);
  const build = screen.getByRole('button', { name: 'BUILD' });
  expect(build).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Playground name'), { target: { value: '   ' } });
  expect(build).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Playground name'), { target: { value: 'town' } });
  expect(build).not.toBeDisabled();
});

test('success calls onCreated with the playground', async () => {
  const playground = { projectPath: '/x/town', projectName: 'town', agents: [] };
  vi.spyOn(api, 'createPlayground').mockResolvedValue(playground);
  const onCreated = vi.fn();
  render(<NewPlaygroundDialog onCreated={onCreated} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText('Playground name'), { target: { value: ' town ' } });
  fireEvent.click(screen.getByRole('button', { name: 'BUILD' }));
  await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith(playground));
  expect(api.createPlayground).toHaveBeenCalledWith('town');
});

test('a server error is shown inline and the dialog stays open', async () => {
  vi.spyOn(api, 'createPlayground').mockRejectedValue(new Error('Playground already exists'));
  const onCreated = vi.fn();
  render(<NewPlaygroundDialog onCreated={onCreated} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText('Playground name'), { target: { value: 'town' } });
  fireEvent.click(screen.getByRole('button', { name: 'BUILD' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Playground already exists');
  expect(onCreated).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'BUILD' })).toBeInTheDocument();
});

test('CANCEL calls onCancel', () => {
  const onCancel = vi.fn();
  render(<NewPlaygroundDialog onCreated={() => {}} onCancel={onCancel} />);
  fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
  expect(onCancel).toHaveBeenCalled();
});
