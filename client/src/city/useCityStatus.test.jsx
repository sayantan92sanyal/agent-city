import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../api.js', () => ({ fetchCityStatus: vi.fn() }));
import { fetchCityStatus } from '../api.js';
import { useCityStatus } from './useCityStatus.js';

beforeEach(() => {
  vi.useFakeTimers();
  fetchCityStatus.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

test('starts with the default value, polls immediately and every interval', async () => {
  const status = { agents: { a: 'working' }, mayor: 'idle', links: [] };
  fetchCityStatus.mockResolvedValue(status);
  const { result } = renderHook(() => useCityStatus());
  expect(result.current).toEqual({ agents: {}, mayor: 'idle', links: [] });
  await flush();
  expect(result.current).toEqual(status);
  expect(fetchCityStatus).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(fetchCityStatus).toHaveBeenCalledTimes(3);
});

test('keeps the last good value when a poll rejects', async () => {
  const status = { agents: { a: 'idle' }, mayor: 'working', links: [] };
  fetchCityStatus.mockResolvedValueOnce(status).mockRejectedValue(new Error('down'));
  const { result } = renderHook(() => useCityStatus({ intervalMs: 1000 }));
  await flush();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(fetchCityStatus.mock.calls.length).toBeGreaterThan(1);
  expect(result.current).toEqual(status);
});

test('stops polling after unmount', async () => {
  fetchCityStatus.mockResolvedValue({ agents: {}, mayor: 'idle', links: [] });
  const { unmount } = renderHook(() => useCityStatus({ intervalMs: 1000 }));
  await flush();
  unmount();
  const calls = fetchCityStatus.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(fetchCityStatus).toHaveBeenCalledTimes(calls);
});
