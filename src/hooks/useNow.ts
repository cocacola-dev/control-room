import { useEffect, useState } from 'react'

/**
 * The current time, refreshed on an interval. Keeps "Today" correct past midnight and
 * will drive the Focus timer display. Default tick: once a minute.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
