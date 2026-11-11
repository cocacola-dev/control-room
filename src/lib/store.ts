import { useSyncExternalStore } from 'react'

/**
 * A tiny persistent store backed by localStorage, exposed to React through useSyncExternalStore.
 * Used for per-device preferences (timer durations, last used project). Not for records: those live in the database.
 */
export function createLocalStore<T extends object>(
  key: string,
  defaults: T,
  sanitize: (raw: Record<string, unknown>) => Partial<T>,
) {
  const listeners = new Set<() => void>()

  function load(): T {
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const parsed: unknown = JSON.parse(raw)
        if (typeof parsed === 'object' && parsed !== null) {
          return { ...defaults, ...sanitize(parsed as Record<string, unknown>) }
        }
      }
    } catch {
      /* unreadable or unavailable storage: fall back to defaults */
    }
    return defaults
  }

  let state: T = load()

  function get(): T {
    return state
  }

  function set(patch: Partial<T>) {
    state = { ...state, ...patch }
    try {
      localStorage.setItem(key, JSON.stringify(state))
    } catch {
      /* ignore */
    }
    for (const l of listeners) l()
  }

  function subscribe(cb: () => void) {
    listeners.add(cb)
    return () => {
      listeners.delete(cb)
    }
  }

  function use(): T {
    return useSyncExternalStore(subscribe, get, () => defaults)
  }

  return { get, set, subscribe, use }
}
