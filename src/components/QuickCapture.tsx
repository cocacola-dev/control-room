import { useRef, useState, type FormEvent } from 'react'
import { CheckSquare, Lightbulb, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ProjectDot } from '@/components/ProjectDot'
import { createItem } from '@/db/repo'
import type { ItemType } from '@/db/schema'
import { useProjects } from '@/hooks/useData'
import { cn } from '@/lib/utils'

const NONE = '__none__'

/**
 * The one input that everything starts from. Type, press Enter, keep typing.
 * Defaults follow the surrounding page (e.g. the Ideas tab captures ideas).
 */
export function QuickCapture({
  defaultType = 'todo',
  defaultProjectId = null,
  autoFocus = false,
}: {
  defaultType?: ItemType
  defaultProjectId?: string | null
  autoFocus?: boolean
}) {
  const [type, setType] = useState<ItemType>(defaultType)
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId)
  const inputRef = useRef<HTMLInputElement>(null)
  const projects = useProjects()

  // Follow the page when its defaults change (e.g. switching to the Ideas tab), without an effect.
  const [prevDefaults, setPrevDefaults] = useState({ defaultType, defaultProjectId })
  if (prevDefaults.defaultType !== defaultType || prevDefaults.defaultProjectId !== defaultProjectId) {
    setPrevDefaults({ defaultType, defaultProjectId })
    setType(defaultType)
    setProjectId(defaultProjectId)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const text = title.trim()
    if (!text) return
    await createItem({ type, title: text, projectId })
    setTitle('')
    inputRef.current?.focus()
  }

  const activeProjects = (projects ?? []).filter((p) => !p.archived)

  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-1.5 rounded-xl bg-card p-1.5 ring-1 ring-foreground/10 focus-within:ring-ring/60"
    >
      <div className="flex shrink-0 rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="Type">
        <TypeButton active={type === 'todo'} onClick={() => setType('todo')} label="Todo" icon={CheckSquare} />
        <TypeButton active={type === 'idea'} onClick={() => setType('idea')} label="Idea" icon={Lightbulb} />
      </div>

      <Input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus={autoFocus}
        enterKeyHint="done"
        autoComplete="off"
        placeholder={type === 'todo' ? 'Add a todo…' : 'Capture an idea…'}
        aria-label={type === 'todo' ? 'New todo' : 'New idea'}
        className="h-9 border-0 bg-transparent shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
      />

      {activeProjects.length > 0 && (
        <Select value={projectId ?? NONE} onValueChange={(v) => setProjectId(v === NONE ? null : v)}>
          <SelectTrigger size="sm" aria-label="Project" className="hidden max-w-36 sm:flex">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value={NONE}>No project</SelectItem>
            {activeProjects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <ProjectDot color={p.color} />
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Button type="submit" size="icon-sm" disabled={!title.trim()} aria-label="Add">
        <Plus />
      </Button>
    </form>
  )
}

function TypeButton({
  active,
  onClick,
  label,
  icon: Icon,
}: {
  active: boolean
  onClick: () => void
  label: string
  icon: typeof CheckSquare
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors',
        active && 'bg-background text-foreground shadow-xs',
      )}
    >
      <Icon className="size-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}
