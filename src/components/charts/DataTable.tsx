/** The plain-table twin of a chart: the same numbers, readable without color, hover or sight. */
export function DataTable({
  caption,
  head,
  rows,
}: {
  caption: string
  head: string[]
  rows: (string | number)[][]
}) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b text-xs text-muted-foreground">
          {head.map((h, i) => (
            <th key={h} scope="col" className={i === 0 ? 'py-1.5 text-left font-medium' : 'py-1.5 pl-4 text-right font-medium'}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={String(row[0])} className="border-b border-border/60 last:border-0">
            {row.map((cell, i) =>
              i === 0 ? (
                <th key={i} scope="row" className="py-1.5 text-left font-normal">
                  {cell}
                </th>
              ) : (
                <td key={i} className="py-1.5 pl-4 text-right tabular-nums">
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
