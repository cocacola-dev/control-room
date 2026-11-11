import { useSyncExternalStore } from 'react'
import type { Session } from '@/db/schema'

/** The most recently finished block, so the Focus page can offer the next step. Cleared on dismiss or start. */
export interface FinishedEvent {
  session: Session
  at: number
}

let lastFinished: FinishedEvent | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function publishFinished(session: Session) {
  lastFinished = { session, at: Date.now() }
  emit()
}

export function dismissFinished() {
  if (!lastFinished) return
  lastFinished = null
  emit()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useLastFinished(): FinishedEvent | null {
  return useSyncExternalStore(subscribe, () => lastFinished, () => null)
}
