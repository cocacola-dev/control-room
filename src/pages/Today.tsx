import { useState } from 'react'
import { Link } from 'react-router'
import { format } from 'date-fns'
import { CheckCircle2, Play } from 'lucide-react'
import { PageHeader, Section } from '@/components/PageHeader'
import { QuickCapture } from '@/components/QuickCapture'
import { ItemRow } from '@/components/ItemRow'
import { ItemEditDialog } from '@/components/ItemEditDialog'
import { EmptyState } from '@/components/EmptyState'
import { Stat } from '@/components/Stat'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useActiveSession, useItems, useProjectMap, useSessions } from '@/hooks/useData'
import { useNow } from '@/hooks/useNow'
import type { Item } from '@/db/schema'
import { dateKey, isSameLocalDay } from '@/lib/dates'
import { KIND_LABEL, formatClock, formatMinutes, isEnded, remainingMs, sessionsOnDay, sumFocusMinutes } from '@/lib/sessions'

export function TodayPage() {
  const items = useItems()
  const projectMap = useProjectMap()
  const [editing, setEditing] = useState<Item | null>(null)
  const now = useNow()
  const today = dateKey(now)

  const all = items ?? []
  const todos = all.filter((i) => i.type === 'todo')
  const openTodos = todos.filter((i) => i.status === 'open')
  const due = openTodos
    .filter((i) => i.dueDate !== null && i.dueDate <= today)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
  const dueIds = new Set(due.map((i) => i.id))
  const upNext = openTodos.filter((i) => !dueIds.has(i.id)).slice(0, 8)

  const capturedToday = all.filter((i) => isSameLocalDay(i.createdAt, now)).length
  const doneToday = todos.filter((i) => i.doneAt !== null && isSameLocalDay(i.doneAt, now)).length

  const projectFor = (i: Item) => (i.projectId ? projectMap.get(i.projectId) : undefined)

  return (
    <>
      <PageHeader title={format(now, 'EEEE')} description={format(now, 'MMMM d, yyyy')} />

      <QuickCapture />

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat value={capturedToday} label="Captured today" />
        <Stat value={doneToday} label="Done today" />
        <Stat value={openTodos.length} label="Open todos" />
      </div>

      <Section title="Focus">
        <FocusCard />
      </Section>

      {due.length > 0 && (
        <Section title="Due">
          <ul className="divide-y rounded-xl bg-card ring-1 ring-foreground/10">
            {due.map((item) => (
              <ItemRow key={item.id} item={item} project={projectFor(item)} onEdit={setEditing} />
            ))}
          </ul>
        </Section>
      )}

      <Section
        title="Up next"
        action={
          <Button asChild variant="link" size="xs" className="text-muted-foreground">
            <Link to="/inbox">All todos</Link>
          </Button>
        }
      >
        {items === undefined ? null : upNext.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title={openTodos.length === 0 ? 'Nothing open' : 'All caught up on due items'}
            description="Capture a todo above and it will show up here."
          />
        ) : (
          <ul className="divide-y rounded-xl bg-card ring-1 ring-foreground/10">
            {upNext.map((item) => (
              <ItemRow key={item.id} item={item} project={projectFor(item)} onEdit={setEditing} />
            ))}
          </ul>
        )}
      </Section>

      <ItemEditDialog item={editing} onClose={() => setEditing(null)} />
    </>
  )
}

/** Live view of the timer, or today's total with a way to start. */
function FocusCard() {
  const active = useActiveSession()
  const sessions = useSessions()
  const projectMap = useProjectMap()
  const running = !!active && !active.pausedAt
  const now = useNow(running ? 1000 : 60_000)
  const focusToday = sumFocusMinutes(sessionsOnDay((sessions ?? []).filter(isEnded), now))
  const project = active?.projectId ? projectMap.get(active.projectId) : undefined

  return (
    <Card size="sm">
      <CardContent className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-2xl font-semibold tabular-nums">
            {active ? formatClock(remainingMs(active, now.getTime())) : formatMinutes(focusToday)}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {active
              ? `${active.pausedAt ? 'Paused' : KIND_LABEL[active.kind]}${project ? ` · ${project.name}` : ''}`
              : 'focused today'}
          </div>
        </div>
        <Button asChild size="sm" variant={active ? 'outline' : 'default'}>
          <Link to="/focus">
            {active ? (
              'Open timer'
            ) : (
              <>
                <Play /> Start focus
              </>
            )}
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
