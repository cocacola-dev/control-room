import { isRangeId, type RangeId } from './insights'
import { createLocalStore } from './store'

export interface TimerSettings {
  focusMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
  /** A long break is suggested after this many focus blocks. */
  longBreakEvery: number
  sound: boolean
  /** Keep the screen on during a focus block (helps phones fire the end alert on time). */
  keepAwake: boolean
  lastProjectId: string | null
  lastItemId: string | null
}

const DEFAULTS: TimerSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  sound: true,
  keepAwake: false,
  lastProjectId: null,
  lastItemId: null,
}

const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
const idOrNull = (v: unknown) => (typeof v === 'string' ? v : null)

export const timerSettings = createLocalStore<TimerSettings>('control-room.timer', DEFAULTS, (r) => ({
  focusMinutes: num(r.focusMinutes, 1, 180, DEFAULTS.focusMinutes),
  shortBreakMinutes: num(r.shortBreakMinutes, 1, 60, DEFAULTS.shortBreakMinutes),
  longBreakMinutes: num(r.longBreakMinutes, 1, 120, DEFAULTS.longBreakMinutes),
  longBreakEvery: num(r.longBreakEvery, 1, 12, DEFAULTS.longBreakEvery),
  sound: bool(r.sound, DEFAULTS.sound),
  keepAwake: bool(r.keepAwake, DEFAULTS.keepAwake),
  lastProjectId: idOrNull(r.lastProjectId),
  lastItemId: idOrNull(r.lastItemId),
}))

export const useTimerSettings = timerSettings.use

/* ---------- Insights ---------- */

/** Remembers the date range last picked on the Insights page, per device. */
export const insightsPrefs = createLocalStore<{ range: RangeId }>('control-room.insights', { range: '7d' }, (r) =>
  isRangeId(r.range) ? { range: r.range } : {},
)
