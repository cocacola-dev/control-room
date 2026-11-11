import { db } from './db'
import { newId } from '@/lib/ids'
import { nowIso } from '@/lib/dates'
import type { Item, ItemStatus, ItemType, Project, Session, SessionKind } from './schema'

/* ---------- Projects ---------- */

export async function createProject(input: { name: string; color: string }): Promise<Project> {
  const ts = nowIso()
  const project: Project = {
    id: newId(),
    name: input.name.trim(),
    color: input.color,
    archived: false,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  }
  await db.projects.add(project)
  return project
}

export async function updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'color' | 'archived'>>) {
  await db.projects.update(id, { ...patch, updatedAt: nowIso() })
}

/** Soft-delete a project and detach its items so nothing points at a missing project. */
export async function deleteProject(id: string) {
  const ts = nowIso()
  await db.transaction('rw', db.projects, db.items, db.sessions, async () => {
    await db.projects.update(id, { deletedAt: ts, updatedAt: ts })
    await db.items.where('projectId').equals(id).modify({ projectId: null, updatedAt: ts })
    await db.sessions.where('projectId').equals(id).modify({ projectId: null, updatedAt: ts })
  })
}

/* ---------- Items (ideas + todos) ---------- */

export async function createItem(input: {
  type: ItemType
  title: string
  notes?: string
  projectId?: string | null
  dueDate?: string | null
}): Promise<Item> {
  const ts = nowIso()
  const item: Item = {
    id: newId(),
    type: input.type,
    title: input.title.trim(),
    notes: input.notes?.trim() ?? '',
    projectId: input.projectId ?? null,
    status: 'open',
    doneAt: null,
    dueDate: input.type === 'todo' ? (input.dueDate ?? null) : null,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  }
  await db.items.add(item)
  return item
}

export async function updateItem(
  id: string,
  patch: Partial<Pick<Item, 'type' | 'title' | 'notes' | 'projectId' | 'dueDate'>>,
) {
  await db.items.update(id, { ...patch, updatedAt: nowIso() })
}

export async function setItemStatus(id: string, status: ItemStatus) {
  const ts = nowIso()
  await db.items.update(id, { status, doneAt: status === 'done' ? ts : null, updatedAt: ts })
}

export async function toggleItemDone(item: Item) {
  await setItemStatus(item.id, item.status === 'done' ? 'open' : 'done')
}

/** Turn an idea into a todo or back. A todo turning into an idea loses its due date and done state. */
export async function convertItem(item: Item, type: ItemType) {
  if (item.type === type) return
  const ts = nowIso()
  await db.items.update(item.id, {
    type,
    updatedAt: ts,
    ...(type === 'idea' ? { status: 'open' as const, doneAt: null, dueDate: null } : {}),
  })
}

export async function deleteItem(id: string) {
  const ts = nowIso()
  await db.items.update(id, { deletedAt: ts, updatedAt: ts })
}

/* ---------- Everything ---------- */

/**
 * Permanently erase all local data. Used by Settings → Delete all data.
 * Also forgets the sync key and notes, so this device stops syncing. Without that, the next
 * sync would quietly bring back only whatever changes next on other devices: a confusing half state.
 */
export async function wipeAllData() {
  await db.transaction('rw', [db.projects, db.items, db.sessions, db.syncState, db.syncedVersions], async () => {
    await db.projects.clear()
    await db.items.clear()
    await db.sessions.clear()
    await db.syncState.clear()
    await db.syncedVersions.clear()
  })
}

/** Undo a soft delete (used by the "Undo" action on the delete toast). */
export async function restoreItem(id: string) {
  await db.items.update(id, { deletedAt: null, updatedAt: nowIso() })
}

/* ---------- Sessions (focus timer + manual time) ---------- */

const runningSessions = () => db.sessions.filter((s) => s.endedAt === null && s.deletedAt === null)

export async function startSession(input: {
  kind: SessionKind
  projectId: string | null
  itemId: string | null
  plannedMinutes: number
}): Promise<Session> {
  const ts = nowIso()
  const session: Session = {
    id: newId(),
    kind: input.kind,
    source: 'timer',
    projectId: input.projectId,
    itemId: input.itemId,
    startedAt: ts,
    endedAt: null,
    plannedMinutes: input.plannedMinutes,
    pausedMs: 0,
    pausedAt: null,
    completed: false,
    note: '',
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  }
  await db.transaction('rw', db.sessions, async () => {
    // Safety net: there is never more than one running timer.
    const stale = await runningSessions().toArray()
    for (const s of stale) await db.sessions.update(s.id, { endedAt: ts, pausedAt: null, completed: false, updatedAt: ts })
    await db.sessions.add(session)
  })
  return session
}

/**
 * Pause, resume and stop look the session up again inside a transaction instead of trusting the
 * copy the screen is holding. When buttons are pressed in quick succession the screen can be a
 * moment behind the database, and acting on an outdated copy would book running time as paused
 * time or the other way round. A press that no longer applies (pausing what is already paused)
 * simply does nothing.
 */
const stillRunning = async (id: string) => {
  const s = await db.sessions.get(id)
  return s && !s.endedAt && !s.deletedAt ? s : undefined
}

export async function pauseSession(id: string) {
  await db.transaction('rw', db.sessions, async () => {
    const s = await stillRunning(id)
    if (!s || s.pausedAt) return
    const ts = nowIso()
    await db.sessions.update(id, { pausedAt: ts, updatedAt: ts })
  })
}

export async function resumeSession(id: string) {
  await db.transaction('rw', db.sessions, async () => {
    const s = await stillRunning(id)
    if (!s || !s.pausedAt) return
    const now = Date.now()
    await db.sessions.update(id, {
      pausedMs: s.pausedMs + Math.max(0, now - Date.parse(s.pausedAt)),
      pausedAt: null,
      updatedAt: new Date(now).toISOString(),
    })
  })
}

/** The block reached its planned length. Ends exactly at the planned end, even if we noticed late. */
export async function completeSession(s: Session) {
  if (s.endedAt) return
  const plannedEnd = Date.parse(s.startedAt) + s.plannedMinutes * 60_000 + s.pausedMs
  await db.sessions.update(s.id, {
    endedAt: new Date(plannedEnd).toISOString(),
    pausedAt: null,
    completed: true,
    updatedAt: nowIso(),
  })
}

/** Stop before the planned end. Blocks under a minute are discarded rather than logged as noise. */
export async function stopSession(id: string): Promise<'saved' | 'discarded'> {
  return db.transaction('rw', db.sessions, async () => {
    const s = await stillRunning(id)
    if (!s) return 'saved'
    const now = Date.now()
    const pausedMs = s.pausedMs + (s.pausedAt ? Math.max(0, now - Date.parse(s.pausedAt)) : 0)
    const elapsed = now - Date.parse(s.startedAt) - pausedMs
    const ts = new Date(now).toISOString()
    if (elapsed < 60_000) {
      await db.sessions.update(id, { endedAt: ts, pausedAt: null, pausedMs, deletedAt: ts, updatedAt: ts })
      return 'discarded'
    }
    await db.sessions.update(id, { endedAt: ts, pausedAt: null, pausedMs, completed: false, updatedAt: ts })
    return 'saved'
  })
}

/** Log time that happened without the timer. */
export async function addManualSession(input: {
  projectId: string | null
  itemId: string | null
  startedAt: Date
  minutes: number
  note?: string
}): Promise<Session> {
  const ts = nowIso()
  const session: Session = {
    id: newId(),
    kind: 'focus',
    source: 'manual',
    projectId: input.projectId,
    itemId: input.itemId,
    startedAt: input.startedAt.toISOString(),
    endedAt: new Date(input.startedAt.getTime() + input.minutes * 60_000).toISOString(),
    plannedMinutes: input.minutes,
    pausedMs: 0,
    pausedAt: null,
    completed: true,
    note: input.note?.trim() ?? '',
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  }
  await db.sessions.add(session)
  return session
}

/** Edit an ended session. Duration is applied by moving the end; paused time is preserved. */
export async function updateSession(
  s: Session,
  patch: { projectId?: string | null; itemId?: string | null; note?: string; startedAt?: Date; minutes?: number },
) {
  const startedAt = patch.startedAt ?? new Date(s.startedAt)
  const minutes = patch.minutes ?? Math.round((Date.parse(s.endedAt ?? s.startedAt) - Date.parse(s.startedAt) - s.pausedMs) / 60_000)
  const endedAt = s.endedAt ? new Date(startedAt.getTime() + minutes * 60_000 + s.pausedMs).toISOString() : null
  await db.sessions.update(s.id, {
    projectId: patch.projectId !== undefined ? patch.projectId : s.projectId,
    itemId: patch.itemId !== undefined ? patch.itemId : s.itemId,
    note: patch.note !== undefined ? patch.note.trim() : s.note,
    startedAt: startedAt.toISOString(),
    endedAt,
    plannedMinutes: s.source === 'manual' ? minutes : s.plannedMinutes,
    updatedAt: nowIso(),
  })
}

export async function deleteSession(id: string) {
  const ts = nowIso()
  await db.sessions.update(id, { deletedAt: ts, updatedAt: ts })
}

export async function restoreSession(id: string) {
  await db.sessions.update(id, { deletedAt: null, updatedAt: nowIso() })
}
