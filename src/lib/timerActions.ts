import { db } from '@/db/db'
import { startSession } from '@/db/repo'
import type { SessionKind } from '@/db/schema'
import { primeAudio } from './alerts'
import { timerSettings } from './settings'
import { focusBlocksSinceLongBreak, sessionsOnDay } from './sessions'
import { dismissFinished } from './timerStore'

/** Which break the Pomodoro cycle calls for right now. */
export async function suggestedBreakKind(): Promise<SessionKind> {
  const settings = timerSettings.get()
  const all = (await db.sessions.toArray()).filter((s) => s.deletedAt === null)
  const blocks = focusBlocksSinceLongBreak(sessionsOnDay(all, new Date()))
  return blocks >= settings.longBreakEvery ? 'long-break' : 'short-break'
}

export function minutesFor(kind: SessionKind): number {
  const s = timerSettings.get()
  return kind === 'focus' ? s.focusMinutes : kind === 'short-break' ? s.shortBreakMinutes : s.longBreakMinutes
}

export async function startFocus(input: { projectId: string | null; itemId: string | null; minutes?: number }) {
  primeAudio()
  dismissFinished()
  timerSettings.set({ lastProjectId: input.projectId, lastItemId: input.itemId })
  return startSession({
    kind: 'focus',
    projectId: input.projectId,
    itemId: input.itemId,
    plannedMinutes: input.minutes ?? timerSettings.get().focusMinutes,
  })
}

export async function startBreak(kind?: 'short-break' | 'long-break', minutes?: number) {
  primeAudio()
  dismissFinished()
  const k = kind ?? ((await suggestedBreakKind()) as 'short-break' | 'long-break')
  return startSession({ kind: k, projectId: null, itemId: null, plannedMinutes: minutes ?? minutesFor(k) })
}
