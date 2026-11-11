import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'control-room.theme'
const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#ffffff', dark: '#0a0a0a' }

const listeners = new Set<() => void>()
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* storage unavailable (private mode) */
  }
  return 'system'
}

let current: Theme = readStored()

export function resolveTheme(t: Theme): ResolvedTheme {
  if (t !== 'system') return t
  return media?.matches ? 'dark' : 'light'
}

function apply() {
  const resolved = resolveTheme(current)
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[resolved])
}

function emit() {
  for (const l of listeners) l()
}

export function getTheme(): Theme {
  return current
}

export function setTheme(t: Theme) {
  current = t
  try {
    localStorage.setItem(STORAGE_KEY, t)
  } catch {
    /* ignore */
  }
  apply()
  emit()
}

/** Call once before the first render so there is no flash of the wrong theme. */
export function initTheme() {
  apply()
  media?.addEventListener('change', () => {
    if (current === 'system') {
      apply()
      emit()
    }
  })
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getTheme, () => 'system' as Theme)
  const resolved = useSyncExternalStore(
    subscribe,
    () => resolveTheme(current),
    () => 'dark' as ResolvedTheme,
  )
  return { theme, resolved, setTheme }
}
