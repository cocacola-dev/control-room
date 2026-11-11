import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Plus, Timer } from 'lucide-react'
import { PageHeader, Section } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { FocusTimer } from '@/components/FocusTimer'
import { SessionRow } from '@/components/SessionRow'
import { SessionDialog } from '@/components/SessionDialog'
import { Button } from '@/components/ui/button'
import type { Session } from '@/db/schema'
import { useItemMap, useItems, useProjectMap, useSessions } from '@/hooks/useData'
import { useNow } from '@/hooks/useNow'
import { formatMinutes, isEnded, sessionsOnDay, sumFocusMinutes } from '@/lib/sessions'

export function FocusPage() {
  const [params] = useSearchParams()
  const presetItem = params.get('item')
  const items = useItems()
  const sessions = useSessions()
  const projectMap = useProjectMap()
  const itemMap = useItemMap()
  const now = useNow()
  const [editing, setEditing] = useState<Session | null>(null)
  const [adding, setAdding] = useState(false)

  const today = sessionsOnDay((sessions ?? []).filter(isEnded), now)
  const focusToday = sumFocusMinutes(today)

  return (
    <>
      <PageHeader title="Focus" description="One block at a time." />

      {items === undefined ? null : <FocusTimer key={presetItem ?? 'default'} initialItemId={presetItem} />}

      <Section
        title={`Today · ${formatMinutes(focusToday)} focused`}
        action={
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setAdding(true)}>
            <Plus /> Log time
          </Button>
        }
      >
        {sessions === undefined ? null : today.length === 0 ? (
          <EmptyState
            icon={Timer}
            title="No sessions yet today"
            description="Start a block above, or log time you already spent without the timer."
          />
        ) : (
          <ul className="divide-y rounded-xl bg-card ring-1 ring-foreground/10">
            {[...today].reverse().map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                project={s.projectId ? projectMap.get(s.projectId) : undefined}
                item={s.itemId ? itemMap.get(s.itemId) : undefined}
                onEdit={setEditing}
              />
            ))}
          </ul>
        )}
      </Section>

      <SessionDialog
        open={adding || editing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setAdding(false)
            setEditing(null)
          }
        }}
        session={editing}
      />
    </>
  )
}
