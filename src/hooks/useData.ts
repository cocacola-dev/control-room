import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { alive, type Item, type Project, type Session } from '@/db/schema'

/** All live (not deleted) projects, alphabetically. `undefined` while loading. */
export function useProjects(): Project[] | undefined {
  return useLiveQuery(
    async () => (await db.projects.orderBy('name').toArray()).filter(alive),
    [],
  )
}

export function useItemMap(): Map<string, Item> {
  const items = useItems()
  return useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items])
}

export function useProjectMap(): Map<string, Project> {
  const projects = useProjects()
  return useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects])
}

/** All live items, newest first. Pages filter further in memory. */
export function useItems(): Item[] | undefined {
  return useLiveQuery(
    async () => (await db.items.orderBy('createdAt').reverse().toArray()).filter(alive),
    [],
  )
}

/** The one running timer, or null. `undefined` while loading. */
export function useActiveSession(): Session | null | undefined {
  return useLiveQuery(
    async () => (await db.sessions.filter((s) => s.endedAt === null && s.deletedAt === null).first()) ?? null,
    [],
  )
}

/** All live sessions, newest first. */
export function useSessions(): Session[] | undefined {
  return useLiveQuery(
    async () => (await db.sessions.orderBy('startedAt').reverse().toArray()).filter(alive),
    [],
  )
}
