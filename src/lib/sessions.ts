import { format } from 'date-fns'
import type { Session, SessionKind } from '@/db/schema'
import { dateKey } from './dates'

export const MINUTE = 60_000

/**
 * Time actually spent, excluding pauses. For a running session this grows with `now`.
 *
 * `now` usually comes from a clock on screen that ticks once a second, so it can be a little
 * behind. Right after a resume it can be behind by the whole length of the pause, because that
 * clock rests while the timer is paused. The session's own `updatedAt` is the last moment
 * anything happened to it (start, pause, resume), and the present cannot be earlier than that.
 * Without this floor, a timer that was just resumed would show more time left than it did
 * while paused, until the next tick.
 */
export function elapsedMs(s: Session, now = Date.now()): number {
  const start = Date.parse(s.startedAt)
  const end = s.endedAt ? Date.parse(s.endedAt) : s.pausedAt ? Date.parse(s.pausedAt) : Math.max(now, Date.parse(s.updatedAt) || 0)
  return Math.max(0, end - start - s.pausedMs)
}

export const remainingMs = (s: Session, now = Date.now()) => s.plannedMinutes * MINUTE - elapsedMs(s, now)

export function progress(s: Session, now = Date.now()): number {
  const p = elapsedMs(s, now) / (s.plannedMinutes * MINUTE)
  return Math.min(1, Math.max(0, p))
}

export const durationMinutes = (s: Session) => Math.round(elapsedMs(s) / MINUTE)

/** "25:00", "4:09". Rounds up so a fresh timer reads its full length. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const sec = total % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

/** "45m", "1h 05m", "2h". */
export function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`
}

export const formatTime = (iso: string) => format(new Date(iso), 'HH:mm')

export function formatTimeRange(s: Session): string {
  return `${formatTime(s.startedAt)}–${s.endedAt ? formatTime(s.endedAt) : 'now'}`
}

export const KIND_LABEL: Record<SessionKind, string> = {
  focus: 'Focus',
  'short-break': 'Short break',
  'long-break': 'Long break',
}

export const isEnded = (s: Session) => s.endedAt !== null

/** Sessions that started on the given local day, chronological. */
export function sessionsOnDay(sessions: Session[], day: Date): Session[] {
  const key = dateKey(day)
  return sessions
    .filter((s) => dateKey(new Date(s.startedAt)) === key)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

/** Total focus minutes. Rounded per session, so the total always equals the sum of the rows on screen. */
export function sumFocusMinutes(sessions: Session[]): number {
  return sessions.filter((s) => s.kind === 'focus' && isEnded(s)).reduce((acc, s) => acc + durationMinutes(s), 0)
}

/** Completed focus blocks since the last long break today. Drives the long-break suggestion. */
export function focusBlocksSinceLongBreak(todaySessions: Session[]): number {
  let count = 0
  for (const s of todaySessions) {
    if (!isEnded(s)) continue
    if (s.kind === 'long-break') count = 0
    else if (s.kind === 'focus' && s.completed && s.source === 'timer') count += 1
  }
  return count
}
