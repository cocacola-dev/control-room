import Dexie, { type EntityTable } from 'dexie'
import type { BaseRecord, Item, Project, Session, SyncState, SyncedVersion } from './schema'

/**
 * Transactions that write records exactly as another device sent them.
 * The sync engine adds its transaction here so the rule below leaves those writes untouched.
 */
export const remoteWrites = new WeakSet<object>()

/**
 * Local database (IndexedDB). This is the source of truth on each device.
 * Indexes list the fields we query by; everything else is filtered in memory,
 * which is fast for the volume a single person produces.
 */
export class ControlRoomDB extends Dexie {
  projects!: EntityTable<Project, 'id'>
  items!: EntityTable<Item, 'id'>
  sessions!: EntityTable<Session, 'id'>
  /** Sync bookkeeping. See SyncedVersion and SyncState in schema.ts. */
  syncedVersions!: EntityTable<SyncedVersion, 'id'>
  syncState!: EntityTable<SyncState, 'key'>

  constructor(name = 'control-room') {
    super(name)
    this.version(1).stores({
      projects: 'id, name, createdAt, updatedAt',
      items: 'id, type, status, projectId, dueDate, createdAt, updatedAt',
      sessions: 'id, kind, projectId, itemId, startedAt, updatedAt',
    })
    // Version 2 adds the two sync tables. Existing tables and their data are untouched.
    this.version(2).stores({
      syncedVersions: 'id',
      syncState: 'key',
    })
    keepUpdatedAtMoving(this.projects)
    keepUpdatedAtMoving(this.items)
    keepUpdatedAtMoving(this.sessions)
  }
}

/**
 * Every local change must move a record's `updatedAt` forward, because "newest wins" is how
 * devices agree on a record. A device whose clock runs behind would otherwise stamp an edit
 * earlier than the version it just edited, and the edit would lose everywhere. This rule makes
 * the stamp at least one millisecond later than the version being replaced. It also stamps
 * any update that forgot to set `updatedAt` at all.
 */
function keepUpdatedAtMoving<T extends BaseRecord>(table: EntityTable<T, 'id'>) {
  table.hook('updating', (changes, _id, existing, tx) => {
    if (remoteWrites.has(tx) || Object.keys(changes).length === 0) return undefined
    const previous = existing.updatedAt
    const next = (changes as { updatedAt?: unknown }).updatedAt
    if (typeof next === 'string' && next > previous) return undefined
    const now = new Date().toISOString()
    if (now > previous) return { updatedAt: now }
    const parsed = Date.parse(previous)
    return { updatedAt: Number.isNaN(parsed) ? now : new Date(parsed + 1).toISOString() }
  })
}

export const db = new ControlRoomDB()
