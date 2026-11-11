import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { niceTicks } from '@/lib/insights'
import { cn } from '@/lib/utils'

export interface ChartSeries {
  name: string
  /** Any CSS color. Use the chart tokens: 'var(--chart-1)', 'var(--chart-2)'. */
  color: string
}

export interface ChartBucket {
  key: string
  /** Short axis text. */
  label: string
  /** Full text for the tooltip and the table view. */
  title: string
  /** Optional extra line in the tooltip. */
  note?: string
}

export interface ColumnChartProps {
  /** What the chart shows, for screen readers. */
  ariaLabel: string
  buckets: ChartBucket[]
  series: ChartSeries[]
  /** values[series][bucket] */
  values: number[][]
  unit: 'minutes' | 'count'
  format: (value: number) => string
  height?: number
  /** Which end the axis labels count from. 'end' keeps the newest bucket labeled. */
  labelAnchor?: 'start' | 'end'
  /** Print the value above the tallest column. Single-series charts only. */
  labelPeak?: boolean
}

/** The narrowest plot we lay out for: a phone-width card minus its axis. */
const MIN_PLOT_PX = 270

/**
 * A column chart drawn with plain HTML and CSS: no chart library, no measuring.
 * Columns are thin, rounded at the data end and square on the baseline.
 * Hover, touch or the arrow keys read out one bucket at a time; the table view carries the same numbers.
 */
export function ColumnChart({
  ariaLabel,
  buckets,
  series,
  values,
  unit,
  format,
  height = 176,
  labelAnchor = 'end',
  labelPeak = false,
}: ColumnChartProps) {
  const n = buckets.length
  const plotRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActive] = useState<number | null>(null)
  const active = activeIndex !== null && activeIndex < n ? activeIndex : null

  // A tap keeps the readout open on touch screens. Tapping anywhere else closes it.
  useEffect(() => {
    if (activeIndex === null) return
    const onDown = (e: PointerEvent) => {
      if (!plotRef.current?.contains(e.target as Node)) setActive(null)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [activeIndex])

  const max = Math.max(0, ...values.flat())
  const ticks = niceTicks(max, unit)
  const top = ticks[ticks.length - 1]
  const pct = (v: number) => `${(v / top) * 100}%`
  const tickLabels = ticks.map(format)
  // Sized in characters of the 11px axis font, so the axis is exactly as wide as its longest label.
  const axisWidth = `${Math.max(...tickLabels.map((l) => l.length)) + 1.5}ch`
  const columns = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }

  // Axis labels: show every Nth one so they never collide, even on a phone.
  const labelPx = Math.max(...buckets.map((b) => b.label.length)) * 6.5 + 10
  const stride = Math.max(1, Math.ceil(labelPx / (MIN_PLOT_PX / n)))
  const showLabel = (i: number) => (labelAnchor === 'end' ? (n - 1 - i) % stride === 0 : i % stride === 0)
  const dense = n > 12

  const peak = labelPeak && series.length === 1 && max > 0 ? values[0].indexOf(max) : -1

  function indexAt(clientX: number): number {
    const rect = plotRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return Math.min(n - 1, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * n)))
  }

  function onKeyDown(e: KeyboardEvent) {
    const from = active ?? n - 1
    let next: number | null
    if (e.key === 'ArrowLeft') next = active === null ? from : Math.max(0, from - 1)
    else if (e.key === 'ArrowRight') next = active === null ? from : Math.min(n - 1, from + 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    else if (e.key === 'Escape') next = null
    else return
    e.preventDefault()
    setActive(next)
  }

  const readout = (i: number) =>
    `${buckets[i].title}: ${series.map((s, si) => `${format(values[si][i])} ${s.name}`).join(', ')}`

  const tooltipSide =
    active === null
      ? undefined
      : (active + 0.5) / n <= 0.5
        ? { left: `calc(${((active + 1) / n) * 100}% + 6px)` }
        : { right: `calc(${((n - active) / n) * 100}% + 6px)` }

  return (
    <div>
      <div className="flex pt-5">
        {/* Value axis */}
        <div aria-hidden className="relative shrink-0 text-[11px]" style={{ width: axisWidth, height }}>
          {ticks.map((t, i) => (
            <span
              key={t}
              className="absolute right-2 translate-y-1/2 leading-none text-muted-foreground tabular-nums"
              style={{ bottom: pct(t) }}
            >
              {tickLabels[i]}
            </span>
          ))}
        </div>

        {/* Plot */}
        <div
          ref={plotRef}
          role="group"
          tabIndex={0}
          aria-label={`${ariaLabel}. Use the left and right arrow keys to read values.`}
          className="relative min-w-0 flex-1 touch-pan-y rounded-sm border-b border-chart-axis outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/60"
          style={{ height }}
          onPointerMove={(e) => setActive(indexAt(e.clientX))}
          onPointerDown={(e) => setActive(indexAt(e.clientX))}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') setActive(null)
          }}
          onFocus={(e) => {
            if (e.currentTarget.matches(':focus-visible')) setActive((a) => a ?? n - 1)
          }}
          onBlur={() => setActive(null)}
          onKeyDown={onKeyDown}
        >
          {ticks.slice(1).map((t) => (
            <div key={t} aria-hidden className="absolute inset-x-0 h-px bg-border" style={{ bottom: pct(t) }} />
          ))}

          <div aria-hidden className="absolute inset-0 grid" style={{ ...columns, gridTemplateRows: '100%' }}>
            {buckets.map((b, i) => (
              <div
                key={b.key}
                className={cn(
                  'relative flex items-end justify-center gap-0.5 rounded-t-sm',
                  dense ? 'px-px' : 'px-1',
                  active === i && 'bg-foreground/[0.06]',
                )}
              >
                {series.map((s, si) => {
                  const v = values[si][i]
                  return (
                    <div
                      key={s.name}
                      className="max-w-6 min-w-0 flex-1 rounded-t-[4px]"
                      style={{ height: pct(v), minHeight: v > 0 ? 2 : 0, backgroundColor: s.color }}
                    />
                  )
                })}
                {peak === i && (
                  <span
                    className={cn(
                      'pointer-events-none absolute rounded-sm bg-card px-0.5 text-[11px] leading-none font-medium whitespace-nowrap tabular-nums',
                      (i + 0.5) / n < 0.12 ? 'left-0' : (i + 0.5) / n > 0.88 ? 'right-0' : 'left-1/2 -translate-x-1/2',
                    )}
                    style={{ bottom: `calc(${pct(max)} + 5px)` }}
                  >
                    {format(max)}
                  </span>
                )}
              </div>
            ))}
          </div>

          {active !== null && (
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 z-10 w-max max-w-44 rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
              style={tooltipSide}
            >
              <div className="text-muted-foreground">{buckets[active].title}</div>
              {series.map((s, si) => (
                <div key={s.name} className="mt-0.5 flex items-center gap-1.5">
                  {series.length > 1 && (
                    <span className="h-0.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                  )}
                  <span className="font-semibold tabular-nums">{format(values[si][active])}</span>
                  <span className="text-muted-foreground">{s.name}</span>
                </div>
              ))}
              {buckets[active].note && <div className="mt-0.5 text-muted-foreground">{buckets[active].note}</div>}
            </div>
          )}

          <p className="sr-only" aria-live="polite">
            {active !== null ? readout(active) : ''}
          </p>
        </div>
      </div>

      {/* Bucket axis */}
      <div aria-hidden className="flex pt-1.5">
        <div className="shrink-0 text-[11px]" style={{ width: axisWidth }} />
        <div className="grid min-w-0 flex-1" style={columns}>
          {buckets.map((b, i) => (
            <div
              key={b.key}
              className={cn(
                'flex h-3 min-w-0 text-[11px] leading-none whitespace-nowrap text-muted-foreground',
                dense && i === 0 ? 'justify-start' : dense && i === n - 1 ? 'justify-end' : 'justify-center',
              )}
            >
              {showLabel(i) ? b.label : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
