import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface StatDelta {
  /** Short visible text: "18%", "2", "5 pts". The arrow carries the sign. */
  text: string
  direction: 'up' | 'down' | 'flat'
  /** Whether this direction is an improvement. Decides the color, never the arrow. */
  good: boolean
  /** Full sentence for screen readers and the hover title. */
  label: string
}

export function Stat({
  value,
  suffix,
  label,
  delta,
}: {
  value: number | string
  /** Small muted text after the value, such as "of 7". */
  suffix?: ReactNode
  label: string
  delta?: StatDelta | null
}) {
  const Arrow = delta?.direction === 'up' ? ArrowUpRight : delta?.direction === 'down' ? ArrowDownRight : Minus
  return (
    <Card size="sm">
      <CardContent>
        <div className="text-2xl font-semibold">
          {value}
          {suffix && <span className="ml-1.5 text-sm font-normal text-muted-foreground">{suffix}</span>}
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{label}</span>
          {delta && (
            <span
              title={delta.label}
              className={cn(
                'inline-flex shrink-0 items-center gap-0.5 font-medium tabular-nums',
                delta.direction !== 'flat' && (delta.good ? 'text-success' : 'text-destructive'),
              )}
            >
              <Arrow className="size-3.5" aria-hidden />
              <span aria-hidden>{delta.text}</span>
              <span className="sr-only">{delta.label}</span>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
