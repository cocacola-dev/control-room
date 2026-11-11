import { useState } from 'react'
import { Archive, ArchiveRestore, FolderKanban, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { ProjectDot } from '@/components/ProjectDot'
import { ProjectDialog } from '@/components/ProjectDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { deleteProject, updateProject } from '@/db/repo'
import type { Project } from '@/db/schema'
import { useItems, useProjects } from '@/hooks/useData'

export function ProjectsPage() {
  const projects = useProjects()
  const items = useItems()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState<Project | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const active = (projects ?? []).filter((p) => !p.archived)
  const archived = (projects ?? []).filter((p) => p.archived)

  const counts = new Map<string, { todos: number; ideas: number }>()
  for (const i of items ?? []) {
    if (!i.projectId) continue
    const c = counts.get(i.projectId) ?? { todos: 0, ideas: 0 }
    if (i.type === 'todo' && i.status === 'open') c.todos += 1
    if (i.type === 'idea') c.ideas += 1
    counts.set(i.projectId, c)
  }

  function openNew() {
    setEditing(null)
    setDialogOpen(true)
  }
  function openEdit(p: Project) {
    setEditing(p)
    setDialogOpen(true)
  }

  const row = (p: Project) => {
    const c = counts.get(p.id) ?? { todos: 0, ideas: 0 }
    return (
      <li key={p.id} className="flex items-center gap-3 px-4 py-3">
        <ProjectDot color={p.color} className="size-3" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{p.name}</div>
          <div className="text-xs text-muted-foreground">
            {c.todos} open {c.todos === 1 ? 'todo' : 'todos'} · {c.ideas} {c.ideas === 1 ? 'idea' : 'ideas'}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${p.name}`} className="text-muted-foreground">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => openEdit(p)}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void updateProject(p.id, { archived: !p.archived })}>
              {p.archived ? (
                <>
                  <ArchiveRestore /> Unarchive
                </>
              ) : (
                <>
                  <Archive /> Archive
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setDeleting(p)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    )
  }

  return (
    <>
      <PageHeader title="Projects" description="Group your work so insights can compare it.">
        <Button size="sm" onClick={openNew}>
          <Plus /> New project
        </Button>
      </PageHeader>

      {projects === undefined ? null : active.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create one for each area of your life you want to track: work, a side project, a language, health."
        />
      ) : (
        <ul className="divide-y rounded-xl bg-card ring-1 ring-foreground/10">{active.map(row)}</ul>
      )}

      {archived.length > 0 && (
        <div className="mt-6">
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
          </Button>
          {showArchived && (
            <ul className="mt-2 divide-y rounded-xl bg-card opacity-75 ring-1 ring-foreground/10">{archived.map(row)}</ul>
          )}
        </div>
      )}

      <ProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} project={editing} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name ?? ''}"?`}
        description="Its todos and ideas are kept and simply lose the project label. Prefer Archive if you might come back to it."
        confirmLabel="Delete project"
        destructive
        onConfirm={async () => {
          if (!deleting) return
          await deleteProject(deleting.id)
          toast('Project deleted', { description: deleting.name })
        }}
      />
    </>
  )
}
