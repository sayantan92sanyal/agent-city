import { test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SettingsPanel } from './SettingsPanel.jsx';
import * as api from '../api.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('loads current roots on mount', async () => {
  vi.spyOn(api, 'fetchRoots').mockResolvedValue(['/existing']);
  vi.spyOn(api, 'saveRoots').mockResolvedValue(['/existing']);

  render(<SettingsPanel onSaved={() => {}} />);

  await vi.waitFor(() => {
    expect(screen.getByText('/existing')).toBeInTheDocument();
  });
});

test('adding a root and saving calls saveRoots with the full list', async () => {
  vi.spyOn(api, 'fetchRoots').mockResolvedValue(['/existing']);
  const saveRoots = vi.spyOn(api, 'saveRoots').mockResolvedValue(['/existing', '/new']);
  const onSaved = vi.fn();

  render(<SettingsPanel onSaved={onSaved} />);

  await vi.waitFor(() => {
    expect(screen.getByText('/existing')).toBeInTheDocument();
  });

  fireEvent.change(screen.getByLabelText(/add root/i), { target: { value: '/new' } });
  fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

  expect(screen.getByText('/new')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

  await vi.waitFor(() => {
    expect(saveRoots).toHaveBeenCalledWith(['/existing', '/new']);
  });

  await vi.waitFor(() => {
    expect(onSaved).toHaveBeenCalledWith(['/existing', '/new']);
  });
});

test('removing a root and saving calls saveRoots without it', async () => {
  vi.spyOn(api, 'fetchRoots').mockResolvedValue(['/existing', '/other']);
  const saveRoots = vi.spyOn(api, 'saveRoots').mockResolvedValue(['/other']);

  render(<SettingsPanel onSaved={() => {}} />);

  await vi.waitFor(() => {
    expect(screen.getByText('/existing')).toBeInTheDocument();
  });

  fireEvent.click(screen.getByRole('button', { name: /remove \/existing/i }));

  expect(screen.queryByText('/existing')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

  await vi.waitFor(() => {
    expect(saveRoots).toHaveBeenCalledWith(['/other']);
  });
});
