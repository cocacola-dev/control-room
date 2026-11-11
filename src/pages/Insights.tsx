import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { format, parseISO } from 'date-fns'
import { BarChart3, Flame } from 'lucide-react'
import { BarList, type BarListRow } from '@/components/charts/BarList'
import { ChartCard, ColumnChartCard } from '@/components/charts/ChartCard'
import type { ChartSeries } from '@/components/charts/ColumnChart'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader, Section } from '@/components/PageHeader'
import { ProjectDot } from '@/components/ProjectDot'
import { Stat, type StatDelta } from '@/components/Stat'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Item, Project, Session } from '@/db/schema'
import { useItems, useProjects, useSessions } from '@/hooks/useData'
import { useNow } from '@/hooks/useNow'
import { dateKey } from '@/lib/dates'
import {
  ALL_PROJECTS,
  NO_PROJECT,
  RANGES,
  WEEKDAYS,
  backlog,
  buildPeriod,
  countTodos,
  focusByBucket,
  focusByHour,
  focusByItem,
  focusByProject,
  focusByWeekday,
  focusStreak,
  relativeChange,
  selectFocus,
  selectTodos,
  summarizeFocus,
  todosByBucket,
  trackingStart,
  type RangeId,
} from '@/lib/insights'
import { formatMinutes } from '@/lib/sessions'
import { insightsPrefs } from '@/lib/settings'

const FOCUS: ChartSeries[] = [{ name: 'Focus time', color: 'var(--chart-1)' }]
const DAILY_AVERAGE: ChartSeries[] = [{ name: 'Daily average', color: 'var(--chart-1)' }]
const TODO_FLOW: ChartSeries[] = [
  { name: 'Added', color: 'var(--chart-1)' },
  { name: 'Done', color: 'var(--chart-2)' },
]

const BUCKET_NAME = { day: 'Day', week: 'Week', month: 'Month' } as const
const hh = (hour: number) => `${String(hour % 24).padStart(2, '0')}:00`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const indexOfMax = (values: number[]) => values.indexOf(Math.max(...values))

/* ---------- Change indicators on the stat tiles ---------- */

function percentDelta(current: number, previous: number, before: string): StatDelta | null {
  const change = relativeChange(current, previous)
  if (change === null) return null
  const pct = Math.round(Math.abs(change) * 100)
  if (pct === 0) return { text: '0%', direction: 'flat', good: true, label: `Same as ${before}` }
  const up = change > 0
  return {
    text: pct > 999 ? '999%+' : `${pct}%`,
    direction: up ? 'up' : 'down',
    good: up,
    label: `${pct}% ${up ? 'more' : 'less'} than ${before}`,
  }
}

function countDelta(current: number, previous: number, before: string, unit = ''): StatDelta {
  const diff = current - previous
  if (diff === 0) return { text: `0${unit}`, direction: 'flat', good: true, label: `Same as ${before}` }
  const up = diff > 0
  return {
    text: `${Math.abs(diff)}${unit}`,
    direction: up ? 'up' : 'down',
    good: up,
    label: `${Math.abs(diff)}${unit} ${up ? 'more' : 'fewer'} than ${before}`,
  }
}

/* ---------- Page ---------- */

export function InsightsPage() {
  const sessions = useSessions()
  const items = useItems()
  const projects = useProjects()
  const now = useNow()
  // Wait for the database so the page never flashes an empty state.
  if (!sessions || !items || !projects) return <PageHeader title="Insights" />
  return <InsightsView sessions={sessions} items={items} projects={projects} now={now} />
}

/** The whole dashboard as a function of the records. Kept separate from the database hooks so it can be rendered with any data. */
export function InsightsView({
  sessions,
  items,
  projects,
  now,
}: {
  sessions: Session[]
  items: Item[]
  projects: Project[]
  now: Date
}) {
  const { range } = insightsPrefs.use()
  const [pickedProject, setPickedProject] = useState(ALL_PROJECTS)
  const filter =
    pickedProject === NO_PROJECT || projects.some((p) => p.id === pickedProject) ? pickedProject : ALL_PROJECTS

  // Every figure depends on the calendar day, not the minute, so the numbers are only recomputed when something changes.
  const todayKey = dateKey(now)
  const d = useMemo(() => {
    const today = parseISO(todayKey)
    const period = buildPeriod(range, today)
    const focus = selectFocus(sessions, filter)
    const todos = selectTodos(items, filter)
    return {
      period,
      current: summarizeFocus(focus, period.start, period.end),
      previous: summarizeFocus(focus, period.prevStart, period.start),
      perBucket: focusByBucket(period, focus),
      weekday: focusByWeekday(period, focus),
      hours: focusByHour(period, focus),
      byProject: focusByProject(period, focus),
      byItem: focusByItem(period, focus),
      flow: todosByBucket(period, todos),
      todosNow: countTodos(todos, period.start, period.end),
      todosBefore: countTodos(todos, period.prevStart, period.start),
      backlog: backlog(todos, today),
      streak: focusStreak(selectFocus(sessions, ALL_PROJECTS), today),
      since: trackingStart(sessions, items),
    }
  }, [sessions, items, range, filter, todayKey])

  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  const hasAnything = items.length > 0 || sessions.some((s) => s.kind === 'focus' && s.endedAt !== null)
  if (!hasAnything) {
    return (
      <>
        <PageHeader title="Insights" description="What your time and todos add up to." />
        <EmptyState
          icon={BarChart3}
          title="Nothing to chart yet"
          description="Run a focus block or capture a few todos. This page fills in as you go."
        />
        <div className="mt-4 flex justify-center">
          <Button asChild>
            <Link to="/focus">Start a focus block</Link>
          </Button>
        </div>
      </>
    )
  }

  const { period, current, previous } = d
  const before = `the ${period.days} days before`
  const noFocus = 'No focus time in this range yet.'
  const longRange = period.days > 7

  /* Stat tiles. Arrows only appear once the whole earlier span was tracked, so they never compare against a gap. */
  const comparable = d.since !== null && d.since <= period.prevStart.getTime()
  const focusDelta = comparable ? percentDelta(current.minutes, previous.minutes, before) : null
  const daysDelta = comparable ? countDelta(current.activeDays, previous.activeDays, before) : null
  const finishDelta =
    comparable && current.finishRate !== null && previous.finishRate !== null
      ? countDelta(Math.round(current.finishRate * 100), Math.round(previous.finishRate * 100), before, ' pts')
      : null
  const doneDelta = comparable ? countDelta(d.todosNow.done, d.todosBefore.done, before) : null

  /* Focus over time */
  const perDay = Math.round(current.minutes / period.days)

  /* By weekday */
  const bestDay = indexOfMax(d.weekday.average)
  const weekdayBuckets = WEEKDAYS.map((name, i) => ({
    key: name,
    label: name.slice(0, 3),
    title: longRange ? `${name}s` : name,
    note: d.weekday.days[i] > 1 ? `${formatMinutes(d.weekday.total[i])} over ${d.weekday.days[i]} days` : undefined,
  }))

  /* By hour */
  const peakHour = indexOfMax(d.hours)
  const hourBuckets = d.hours.map((_, h) => ({ key: String(h), label: String(h).padStart(2, '0'), title: `${hh(h)} to ${hh(h + 1)}` }))

  /* Where the time went */
  const share = (minutes: number) => (current.minutes ? minutes / current.minutes : 0)
  const topProjects = d.byProject.filter((s) => s.id !== null)
  const shownProjects = topProjects.slice(0, 7)
  const otherProjects = topProjects.slice(7)
  const otherProjectMinutes = otherProjects.reduce((acc, s) => acc + s.minutes, 0)
  const noProjectMinutes = d.byProject.find((s) => s.id === null)?.minutes ?? 0
  const projectRows: BarListRow[] = [
    ...shownProjects.map((s) => {
      const p = projectMap.get(s.id as string)
      return {
        key: s.id as string,
        name: p?.name ?? 'Deleted project',
        marker: <ProjectDot color={p?.color ?? 'var(--muted-foreground)'} />,
        value: s.minutes,
        display: formatMinutes(s.minutes),
        share: share(s.minutes),
      }
    }),
    ...(otherProjectMinutes > 0
      ? [
          {
            key: '__other__',
            name: `${plural(otherProjects.length, 'other project')}`,
            value: otherProjectMinutes,
            display: formatMinutes(otherProjectMinutes),
            share: share(otherProjectMinutes),
            muted: true,
          },
        ]
      : []),
    ...(noProjectMinutes > 0
      ? [
          {
            key: '__none__',
            name: 'No project',
            value: noProjectMinutes,
            display: formatMinutes(noProjectMinutes),
            share: share(noProjectMinutes),
            muted: true,
          },
        ]
      : []),
  ]
  const leader = shownProjects[0]
  const leaderName = leader ? (projectMap.get(leader.id as string)?.name ?? 'A deleted project') : null

  const linkedTodos = d.byItem.filter((s) => s.id !== null)
  const unlinkedMinutes = d.byItem.find((s) => s.id === null)?.minutes ?? 0
  const todoRows: BarListRow[] = linkedTodos.slice(0, 6).map((s) => ({
    key: s.id as string,
    name: itemMap.get(s.id as string)?.title ?? 'Deleted todo',
    value: s.minutes,
    display: formatMinutes(s.minutes),
    share: share(s.minutes),
  }))

  /* Todos */
  const net = d.todosNow.added - d.todosNow.done
  const flowTakeaway =
    d.todosNow.added + d.todosNow.done === 0
      ? 'No todos added or finished in this range.'
      : `${d.todosNow.added} added, ${d.todosNow.done} done. ${
          net > 0 ? `The backlog grew by ${net}.` : net < 0 ? `The backlog shrank by ${-net}.` : 'The backlog held steady.'
        }`

  const backlogRows: BarListRow[] = d.backlog.byProject.map((b) => {
    const p = b.id ? projectMap.get(b.id) : undefined
    return {
      key: b.id ?? '__none__',
      name: b.id ? (p?.name ?? 'Deleted project') : 'No project',
      marker: b.id ? <ProjectDot color={p?.color ?? 'var(--muted-foreground)'} /> : undefined,
      value: b.count,
      display: String(b.count),
      share: d.backlog.open ? b.count / d.backlog.open : 0,
      muted: b.id === null,
    }
  })

  const showProjects = filter === ALL_PROJECTS
  const activeProjects = projects.filter((p) => !p.archived)

  return (
    <>
      <PageHeader title="Insights" description="What your time and todos add up to.">
        {d.streak.current >= 2 && (
          <Badge variant="secondary" title={`Days in a row with focus time. Your best is ${plural(d.streak.best, 'day')}.`}>
            <Flame aria-hidden /> {d.streak.current}-day streak
          </Badge>
        )}
      </PageHeader>

      {/* One filter row. Everything below it reads from the same slice, so the numbers always agree. */}
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={range} onValueChange={(v) => insightsPrefs.set({ range: v as RangeId })}>
          <TabsList aria-label="Date range">
            {RANGES.map((r) => (
              <TabsTrigger key={r.id} value={r.id} aria-label={`Last ${r.name}`}>
                <span className="sm:hidden">{r.short}</span>
                <span className="hidden sm:inline">{r.name}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Select value={filter} onValueChange={setPickedProject}>
          <SelectTrigger size="sm" aria-label="Filter by project" className="max-w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
            {activeProjects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <ProjectDot color={p.color} />
                {p.name}
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem value={NO_PROJECT}>No project</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="mt-2 px-0.5 text-xs text-muted-foreground">
        {format(period.start, 'MMM d')} to today.{' '}
        {comparable
          ? `Arrows compare with ${before}.`
          : 'Comparison arrows appear once a full earlier period has been tracked.'}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={formatMinutes(current.minutes)} label="Focused" delta={focusDelta} />
        <Stat value={current.activeDays} suffix={`of ${period.days}`} label="Active days" delta={daysDelta} />
        <Stat
          value={current.finishRate === null ? '–' : `${Math.round(current.finishRate * 100)}%`}
          label="Finish rate"
          delta={finishDelta}
        />
        <Stat value={d.todosNow.done} label="Todos done" delta={doneDelta} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <ColumnChartCard
          className="sm:col-span-2"
          title={`Focus per ${period.unit}`}
          subtitle={
            current.minutes > 0
              ? `${formatMinutes(perDay)} a day on average, across ${plural(current.blocks, 'block')}.`
              : noFocus
          }
          firstColumn={BUCKET_NAME[period.unit]}
          ariaLabel={`Focus time per ${period.unit}`}
          buckets={period.buckets}
          series={FOCUS}
          values={[d.perBucket]}
          unit="minutes"
          format={formatMinutes}
          labelPeak
        />

        <ColumnChartCard
          title="By weekday"
          subtitle={
            current.minutes > 0
              ? longRange
                ? `${WEEKDAYS[bestDay]}s are strongest: ${formatMinutes(d.weekday.average[bestDay])} on average.`
                : `${WEEKDAYS[bestDay]} was strongest: ${formatMinutes(d.weekday.average[bestDay])}.`
              : noFocus
          }
          firstColumn="Weekday"
          ariaLabel={longRange ? 'Average focus time per weekday' : 'Focus time per weekday'}
          buckets={weekdayBuckets}
          series={longRange ? DAILY_AVERAGE : FOCUS}
          values={[d.weekday.average]}
          unit="minutes"
          format={formatMinutes}
          height={136}
          labelAnchor="start"
        />

        <ColumnChartCard
          title="By time of day"
          subtitle={current.minutes > 0 ? `Your peak hour starts at ${hh(peakHour)}.` : noFocus}
          firstColumn="Hour"
          ariaLabel="Focus time by hour of the day"
          buckets={hourBuckets}
          series={FOCUS}
          values={[d.hours]}
          unit="minutes"
          format={formatMinutes}
          height={136}
          labelAnchor="start"
        />

        {showProjects && (
          <ChartCard
            title="Time by project"
            subtitle={
              leaderName
                ? projectRows.length === 1
                  ? `All of your focus time went to ${leaderName}.`
                  : `${leaderName} took ${Math.round(share(leader.minutes) * 100)}% of your focus time.`
                : current.minutes > 0
                  ? 'None of this time is linked to a project.'
                  : noFocus
            }
          >
            {/* One row is not a comparison: the sentence above already says it all. */}
            {projectRows.length > 1 && <BarList rows={projectRows} />}
          </ChartCard>
        )}

        <ChartCard
          className={showProjects ? undefined : 'sm:col-span-2'}
          title="Time by todo"
          subtitle={
            current.minutes === 0
              ? noFocus
              : linkedTodos.length === 0
                ? 'Pick "Focus on this" from a todo\'s menu to see what the time went into.'
                : unlinkedMinutes > 0
                  ? `${formatMinutes(unlinkedMinutes)} was not linked to a todo.`
                  : 'All of this time was linked to a todo.'
          }
        >
          {todoRows.length > 0 && (
            <>
              <BarList rows={todoRows} />
              {linkedTodos.length > todoRows.length && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Plus {plural(linkedTodos.length - todoRows.length, 'more todo')}.
                </p>
              )}
            </>
          )}
        </ChartCard>

        <ColumnChartCard
          className="sm:col-span-2"
          title="Todos added and done"
          subtitle={flowTakeaway}
          firstColumn={BUCKET_NAME[period.unit]}
          ariaLabel={`Todos added and done per ${period.unit}`}
          buckets={period.buckets}
          series={TODO_FLOW}
          values={[d.flow.added, d.flow.done]}
          unit="count"
          format={String}
          height={136}
        />
      </div>

      <Section title="Right now">
        <ChartCard
          title="Open todos"
          subtitle={
            d.backlog.open === 0
              ? 'Nothing open. Enjoy it.'
              : `${plural(d.backlog.open, 'todo')} open. The oldest has waited ${plural(d.backlog.oldestDays ?? 0, 'day')}.`
          }
        >
          {backlogRows.length > 0 && <BarList rows={backlogRows} />}
        </ChartCard>
        <p className="mt-2 px-0.5 text-xs text-muted-foreground">A snapshot of today. The date range does not apply here.</p>
      </Section>
    </>
  )
}
