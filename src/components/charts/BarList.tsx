import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface BarListRow {
  key: string
  name: string
  /** A small marker before the name, such as a project dot. */
  marker?: ReactNode
  value: number
  /** The value as text: "3h 20m", "12". */
  display: string
  /** Share of the whole, 0..1. Printed as a percentage when given. */
  share?: number
  /** Not a real entity ("No project", "Other"). Drawn in gray. */
  muted?: boolean
}

/**
 * Ranked horizontal bars: one row per entry, largest first, all in one color.
 * Every number is printed in the row, so nothing depends on hovering.
 */
export function BarList({ rows }: { rows: BarListRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="-mx-2">
      {rows.map((r) => (
        <li key={r.key} className="rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60">
          <div className="flex items-center gap-2 text-sm">
            {r.marker}
            <span className={cn('min-w-0 flex-1 truncate', r.muted ? 'text-muted-foreground' : 'font-medium')}>{r.name}</span>
            <span className="tabular-nums">{r.display}</span>
            {r.share !== undefined && (
              <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">{Math.round(r.share * 100)}%</span>
            )}
          </div>
          <div aria-hidden className="mt-1.5 h-2">
            <div
              className={cn('h-full min-w-0.5 rounded-r-[4px]', r.muted ? 'bg-muted-foreground/40' : 'bg-chart-1')}
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
