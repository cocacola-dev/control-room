import { useEffect, useState, type ReactNode } from 'react'
import { Bell, Check, Pause, Play, Square } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProjectDot } from '@/components/ProjectDot'
import { pauseSession, resumeSession, setItemStatus, stopSession } from '@/db/repo'
import type { Session, SessionKind } from '@/db/schema'
import { useActiveSession, useItemMap, useItems, useProjectMap, useProjects, useSessions } from '@/hooks/useData'
import { useNow } from '@/hooks/useNow'
import { notificationPermission, requestNotificationPermission } from '@/lib/alerts'
import {
  KIND_LABEL,
  MINUTE,
  elapsedMs,
  focusBlocksSinceLongBreak,
  formatClock,
  formatMinutes,
  isEnded,
  progress,
  remainingMs,
  sessionsOnDay,
  sumFocusMinutes,
} from '@/lib/sessions'
import { useTimerSettings } from '@/lib/settings'
import { minutesFor, startBreak, startFocus } from '@/lib/timerActions'
import { dismissFinished, useLastFinished } from '@/lib/timerStore'
import { cn } from '@/lib/utils'

const NONE = '__none__'
const FOCUS_CHIPS = [15, 25, 45, 60, 90]
const BREAK_CHIPS = [5, 10, 15, 20, 30]

/**
 * The timer itself: setup, running and "what next" states. Render it only once items have loaded,
 * so the initial selection (from ?item= or the last used project) can be resolved synchronously.
 */
export function FocusTimer({ initialItemId = null }: { initialItemId?: string | null }) {
  const active = useActiveSession()
  const settings = useTimerSettings()
  const projects = useProjects() ?? []
  const items = useItems() ?? []
  const projectMap = useProjectMap()
  const itemMap = useItemMap()
  const sessions = useSessions() ?? []
  const finished = useLastFinished()
  const running = !!active && !active.pausedAt
  const now = useNow(running ? 1000 : 60_000).getTime()

  const [kind, setKind] = useState<SessionKind>('focus')
  const [minutes, setMinutes] = useState(settings.focusMinutes)
  const [itemId, setItemId] = useState<string | null>(() => {
    const candidate = initialItemId ?? settings.lastItemId
    return candidate && itemMap.get(candidate)?.status === 'open' ? candidate : null
  })
  const [projectId, setProjectId] = useState<string | null>(() => {
    if (initialItemId) return itemMap.get(initialItemId)?.projectId ?? null
    return settings.lastProjectId && projectMap.has(settings.lastProjectId) ? settings.lastProjectId : null
  })

  const todaySessions = sessionsOnDay(sessions.filter(isEnded), new Date(now))
  const blocksToday = todaySessions.filter((s) => s.kind === 'focus' && s.completed).length
  const focusToday = sumFocusMinutes(todaySessions)
  const suggestedBreak: SessionKind =
    focusBlocksSinceLongBreak(todaySessions) >= settings.longBreakEvery ? 'long-break' : 'short-break'

  const activeProjects = projects.filter((p) => !p.archived || p.id === projectId)
  const todoOptions = items.filter(
    (i) => i.type === 'todo' && (i.status === 'open' || i.id === itemId) && (!projectId || i.projectId === projectId || i.id === itemId),
  )

  function selectKind(k: SessionKind) {
    setKind(k)
    setMinutes(minutesFor(k))
  }
  function selectProject(id: string | null) {
    setProjectId(id)
    if (itemId && id && itemMap.get(itemId)?.projectId !== id) setItemId(null)
  }
  function selectItem(id: string | null) {
    setItemId(id)
    const p = id ? itemMap.get(id)?.projectId : undefined
    if (p) setProjectId(p)
  }

  async function start() {
    if (kind === 'focus') await startFocus({ projectId, itemId, minutes })
    else await startBreak(kind, minutes)
  }

  async function stop() {
    if (!active) return
    const spent = Math.round(elapsedMs(active) / MINUTE)
    const result = await stopSession(active.id)
    toast(result === 'discarded' ? 'Discarded' : 'Stopped early', {
      description: result === 'discarded' ? 'Blocks under a minute are not logged.' : `${formatMinutes(spent)} logged.`,
    })
  }

  // Space pauses and resumes while a block is running, unless you are typing somewhere.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.target !== document.body) return
      e.preventDefault()
      // Holding the key down repeats it many times a second. One press is one pause or resume.
      if (e.repeat) return
      void (active.pausedAt ? resumeSession(active.id) : pauseSession(active.id))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  if (active === undefined) return null

  const showFinished = finished !== null && !active && now - finished.at < 30 * MINUTE

  return (
    <div className="rounded-2xl bg-card p-5 ring-1 ring-foreground/10 sm:p-8">
      {active ? (
        <RunningView
          session={active}
          now={now}
          projectName={active.projectId ? projectMap.get(active.projectId) : undefined}
          itemTitle={active.itemId ? itemMap.get(active.itemId)?.title : undefined}
          onStop={() => void stop()}
        />
      ) : showFinished ? (
        <FinishedView
          session={finished.session}
          blocksToday={blocksToday}
          focusToday={focusToday}
          suggestedBreak={suggestedBreak}
          itemTitle={finished.session.itemId ? itemMap.get(finished.session.itemId) : undefined}
        />
      ) : (
        <div className="grid gap-6">
          <Tabs value={kind} onValueChange={(v) => selectKind(v as SessionKind)} className="items-center">
            <TabsList>
              <TabsTrigger value="focus">Focus</TabsTrigger>
              <TabsTrigger value="short-break">Short break</TabsTrigger>
              <TabsTrigger value="long-break">Long break</TabsTrigger>
            </TabsList>
          </Tabs>

          <Ring value={0} kind={kind}>
            <div className="text-6xl font-semibold tracking-tight tabular-nums">{formatClock(minutes * MINUTE)}</div>
            <div className="mt-1 text-sm text-muted-foreground">{KIND_LABEL[kind]}</div>
          </Ring>

          <div className="flex flex-wrap justify-center gap-1.5" role="radiogroup" aria-label="Length">
            {chipsFor(kind, minutes).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={m === minutes}
                onClick={() => setMinutes(m)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
                  m === minutes && 'border-foreground bg-foreground text-background hover:text-background',
                )}
              >
                {m} min
              </button>
            ))}
          </div>

          {kind === 'focus' && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={projectId ?? NONE} onValueChange={(v) => selectProject(v === NONE ? null : v)}>
                <SelectTrigger aria-label="Project" className="w-full">
                  <SelectValue placeholder="Project" />
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
              <Select value={itemId ?? NONE} onValueChange={(v) => selectItem(v === NONE ? null : v)}>
                <SelectTrigger aria-label="Todo" className="w-full">
                  <SelectValue placeholder="Todo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No specific todo</SelectItem>
                  {todoOptions.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      <span className="max-w-64 truncate">{i.title}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button size="lg" className="mx-auto w-full sm:w-auto sm:min-w-56" onClick={() => void start()}>
            <Play /> Start {KIND_LABEL[kind].toLowerCase()}
          </Button>

          <NotificationHint />
        </div>
      )}
    </div>
  )
}

function chipsFor(kind: SessionKind, current: number): number[] {
  const base = kind === 'focus' ? FOCUS_CHIPS : BREAK_CHIPS
  return Array.from(new Set([...base, current])).sort((a, b) => a - b)
}

function Ring({ value, kind, children }: { value: number; kind: SessionKind; children: ReactNode }) {
  const r = 120
  const c = 2 * Math.PI * r
  return (
    <div className="relative mx-auto size-64 sm:size-72">
      <svg viewBox="0 0 264 264" className="size-full -rotate-90" aria-hidden>
        <circle cx="132" cy="132" r={r} fill="none" strokeWidth="10" className="stroke-muted" />
        <circle
          cx="132"
          cy="132"
          r={r}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value)}
          className={cn(
            'transition-[stroke-dashoffset] duration-1000 ease-linear',
            kind === 'focus' ? 'stroke-foreground' : 'stroke-emerald-500',
          )}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  )
}

function RunningView({
  session,
  now,
  projectName,
  itemTitle,
  onStop,
}: {
  session: Session
  now: number
  projectName?: { name: string; color: string }
  itemTitle?: string
  onStop: () => void
}) {
  const paused = session.pausedAt !== null
  return (
    <div className="grid gap-6">
      <div className="text-center text-sm font-medium text-muted-foreground">
        {paused ? 'Paused' : KIND_LABEL[session.kind]}
      </div>
      <Ring value={progress(session, now)} kind={session.kind}>
        <div className={cn('text-6xl font-semibold tracking-tight tabular-nums', paused && 'text-muted-foreground')}>
          {formatClock(remainingMs(session, now))}
        </div>
        {projectName && (
          <div className="mt-2 flex max-w-52 items-center gap-1.5 text-sm text-muted-foreground">
            <ProjectDot color={projectName.color} className="size-2" />
            <span className="truncate">{projectName.name}</span>
          </div>
        )}
        {itemTitle && <div className="mt-0.5 max-w-56 truncate text-xs text-muted-foreground">{itemTitle}</div>}
      </Ring>
      <div className="flex justify-center gap-2">
        <Button
          variant="outline"
          size="lg"
          className="min-w-32"
          onClick={() => void (paused ? resumeSession(session.id) : pauseSession(session.id))}
        >
          {paused ? (
            <>
              <Play /> Resume
            </>
          ) : (
            <>
              <Pause /> Pause
            </>
          )}
        </Button>
        <Button variant="outline" size="lg" className="min-w-32" onClick={onStop}>
          <Square /> Stop
        </Button>
      </div>
      <p className="hidden text-center text-xs text-muted-foreground sm:block">
        Space pauses. The clock runs on timestamps, so it stays right even if you close the tab.
      </p>
    </div>
  )
}

function FinishedView({
  session,
  blocksToday,
  focusToday,
  suggestedBreak,
  itemTitle,
}: {
  session: Session
  blocksToday: number
  focusToday: number
  suggestedBreak: SessionKind
  itemTitle?: { id: string; title: string; status: string }
}) {
  const settings = useTimerSettings()
  const isFocus = session.kind === 'focus'
  return (
    <div className="grid gap-6 py-4">
      <div className="text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Check className="size-6" />
        </div>
        <h2 className="text-xl font-semibold">{isFocus ? 'Focus block complete' : 'Break over'}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {isFocus
            ? `${formatMinutes(session.plannedMinutes)} logged. ${blocksToday} ${blocksToday === 1 ? 'block' : 'blocks'} and ${formatMinutes(focusToday)} focused today.`
            : 'Back to it?'}
        </p>
      </div>

      {isFocus && itemTitle && itemTitle.status === 'open' && (
        <Button
          variant="outline"
          className="mx-auto max-w-full"
          onClick={() => {
            void setItemStatus(itemTitle.id, 'done')
            toast.success('Marked done', { description: itemTitle.title })
          }}
        >
          <Check /> <span className="truncate">Mark "{itemTitle.title}" done</span>
        </Button>
      )}

      <div className="flex flex-wrap justify-center gap-2">
        {isFocus ? (
          <>
            <Button
              size="lg"
              variant={suggestedBreak === 'short-break' ? 'default' : 'outline'}
              onClick={() => void startBreak('short-break')}
            >
              Short break · {formatMinutes(settings.shortBreakMinutes)}
            </Button>
            <Button
              size="lg"
              variant={suggestedBreak === 'long-break' ? 'default' : 'outline'}
              onClick={() => void startBreak('long-break')}
            >
              Long break · {formatMinutes(settings.longBreakMinutes)}
            </Button>
            <Button size="lg" variant="ghost" onClick={dismissFinished}>
              Skip break
            </Button>
          </>
        ) : (
          <>
            <Button
              size="lg"
              onClick={() => void startFocus({ projectId: settings.lastProjectId, itemId: settings.lastItemId })}
            >
              <Play /> Start focus · {formatMinutes(settings.focusMinutes)}
            </Button>
            <Button size="lg" variant="ghost" onClick={dismissFinished}>
              Not now
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function NotificationHint() {
  const [perm, setPerm] = useState(notificationPermission)
  if (perm === 'granted' || perm === 'unsupported') return null
  if (perm === 'denied') {
    return (
      <p className="text-center text-xs text-muted-foreground">
        Notifications are blocked for this site. The chime and the tab title still work.
      </p>
    )
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className="mx-auto text-muted-foreground"
      onClick={async () => setPerm(await requestNotificationPermission())}
    >
      <Bell /> Notify me when a block ends
    </Button>
  )
}
