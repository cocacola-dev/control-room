import { useState, type FormEvent } from 'react'
import { format, isToday } from 'date-fns'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ProjectDot } from '@/components/ProjectDot'
import { addManualSession, deleteSession, restoreSession, updateSession } from '@/db/repo'
import type { Session } from '@/db/schema'
import { useItemMap, useItems, useProjects } from '@/hooks/useData'
import { durationMinutes } from '@/lib/sessions'

const NONE = '__none__'
const CHIPS = [15, 25, 45, 60, 90, 120]

/** Log time by hand (session = null) or edit an ended session. */
export function SessionDialog({
  open,
  onOpenChange,
  session,
  defaultDay,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  session: Session | null
  defaultDay?: Date
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <SessionForm key={session?.id ?? 'new'} session={session} defaultDay={defaultDay} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function defaultStart(day?: Date): Date {
  const d = new Date()
  if (day && !isToday(day)) {
    const copy = new Date(day)
    copy.setHours(9, 0, 0, 0)
    return copy
  }
  d.setMinutes(d.getMinutes() - 25, 0, 0)
  return d
}

const toLocalInput = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm")

function SessionForm({ session, defaultDay, onClose }: { session: Session | null; defaultDay?: Date; onClose: () => void }) {
  const projects = useProjects() ?? []
  const items = useItems() ?? []
  const itemMap = useItemMap()
  const isNew = session === null

  const [projectId, setProjectId] = useState<string | null>(session?.projectId ?? null)
  const [itemId, setItemId] = useState<string | null>(session?.itemId ?? null)
  const [startValue, setStartValue] = useState(toLocalInput(session ? new Date(session.startedAt) : defaultStart(defaultDay)))
  const [minutes, setMinutes] = useState<string>(String(session ? Math.max(1, durationMinutes(session)) : 25))
  const [note, setNote] = useState(session?.note ?? '')

  const parsedMinutes = Number.parseInt(minutes, 10)
  const start = new Date(startValue)
  const valid = Number.isFinite(parsedMinutes) && parsedMinutes >= 1 && parsedMinutes <= 24 * 60 && !Number.isNaN(start.getTime())

  const activeProjects = projects.filter((p) => !p.archived || p.id === projectId)
  const todoOptions = items.filter(
    (i) => i.type === 'todo' && (i.status === 'open' || i.id === itemId) && (!projectId || i.projectId === projectId || i.id === itemId),
  )

  function selectItem(id: string | null) {
    setItemId(id)
    const p = id ? itemMap.get(id)?.projectId : undefined
    if (p) setProjectId(p)
  }
  function selectProject(id: string | null) {
    setProjectId(id)
    if (itemId && id && itemMap.get(itemId)?.projectId !== id) setItemId(null)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    if (session) await updateSession(session, { projectId, itemId, note, startedAt: start, minutes: parsedMinutes })
    else await addManualSession({ projectId, itemId, startedAt: start, minutes: parsedMinutes, note })
    onClose()
  }

  async function remove() {
    if (!session) return
    await deleteSession(session.id)
    onClose()
    toast('Session deleted', { action: { label: 'Undo', onClick: () => void restoreSession(session.id) } })
  }

  return (
    <form onSubmit={save} className="contents">
      <DialogHeader>
        <DialogTitle>{isNew ? 'Log time' : 'Edit session'}</DialogTitle>
        <DialogDescription>
          {isNew ? 'Add focus time that happened without the timer.' : 'Adjust what this block was about or when it happened.'}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="session-start">Start</Label>
            <Input id="session-start" type="datetime-local" value={startValue} onChange={(e) => setStartValue(e.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="session-minutes">Minutes</Label>
            <Input
              id="session-minutes"
              type="number"
              inputMode="numeric"
              min={1}
              max={1440}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CHIPS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMinutes(String(m))}
              className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground aria-pressed:border-foreground aria-pressed:text-foreground"
              aria-pressed={parsedMinutes === m}
            >
              {m}m
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="session-project">Project</Label>
            <Select value={projectId ?? NONE} onValueChange={(v) => selectProject(v === NONE ? null : v)}>
              <SelectTrigger id="session-project" className="w-full">
                <SelectValue placeholder="No project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No project</SelectItem>
                {activeProjects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <ProjectDot color={p.color} />
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="session-item">Todo</Label>
            <Select value={itemId ?? NONE} onValueChange={(v) => selectItem(v === NONE ? null : v)}>
              <SelectTrigger id="session-item" className="w-full">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {todoOptions.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    <span className="max-w-56 truncate">{i.title}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="session-note">Note</Label>
          <Textarea id="session-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What did you work on?" />
        </div>
      </div>

      <DialogFooter className={session ? 'sm:justify-between' : undefined}>
        {session && (
          <Button type="button" variant="ghost" className="text-destructive" onClick={() => void remove()}>
            <Trash2 /> Delete
          </Button>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid}>
            {isNew ? 'Log time' : 'Save'}
          </Button>
        </div>
      </DialogFooter>
    </form>
  )
}
