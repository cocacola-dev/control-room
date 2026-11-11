import { format, isToday, isTomorrow, isYesterday, parseISO, startOfWeek } from 'date-fns'

/** Full ISO timestamp for "now". Stored on every record. */
export const nowIso = () => new Date().toISOString()

/** Local calendar day as YYYY-MM-DD. Used for due dates and day grouping. */
export const dateKey = (d: Date) => format(d, 'yyyy-MM-dd')
export const todayKey = () => dateKey(new Date())

export const isSameLocalDay = (iso: string, d: Date) => dateKey(new Date(iso)) === dateKey(d)
export const isTodayIso = (iso: string) => isSameLocalDay(iso, new Date())

export const isOverdue = (dueKey: string) => dueKey < todayKey()
export const isDueToday = (dueKey: string) => dueKey === todayKey()

export function formatDue(dueKey: string): string {
  const d = parseISO(dueKey)
  if (isToday(d)) return 'Today'
  if (isTomorrow(d)) return 'Tomorrow'
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'MMM d')
}

export const weekStart = (d = new Date()) => startOfWeek(d, { weekStartsOn: 1 })
