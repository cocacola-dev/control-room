import { useState, type FormEvent } from 'react'
import { Check } from 'lucide-react'
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
import { createProject, updateProject } from '@/db/repo'
import { PROJECT_COLORS, type Project } from '@/db/schema'
import { cn } from '@/lib/utils'

export function ProjectDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, the dialog edits this project instead of creating one. */
  project?: Project | null
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <ProjectForm key={project?.id ?? 'new'} project={project ?? null} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function ProjectForm({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const [name, setName] = useState(project?.name ?? '')
  const [color, setColor] = useState<string>(project?.color ?? PROJECT_COLORS[5])

  async function save(e: FormEvent) {
    e.preventDefault()
    const text = name.trim()
    if (!text) return
    if (project) await updateProject(project.id, { name: text, color })
    else await createProject({ name: text, color })
    onClose()
  }

  return (
    <form onSubmit={save} className="contents">
      <DialogHeader>
        <DialogTitle>{project ? 'Edit project' : 'New project'}</DialogTitle>
        <DialogDescription>Projects group your todos, ideas and focus time so insights can compare them.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="project-name">Name</Label>
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Control Room, Spanish, Health"
            autoFocus
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Color</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                className={cn(
                  'flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-shadow',
                  color === c && 'ring-2 ring-foreground',
                )}
                style={{ backgroundColor: c }}
              >
                {color === c && <Check className="size-3.5 text-white" />}
              </button>
            ))}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim()}>
          {project ? 'Save' : 'Create'}
        </Button>
      </DialogFooter>
    </form>
  )
}
