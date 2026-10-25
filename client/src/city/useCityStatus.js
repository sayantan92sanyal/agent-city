import { useEffect, useState } from 'react';
import { fetchCityStatus } from '../api.js';

const INITIAL = { agents: {}, mayor: 'idle', links: [] };

/**
 * Polls the city status: immediately on mount, then every `intervalMs`.
 * A failed poll keeps the last good value; results arriving after unmount
 * are ignored.
 */
export function useCityStatus({ intervalMs = 3000 } = {}) {
  const [status, setStatus] = useState(INITIAL);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const next = await fetchCityStatus();
        if (active) setStatus(next);
      } catch {
        // Keep the last good value.
      }
    };
    poll();
    const timer = setInterval(poll, intervalMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return status;
}
