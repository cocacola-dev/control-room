import { useState, type ReactNode } from 'react'
import { ChartColumn, Table2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ColumnChart, type ColumnChartProps } from './ColumnChart'
import { DataTable } from './DataTable'

/** A titled card. The subtitle is where a chart states its takeaway in words. */
export function ChartCard({
  title,
  subtitle,
  action,
  className,
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  className?: string
  /** Leave empty and the card shows only its title and takeaway. */
  children?: ReactNode
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {subtitle && <CardDescription>{subtitle}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      {children ? <CardContent>{children}</CardContent> : null}
    </Card>
  )
}

/**
 * A column chart in a card, with a legend when there is more than one series and a switch to the table view.
 * When every value is zero the card shrinks to its title and subtitle: an empty grid says nothing the sentence does not.
 */
export function ColumnChartCard({
  title,
  subtitle,
  firstColumn,
  className,
  ...chart
}: ColumnChartProps & {
  title: string
  subtitle?: ReactNode
  /** Header of the table's first column: "Day", "Week", "Hour". */
  firstColumn: string
  className?: string
}) {
  const [asTable, setAsTable] = useState(false)
  const { buckets, series, values, format } = chart
  const hasNotes = buckets.some((b) => b.note)

  if (values.every((row) => row.every((v) => v === 0))) {
    return <ChartCard title={title} subtitle={subtitle} className={className} />
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      className={className}
      action={
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-pressed={asTable}
          aria-label={`${title}: show as ${asTable ? 'chart' : 'table'}`}
          title={asTable ? 'Show as chart' : 'Show as table'}
          onClick={() => setAsTable((v) => !v)}
        >
          {asTable ? <ChartColumn /> : <Table2 />}
        </Button>
      }
    >
      {asTable ? (
        <DataTable
          caption={title}
          head={[firstColumn, ...series.map((s) => s.name), ...(hasNotes ? ['Details'] : [])]}
          rows={buckets.map((b, i) => [
            b.title,
            ...series.map((_, si) => format(values[si][i])),
            ...(hasNotes ? [b.note ?? ''] : []),
          ])}
        />
      ) : (
        <>
          {series.length > 1 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {series.map((s) => (
                <li key={s.name} className="flex items-center gap-1.5">
                  <span aria-hidden className="size-2.5 rounded-[3px]" style={{ backgroundColor: s.color }} />
                  {s.name}
                </li>
              ))}
            </ul>
          )}
          <ColumnChart {...chart} />
        </>
      )}
    </ChartCard>
  )
}
