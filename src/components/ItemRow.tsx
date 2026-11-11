import { useNavigate } from 'react-router'
import { CheckSquare, Lightbulb, MoreHorizontal, Pencil, Timer, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ProjectDot } from '@/components/ProjectDot'
import { convertItem, deleteItem, restoreItem, toggleItemDone } from '@/db/repo'
import type { Item, Project } from '@/db/schema'
import { formatDue, isOverdue } from '@/lib/dates'
import { cn } from '@/lib/utils'

export function ItemRow({
  item,
  project,
  onEdit,
}: {
  item: Item
  project?: Project
  onEdit: (item: Item) => void
}) {
  const navigate = useNavigate()
  const done = item.status === 'done'
  const overdue = item.dueDate !== null && !done && isOverdue(item.dueDate)

  async function remove() {
    await deleteItem(item.id)
    toast('Deleted', {
      description: item.title,
      action: { label: 'Undo', onClick: () => void restoreItem(item.id) },
    })
  }

  return (
    <li className="group flex items-start gap-3 px-2 py-2.5 transition-colors hover:bg-muted/40">
      {item.type === 'todo' ? (
        <Checkbox
          checked={done}
          onCheckedChange={() => void toggleItemDone(item)}
          aria-label={done ? 'Mark as not done' : 'Mark as done'}
          className="mt-0.5"
        />
      ) : (
        <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-500" aria-label="Idea" />
      )}

      <button type="button" onClick={() => onEdit(item)} className="min-w-0 flex-1 text-left">
        <div className={cn('text-sm leading-5', done && 'text-muted-foreground line-through')}>{item.title}</div>
        {(item.notes || project || item.dueDate) && (
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {project && (
              <span className="inline-flex items-center gap-1">
                <ProjectDot color={project.color} className="size-2" />
                {project.name}
              </span>
            )}
            {item.dueDate && (
              <span className={cn(overdue && 'font-medium text-destructive')}>{formatDue(item.dueDate)}</span>
            )}
            {item.notes && <span className="min-w-0 truncate">{item.notes}</span>}
          </div>
        )}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="More actions"
            className="-my-1 text-muted-foreground md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEdit(item)}>
            <Pencil /> Edit
          </DropdownMenuItem>
          {item.type === 'todo' && !done && (
            <DropdownMenuItem onClick={() => void navigate(`/focus?item=${item.id}`)}>
              <Timer /> Focus on this
            </DropdownMenuItem>
          )}
          {item.type === 'todo' ? (
            <DropdownMenuItem onClick={() => void convertItem(item, 'idea')}>
              <Lightbulb /> Turn into idea
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => void convertItem(item, 'todo')}>
              <CheckSquare /> Turn into todo
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => void remove()}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
