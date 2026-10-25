import { test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { UpdateBar } from './UpdateBar.jsx';

function setHidden(hidden) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

afterEach(() => {
  cleanup();
  setHidden(false);
  document.body.innerHTML = '';
});

// Versions served in order; the last one repeats.
function versions(...list) {
  let i = 0;
  return vi.fn(async () => list[Math.min(i++, list.length - 1)]);
}

test('shows the bar once the server runs a newer version, and Reload reloads', async () => {
  const fetchVersion = versions('aaa', 'aaa', 'bbb');
  const reload = vi.fn();
  render(<UpdateBar fetchVersion={fetchVersion} reload={reload} intervalMs={10} />);
  expect(screen.queryByRole('status')).toBeNull();

  expect(await screen.findByText('Agent City was updated.')).toBeInTheDocument();
  expect(reload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
  expect(reload).toHaveBeenCalledTimes(1);
});

test('never shows without a built version (dev server)', async () => {
  const fetchVersion = versions(null, 'bbb');
  render(<UpdateBar fetchVersion={fetchVersion} reload={vi.fn()} intervalMs={10} />);
  await vi.waitFor(() => expect(fetchVersion.mock.calls.length).toBeGreaterThan(2));
  expect(screen.queryByText('Agent City was updated.')).toBeNull();
});

test('reloads by itself when the window is in the background and nothing is typed', async () => {
  setHidden(true);
  const reload = vi.fn();
  render(<UpdateBar fetchVersion={versions('aaa', 'bbb')} reload={reload} intervalMs={10} />);
  await vi.waitFor(() => expect(reload).toHaveBeenCalled());
});

test('keeps an unsent draft: no automatic reload while text is typed', async () => {
  setHidden(true);
  const box = document.createElement('textarea');
  box.value = 'half-written question';
  document.body.appendChild(box);
  const reload = vi.fn();
  render(<UpdateBar fetchVersion={versions('aaa', 'bbb')} reload={reload} intervalMs={10} />);
  expect(await screen.findByText('Agent City was updated.')).toBeInTheDocument();
  await new Promise((r) => setTimeout(r, 50));
  expect(reload).not.toHaveBeenCalled();
});

test('remembers the starting version across re-renders', async () => {
  const first = vi.fn(async () => 'aaa');
  const { rerender } = render(<UpdateBar fetchVersion={first} reload={() => {}} intervalMs={10} />);
  await vi.waitFor(() => expect(first).toHaveBeenCalled());
  rerender(<UpdateBar fetchVersion={vi.fn(async () => 'bbb')} reload={() => {}} intervalMs={10} />);
  expect(await screen.findByText('Agent City was updated.')).toBeInTheDocument();
});
