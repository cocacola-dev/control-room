import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { completeSession } from '@/db/repo'
import type { Session } from '@/db/schema'
import { useActiveSession } from '@/hooks/useData'
import { notify, playChime, vibrate } from '@/lib/alerts'
import { KIND_LABEL, MINUTE, formatClock, remainingMs } from '@/lib/sessions'
import { timerSettings, useTimerSettings } from '@/lib/settings'
import { startBreak, startFocus } from '@/lib/timerActions'
import { publishFinished } from '@/lib/timerStore'
import { setWakeLock } from '@/lib/wakeLock'

const BASE_TITLE = 'Control Room'

/**
 * Runs once for the whole app, on every page. Watches the running session, keeps the tab title
 * ticking, holds the screen awake when asked, and ends the block the moment its time is up.
 * The block's end is derived from its start timestamp, so a throttled or sleeping tab only
 * delays the alert, never the recorded end time.
 */
export function TimerEngine() {
  const active = useActiveSession()
  const { keepAwake } = useTimerSettings()
  const finishing = useRef<string | null>(null)

  useEffect(() => {
    if (!active) {
      document.title = BASE_TITLE
      void setWakeLock(false)
      return
    }
    if (active.pausedAt) {
      document.title = `Paused · ${KIND_LABEL[active.kind]}`
      void setWakeLock(false)
      return
    }
    void setWakeLock(keepAwake && active.kind === 'focus')

    const check = () => {
      const remaining = remainingMs(active)
      document.title = `${formatClock(remaining)} · ${KIND_LABEL[active.kind]}`
      if (remaining <= 0 && finishing.current !== active.id) {
        finishing.current = active.id
        void finish(active, -remaining)
      }
    }
    check()
    const id = window.setInterval(check, 1000)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', check)
    }
  }, [active, keepAwake])

  return null
}

async function finish(session: Session, lateByMs: number) {
  await completeSession(session)
  const isFocus = session.kind === 'focus'
  const title = isFocus ? 'Focus block complete' : 'Break over'
  const body = isFocus ? `${session.plannedMinutes} minutes done. Time for a break.` : 'Ready for the next focus block?'

  // If we only noticed long after the fact (the app was closed), record it quietly.
  if (lateByMs < 5 * MINUTE) {
    if (timerSettings.get().sound) playChime()
    vibrate()
    void notify(title, body)
  }
  publishFinished(session)
  toast(title, {
    description: body,
    duration: 15_000,
    action: isFocus
      ? { label: 'Start break', onClick: () => void startBreak() }
      : {
          label: 'Start focus',
          onClick: () => {
            const s = timerSettings.get()
            void startFocus({ projectId: s.lastProjectId, itemId: s.lastItemId })
          },
        },
  })
}
