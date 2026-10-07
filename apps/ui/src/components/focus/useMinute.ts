import { useEffect, useState } from 'react';

/** The time, updated once a minute while `on`, so "Needs you · 12m" and "saved 5m ago" keep up. */
export function useMinute(on = true): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}
