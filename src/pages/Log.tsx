import { useState } from 'react'
import { addDays, format, isToday, isYesterday, startOfDay, subDays } from 'date-fns'
import { ChevronLeft, ChevronRight, Plus, Timer } from 'lucide-react'
import { PageHeader, Section } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { ItemRow } from '@/components/ItemRow'
import { ItemEditDialog } from '@/components/ItemEditDialog'
import { SessionRow } from '@/components/SessionRow'
import { SessionDialog } from '@/components/SessionDialog'
import { Stat } from '@/components/Stat'
import { Button } from '@/components/ui/button'
import type { Item, Session } from '@/db/schema'
import { useItemMap, useItems, useProjectMap, useSessions } from '@/hooks/useData'
import { isSameLocalDay } from '@/lib/dates'
import { formatMinutes, isEnded, sessionsOnDay, sumFocusMinutes } from '@/lib/sessions'

/** One day at a time: every block of time, every todo finished, everything captured. */
export function LogPage() {
  const [day, setDay] = useState(() => startOfDay(new Date()))
  const sessions = useSessions()
  const items = useItems()
  const projectMap = useProjectMap()
  const itemMap = useItemMap()
  const [editingSession, setEditingSession] = useState<Session | null>(null)
  const [adding, setAdding] = useState(false)
  const [editingItem, setEditingItem] = useState<Item | null>(null)

  const current = isToday(day)
  const daySessions = sessionsOnDay((sessions ?? []).filter(isEnded), day)
  const focusMinutes = sumFocusMinutes(daySessions)
  const focusBlocks = daySessions.filter((s) => s.kind === 'focus').length
  const done = (items ?? [])
    .filter((i) => i.doneAt !== null && isSameLocalDay(i.doneAt, day))
    .sort((a, b) => (a.doneAt ?? '').localeCompare(b.doneAt ?? ''))
  const captured = (items ?? []).filter((i) => isSameLocalDay(i.createdAt, day))

  const title = current ? 'Today' : isYesterday(day) ? 'Yesterday' : format(day, 'EEEE')
  const projectFor = (id: string | null) => (id ? projectMap.get(id) : undefined)

  return (
    <>
      <PageHeader title={title} description={format(day, 'MMMM d, yyyy')}>
        <Button variant="outline" size="icon-sm" aria-label="Previous day" onClick={() => setDay((d) => subDays(d, 1))}>
          <ChevronLeft />
        </Button>
        {!current && (
          <Button variant="outline" size="sm" onClick={() => setDay(startOfDay(new Date()))}>
            Today
          </Button>
        )}
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Next day"
          disabled={current}
          onClick={() => setDay((d) => addDays(d, 1))}
        >
          <ChevronRight />
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={formatMinutes(focusMinutes)} label="Focused" />
        <Stat value={focusBlocks} label="Focus blocks" />
        <Stat value={done.length} label="Todos done" />
        <Stat value={captured.length} label="Captured" />
      </div>

      <Section
        title="Time"
        action={
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setAdding(true)}>
            <Plus /> Log time
          </Button>
        }
      >
        {sessions === undefined ? null : daySessions.length === 0 ? (
          <EmptyState
            icon={Timer}
            title={current ? 'Nothing tracked yet today' : 'No time tracked this day'}
            description="Use the Focus timer, or log time by hand."
          />
        ) : (
          <ul className="divide-y rounded-xl bg-card ring-1 ring-foreground/10">
            {daySessions.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                project={projectFor(s.projectId)}
                item={s.itemId ? itemMap.get(s.itemId) : undefined}
                onEdit={setEditingSession}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Completed">
        {done.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">No todos completed.</p>
        ) : (
          <ul className="divide-y rounded-xl bg-card ring-1 ring-foreground/10">
            {done.map((i) => (
              <ItemRow key={i.id} item={i} project={projectFor(i.projectId)} onEdit={setEditingItem} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Captured">
        {captured.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">Nothing captured.</p>
        ) : (
          <ul className="divide-y rounded-xl bg-card ring-1 ring-foreground/10">
            {captured.map((i) => (
              <ItemRow key={i.id} item={i} project={projectFor(i.projectId)} onEdit={setEditingItem} />
            ))}
          </ul>
        )}
      </Section>

      <SessionDialog
        open={adding || editingSession !== null}
        onOpenChange={(o) => {
          if (!o) {
            setAdding(false)
            setEditingSession(null)
          }
        }}
        session={editingSession}
        defaultDay={day}
      />
      <ItemEditDialog item={editingItem} onClose={() => setEditingItem(null)} />
    </>
  )
}
