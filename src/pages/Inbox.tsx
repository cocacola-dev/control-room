import { useState } from 'react'
import { Link } from 'react-router'
import { FolderKanban, Inbox } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { QuickCapture } from '@/components/QuickCapture'
import { ItemRow } from '@/components/ItemRow'
import { ItemEditDialog } from '@/components/ItemEditDialog'
import { EmptyState } from '@/components/EmptyState'
import { ProjectDot } from '@/components/ProjectDot'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useItems, useProjectMap, useProjects } from '@/hooks/useData'
import type { Item } from '@/db/schema'

type Filter = 'all' | 'todo' | 'idea'
const ALL = '__all__'

export function InboxPage() {
  const items = useItems()
  const projects = useProjects()
  const projectMap = useProjectMap()
  const [filter, setFilter] = useState<Filter>('all')
  const [projectFilter, setProjectFilter] = useState<string>(ALL)
  const [showDone, setShowDone] = useState(false)
  const [editing, setEditing] = useState<Item | null>(null)

  const visible = (items ?? []).filter(
    (i) => (filter === 'all' || i.type === filter) && (projectFilter === ALL || i.projectId === projectFilter),
  )
  const open = visible.filter((i) => i.status === 'open')
  const done = visible
    .filter((i) => i.status === 'done')
    .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))

  const projectFor = (i: Item) => (i.projectId ? projectMap.get(i.projectId) : undefined)
  const activeProjects = (projects ?? []).filter((p) => !p.archived)

  return (
    <>
      <PageHeader title="Inbox" description="Capture now, sort later.">
        <Button asChild variant="outline" size="sm" className="md:hidden">
          <Link to="/projects">
            <FolderKanban /> Projects
          </Link>
        </Button>
      </PageHeader>

      <QuickCapture
        defaultType={filter === 'idea' ? 'idea' : 'todo'}
        defaultProjectId={projectFilter === ALL ? null : projectFilter}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="todo">Todos</TabsTrigger>
            <TabsTrigger value="idea">Ideas</TabsTrigger>
          </TabsList>
        </Tabs>

        {activeProjects.length > 0 && (
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger size="sm" aria-label="Filter by project" className="max-w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All projects</SelectItem>
              {activeProjects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <ProjectDot color={p.color} />
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={showDone} onCheckedChange={setShowDone} />
          Show done
        </label>
      </div>

      <div className="mt-4">
        {items === undefined ? null : open.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={filter === 'idea' ? 'No ideas yet' : filter === 'todo' ? 'No open todos' : 'Inbox is empty'}
            description="Type above and press Enter. Ideas and todos can be converted into each other at any time."
          />
        ) : (
          <ul className="divide-y rounded-xl bg-card ring-1 ring-foreground/10">
            {open.map((item) => (
              <ItemRow key={item.id} item={item} project={projectFor(item)} onEdit={setEditing} />
            ))}
          </ul>
        )}
      </div>

      {showDone && done.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Completed · {done.length}
          </h2>
          <ul className="divide-y rounded-xl bg-card ring-1 ring-foreground/10">
            {done.map((item) => (
              <ItemRow key={item.id} item={item} project={projectFor(item)} onEdit={setEditing} />
            ))}
          </ul>
        </section>
      )}

      <ItemEditDialog item={editing} onClose={() => setEditing(null)} />
    </>
  )
}
