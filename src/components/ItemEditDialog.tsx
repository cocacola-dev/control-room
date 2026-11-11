import { useState, type FormEvent } from 'react'
import { CheckSquare, Lightbulb, Trash2 } from 'lucide-react'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ProjectDot } from '@/components/ProjectDot'
import { convertItem, deleteItem, restoreItem, updateItem } from '@/db/repo'
import type { Item, ItemType } from '@/db/schema'
import { useProjects } from '@/hooks/useData'

const NONE = '__none__'

export function ItemEditDialog({ item, onClose }: { item: Item | null; onClose: () => void }) {
  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {item && <EditForm key={item.id} item={item} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function EditForm({ item, onClose }: { item: Item; onClose: () => void }) {
  const [type, setType] = useState<ItemType>(item.type)
  const [title, setTitle] = useState(item.title)
  const [notes, setNotes] = useState(item.notes)
  const [projectId, setProjectId] = useState<string | null>(item.projectId)
  const [dueDate, setDueDate] = useState(item.dueDate ?? '')
  const projects = useProjects()

  async function save(e: FormEvent) {
    e.preventDefault()
    const text = title.trim()
    if (!text) return
    if (type !== item.type) await convertItem(item, type)
    await updateItem(item.id, {
      title: text,
      notes: notes.trim(),
      projectId,
      dueDate: type === 'todo' && dueDate ? dueDate : null,
    })
    onClose()
  }

  async function remove() {
    await deleteItem(item.id)
    onClose()
    toast('Deleted', {
      description: item.title,
      action: { label: 'Undo', onClick: () => void restoreItem(item.id) },
    })
  }

  const visibleProjects = (projects ?? []).filter((p) => !p.archived || p.id === item.projectId)

  return (
    <form onSubmit={save} className="contents">
      <DialogHeader>
        <DialogTitle>Edit {type}</DialogTitle>
        <DialogDescription className="sr-only">Change the title, notes, project or due date.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <Tabs value={type} onValueChange={(v) => setType(v as ItemType)}>
          <TabsList className="w-full">
            <TabsTrigger value="todo" className="flex-1">
              <CheckSquare /> Todo
            </TabsTrigger>
            <TabsTrigger value="idea" className="flex-1">
              <Lightbulb /> Idea
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid gap-1.5">
          <Label htmlFor="item-title">Title</Label>
          <Input id="item-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="item-notes">Notes</Label>
          <Textarea
            id="item-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Context, links, next steps…"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="item-project">Project</Label>
            <Select value={projectId ?? NONE} onValueChange={(v) => setProjectId(v === NONE ? null : v)}>
              <SelectTrigger id="item-project" className="w-full">
                <SelectValue placeholder="No project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No project</SelectItem>
                {visibleProjects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <ProjectDot color={p.color} />
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {type === 'todo' && (
            <div className="grid gap-1.5">
              <Label htmlFor="item-due">Due</Label>
              <Input id="item-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          )}
        </div>
      </div>

      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="ghost" className="text-destructive" onClick={() => void remove()}>
          <Trash2 /> Delete
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!title.trim()}>
            Save
          </Button>
        </div>
      </DialogFooter>
    </form>
  )
}
