import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  format,
  parseISO,
  startOfDay,
  startOfMonth,
  subDays,
  subMonths,
  subWeeks,
} from 'date-fns'
import type { Item, Session } from '@/db/schema'
import { dateKey, weekStart } from './dates'
import { MINUTE, durationMinutes, elapsedMs, isEnded } from './sessions'

/*
 * Pure functions that turn records into the numbers behind the Insights page.
 * Nothing here touches the database or React, so every figure can be checked in isolation.
 *
 * Two conventions hold everywhere:
 *  - A session belongs to the local day it started on (same rule as the Log page).
 *  - Minutes are rounded per session, so any total equals the sum of the rows you can see.
 */

/* ---------- Ranges and buckets ---------- */

export type RangeId = '7d' | '30d' | '12w' | '12m'
export type BucketUnit = 'day' | 'week' | 'month'

export const RANGES: { id: RangeId; short: string; name: string }[] = [
  { id: '7d', short: '7D', name: '7 days' },
  { id: '30d', short: '30D', name: '30 days' },
  { id: '12w', short: '12W', name: '12 weeks' },
  { id: '12m', short: '12M', name: '12 months' },
]

export const isRangeId = (v: unknown): v is RangeId => RANGES.some((r) => r.id === v)

export interface Bucket {
  key: string
  start: Date
  /** Exclusive. */
  end: Date
  /** Short text for the axis. */
  label: string
  /** Full text for tooltips and tables. */
  title: string
}

export interface Period {
  range: RangeId
  unit: BucketUnit
  start: Date
  /** Exclusive: the start of tomorrow, so today is always included in full. */
  end: Date
  /** Calendar days covered, today included. */
  days: number
  /** The comparison span is the same number of days right before: [prevStart, start). */
  prevStart: Date
  buckets: Bucket[]
}

export function buildPeriod(range: RangeId, now: Date): Period {
  const today = startOfDay(now)
  const end = addDays(today, 1)
  let unit: BucketUnit
  let start: Date
  let buckets: Bucket[]

  if (range === '7d' || range === '30d') {
    const n = range === '7d' ? 7 : 30
    unit = 'day'
    start = subDays(today, n - 1)
    buckets = Array.from({ length: n }, (_, i) => {
      const s = addDays(start, i)
      return {
        key: dateKey(s),
        start: s,
        end: addDays(s, 1),
        label: format(s, n === 7 ? 'EEE' : 'MMM d'),
        title: format(s, 'EEE, MMM d'),
      }
    })
  } else if (range === '12w') {
    unit = 'week'
    start = subWeeks(weekStart(today), 11)
    buckets = Array.from({ length: 12 }, (_, i) => {
      const s = addWeeks(start, i)
      const e = addWeeks(s, 1)
      return {
        key: dateKey(s),
        start: s,
        end: e,
        label: format(s, 'MMM d'),
        title: i === 11 ? 'This week so far' : `${format(s, 'MMM d')} to ${format(subDays(e, 1), 'MMM d')}`,
      }
    })
  } else {
    unit = 'month'
    start = subMonths(startOfMonth(today), 11)
    buckets = Array.from({ length: 12 }, (_, i) => {
      const s = addMonths(start, i)
      return {
        key: format(s, 'yyyy-MM'),
        start: s,
        end: addMonths(s, 1),
        label: format(s, 'MMM'),
        title: i === 11 ? `${format(s, 'MMMM')} so far` : format(s, 'MMMM yyyy'),
      }
    })
  }

  const days = differenceInCalendarDays(end, start)
  return { range, unit, start, end, days, prevStart: subDays(start, days), buckets }
}

export function inSpan(iso: string, start: Date, end: Date): boolean {
  const t = Date.parse(iso)
  return t >= start.getTime() && t < end.getTime()
}

/** Index of the bucket holding this timestamp, or -1 when it falls outside the period. */
export function bucketIndex(period: Period, iso: string): number {
  const t = Date.parse(iso)
  if (t < period.start.getTime() || t >= period.end.getTime()) return -1
  let lo = 0
  let hi = period.buckets.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (period.buckets[mid].start.getTime() <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

/* ---------- Project filter ---------- */

export const ALL_PROJECTS = '__all__'
export const NO_PROJECT = '__none__'

export function matchesProject(projectId: string | null, filter: string): boolean {
  if (filter === ALL_PROJECTS) return true
  if (filter === NO_PROJECT) return projectId === null
  return projectId === filter
}

/** Finished focus blocks that pass the project filter. Every focus figure starts from this list. */
export function selectFocus(sessions: Session[], filter: string): Session[] {
  return sessions.filter((s) => s.kind === 'focus' && isEnded(s) && matchesProject(s.projectId, filter))
}

/* ---------- Focus figures ---------- */

export interface FocusSummary {
  minutes: number
  blocks: number
  activeDays: number
  /** Blocks run with the timer. Manual entries have no "finished or stopped early". */
  timerBlocks: number
  finishedBlocks: number
  /** Share of timer blocks that ran to the end, 0..1. Null when there were none. */
  finishRate: number | null
}

export function summarizeFocus(focus: Session[], start: Date, end: Date): FocusSummary {
  const within = focus.filter((s) => inSpan(s.startedAt, start, end))
  const timer = within.filter((s) => s.source === 'timer')
  const finished = timer.filter((s) => s.completed).length
  return {
    minutes: within.reduce((acc, s) => acc + durationMinutes(s), 0),
    blocks: within.length,
    activeDays: new Set(within.map((s) => dateKey(new Date(s.startedAt)))).size,
    timerBlocks: timer.length,
    finishedBlocks: finished,
    finishRate: timer.length ? finished / timer.length : null,
  }
}

/** Focus minutes per bucket of the period. */
export function focusByBucket(period: Period, focus: Session[]): number[] {
  const out = period.buckets.map(() => 0)
  for (const s of focus) {
    const i = bucketIndex(period, s.startedAt)
    if (i >= 0) out[i] += durationMinutes(s)
  }
  return out
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** Monday = 0 ... Sunday = 6. */
const weekdayIndex = (d: Date) => (d.getDay() + 6) % 7

export interface WeekdayStats {
  /** Focus minutes on each weekday across the period. */
  total: number[]
  /** How many of each weekday the period contains. A 30-day range has five of some and four of others. */
  days: number[]
  /** total / days, so weekdays compare fairly. */
  average: number[]
}

export function focusByWeekday(period: Period, focus: Session[]): WeekdayStats {
  const total = WEEKDAYS.map(() => 0)
  const days = WEEKDAYS.map(() => 0)
  for (let d = period.start; d < period.end; d = addDays(d, 1)) days[weekdayIndex(d)] += 1
  for (const s of focus) {
    if (inSpan(s.startedAt, period.start, period.end)) total[weekdayIndex(new Date(s.startedAt))] += durationMinutes(s)
  }
  return { total, days, average: total.map((t, i) => (days[i] ? Math.round(t / days[i]) : 0)) }
}

/**
 * Focus minutes by hour of the day (0..23), summed over the period.
 * A block that crosses an hour boundary is split between the hours in proportion to the clock time
 * it spent in each. Pauses are not recorded minute by minute, so they are spread evenly over the block.
 */
export function focusByHour(period: Period, focus: Session[]): number[] {
  const out = Array.from({ length: 24 }, () => 0)
  for (const s of focus) {
    if (!s.endedAt || !inSpan(s.startedAt, period.start, period.end)) continue
    const start = Date.parse(s.startedAt)
    const end = Date.parse(s.endedAt)
    const minutes = elapsedMs(s) / MINUTE
    const span = end - start
    if (span <= 0) {
      out[new Date(start).getHours()] += minutes
      continue
    }
    let cursor = start
    for (let guard = 0; cursor < end && guard < 72; guard++) {
      const nextHour = new Date(cursor)
      nextHour.setMinutes(60, 0, 0)
      const sliceEnd = Math.min(nextHour.getTime(), end)
      out[new Date(cursor).getHours()] += (minutes * (sliceEnd - cursor)) / span
      cursor = sliceEnd
    }
  }
  return out.map(Math.round)
}

export interface Slice {
  /** Project or todo id. Null collects everything without one. */
  id: string | null
  minutes: number
  blocks: number
}

function slicesBy(focus: Session[], period: Period, pick: (s: Session) => string | null): Slice[] {
  const map = new Map<string | null, Slice>()
  for (const s of focus) {
    if (!inSpan(s.startedAt, period.start, period.end)) continue
    const id = pick(s)
    const slice = map.get(id) ?? { id, minutes: 0, blocks: 0 }
    slice.minutes += durationMinutes(s)
    slice.blocks += 1
    map.set(id, slice)
  }
  // Largest first. The "none" slice is not a real entity, so it always goes last.
  return [...map.values()]
    .filter((s) => s.minutes > 0)
    .sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : b.minutes - a.minutes))
}

export const focusByProject = (period: Period, focus: Session[]) => slicesBy(focus, period, (s) => s.projectId)
export const focusByItem = (period: Period, focus: Session[]) => slicesBy(focus, period, (s) => s.itemId)

/** Consecutive days with at least one focus block. `current` counts back from today, or from yesterday if today is still empty. */
export function focusStreak(focus: Session[], now: Date): { current: number; best: number } {
  const days = new Set(focus.map((s) => dateKey(new Date(s.startedAt))))
  let current = 0
  let d = startOfDay(now)
  if (!days.has(dateKey(d))) d = subDays(d, 1)
  while (days.has(dateKey(d))) {
    current += 1
    d = subDays(d, 1)
  }
  let best = 0
  let run = 0
  let prev: Date | null = null
  for (const key of [...days].sort()) {
    const cur = parseISO(key)
    run = prev && differenceInCalendarDays(cur, prev) === 1 ? run + 1 : 1
    best = Math.max(best, run)
    prev = cur
  }
  return { current, best }
}

/* ---------- Todo figures ---------- */

export function selectTodos(items: Item[], filter: string): Item[] {
  return items.filter((i) => i.type === 'todo' && matchesProject(i.projectId, filter))
}

export interface TodoFlow {
  added: number[]
  done: number[]
}

/** Todos created and todos completed in each bucket. Added above done means the backlog is growing. */
export function todosByBucket(period: Period, todos: Item[]): TodoFlow {
  const added = period.buckets.map(() => 0)
  const done = period.buckets.map(() => 0)
  for (const t of todos) {
    const a = bucketIndex(period, t.createdAt)
    if (a >= 0) added[a] += 1
    if (t.status === 'done' && t.doneAt) {
      const d = bucketIndex(period, t.doneAt)
      if (d >= 0) done[d] += 1
    }
  }
  return { added, done }
}

export function countTodos(todos: Item[], start: Date, end: Date): { added: number; done: number } {
  return {
    added: todos.filter((t) => inSpan(t.createdAt, start, end)).length,
    done: todos.filter((t) => t.status === 'done' && t.doneAt !== null && inSpan(t.doneAt, start, end)).length,
  }
}

export interface Backlog {
  open: number
  /** Whole days the oldest open todo has been waiting. Null when nothing is open. */
  oldestDays: number | null
  /** Open todos per project, largest first, "no project" last. */
  byProject: { id: string | null; count: number }[]
}

export function backlog(todos: Item[], now: Date): Backlog {
  const open = todos.filter((t) => t.status === 'open')
  const map = new Map<string | null, number>()
  let oldest: string | null = null
  for (const t of open) {
    map.set(t.projectId, (map.get(t.projectId) ?? 0) + 1)
    if (oldest === null || t.createdAt < oldest) oldest = t.createdAt
  }
  return {
    open: open.length,
    oldestDays: oldest ? Math.max(0, differenceInCalendarDays(now, new Date(oldest))) : null,
    byProject: [...map.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : b.count - a.count)),
  }
}

/* ---------- Comparisons and axes ---------- */

/**
 * When tracking began: the earliest session or item, as a timestamp. Null with no records.
 * A range is only compared with the one before it if tracking covers that whole earlier span.
 * Otherwise "up 400%" would just mean "you were not using the app yet".
 */
export function trackingStart(sessions: Session[], items: Item[]): number | null {
  let first: string | null = null
  for (const s of sessions) if (first === null || s.startedAt < first) first = s.startedAt
  for (const i of items) if (first === null || i.createdAt < first) first = i.createdAt
  return first === null ? null : Date.parse(first)
}

/** (now - before) / before. Null when there is nothing to compare against. */
export const relativeChange = (current: number, previous: number): number | null =>
  previous > 0 ? (current - previous) / previous : null

const MINUTE_STEPS = [5, 10, 15, 30, 60, 120, 180, 240, 300, 600, 1200, 1500, 3000, 6000, 12000, 30000, 60000]
const COUNT_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000]

/**
 * Round axis values from zero up to at least `max`, in at most four steps.
 * Minutes step in clock-friendly sizes (15m, 30m, 1h, 2h ...), counts in whole numbers.
 */
export function niceTicks(max: number, unit: 'minutes' | 'count'): number[] {
  const steps = unit === 'minutes' ? MINUTE_STEPS : COUNT_STEPS
  // An empty chart still gets a believable scale.
  const top = Math.max(max, unit === 'minutes' ? 60 : 4)
  const step = steps.find((s) => top / s <= 4) ?? Math.ceil(top / 4)
  const count = Math.ceil(top / step)
  return Array.from({ length: count + 1 }, (_, i) => i * step)
}
