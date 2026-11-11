import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ProjectDot } from '@/components/ProjectDot'
import { deleteSession, restoreSession } from '@/db/repo'
import type { Item, Project, Session } from '@/db/schema'
import { KIND_LABEL, durationMinutes, formatMinutes, formatTimeRange } from '@/lib/sessions'

export function SessionRow({
  session,
  project,
  item,
  onEdit,
}: {
  session: Session
  project?: Project
  item?: Item
  onEdit: (session: Session) => void
}) {
  const focus = session.kind === 'focus'

  async function remove() {
    await deleteSession(session.id)
    toast('Session deleted', {
      description: `${formatTimeRange(session)} · ${formatMinutes(durationMinutes(session))}`,
      action: { label: 'Undo', onClick: () => void restoreSession(session.id) },
    })
  }

  return (
    <li className="group flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40">
      <div className="w-[5.5rem] shrink-0 pt-0.5 text-xs text-muted-foreground tabular-nums">{formatTimeRange(session)}</div>

      <button type="button" onClick={() => onEdit(session)} className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium tabular-nums">{formatMinutes(durationMinutes(session))}</span>
          {focus ? (
            project ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <ProjectDot color={project.color} className="size-2" />
                {project.name}
              </span>
            ) : (
              <span className="text-muted-foreground">No project</span>
            )
          ) : (
            <Badge variant="secondary">{KIND_LABEL[session.kind]}</Badge>
          )}
          {!session.completed && <Badge variant="outline">stopped early</Badge>}
          {session.source === 'manual' && <Badge variant="outline">manual</Badge>}
        </div>
        {(item || session.note) && (
          <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-2 text-xs text-muted-foreground">
            {item && <span className="min-w-0 truncate">{item.title}</span>}
            {session.note && <span className="min-w-0 truncate">{session.note}</span>}
          </div>
        )}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Session actions"
            className="-my-1 text-muted-foreground md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEdit(session)}>
            <Pencil /> Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => void remove()}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
