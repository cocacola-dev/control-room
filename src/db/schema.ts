/**
 * Data model.
 *
 * Every record is a timestamped row with a UUID. `updatedAt` and `deletedAt` exist from day one
 * so that the future sync layer can merge changes between devices without a schema migration:
 * deletions are soft (the row stays, with `deletedAt` set) and the newest `updatedAt` wins.
 */

/** ISO 8601 timestamp, e.g. 2026-11-08T07:30:00.000Z */
export type IsoTimestamp = string
/** Local calendar day, e.g. 2026-11-08 */
export type DayKey = string

export interface BaseRecord {
  id: string
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
  deletedAt: IsoTimestamp | null
}

export interface Project extends BaseRecord {
  name: string
  /** Hex color used for dots and badges. */
  color: string
  archived: boolean
}

export type ItemType = 'idea' | 'todo'
export type ItemStatus = 'open' | 'done'

/** A captured thought. Ideas and todos share one table so one can become the other. */
export interface Item extends BaseRecord {
  type: ItemType
  title: string
  notes: string
  projectId: string | null
  status: ItemStatus
  doneAt: IsoTimestamp | null
  dueDate: DayKey | null
}

export type SessionKind = 'focus' | 'short-break' | 'long-break'
export type SessionSource = 'timer' | 'manual'

/**
 * A block of time. Written by the Focus timer or logged by hand. The basis of all time analytics.
 * Duration is always derived: endedAt - startedAt - pausedMs. Nothing is counted while paused.
 */
export interface Session extends BaseRecord {
  kind: SessionKind
  source: SessionSource
  projectId: string | null
  itemId: string | null
  startedAt: IsoTimestamp
  /** null while the timer is running. Exactly one session may be running at a time. */
  endedAt: IsoTimestamp | null
  plannedMinutes: number
  /** Total time spent paused, excluded from the duration. */
  pausedMs: number
  /** Set while paused. */
  pausedAt: IsoTimestamp | null
  /** Ran to its planned end (timer) or was logged by hand. False when stopped early. */
  completed: boolean
  note: string
}

/* ---------- Sync bookkeeping: stays on this device, never exported, never sent ---------- */

/**
 * For one record: the `updatedAt` of the version the sync server is known to hold.
 * A record whose own `updatedAt` differs from this has changes waiting to be sent.
 */
export interface SyncedVersion {
  id: string
  v: IsoTimestamp
}

/** Present only while sync is on. One row, keyed 'state'. */
export interface SyncState {
  key: 'state'
  /**
   * Encrypts and decrypts records. Stored as a non-extractable key: the browser can use it,
   * but neither this app nor an injected script can read its bytes back out.
   */
  encKey: CryptoKey
  /** Proves to the server that this device belongs. Derived from the sync key, and cannot be turned back into it. */
  token: string
  /** Which data set on the server this device is paired with. */
  vault: string
  /** The last server change this device has applied. */
  cursor: number
  lastSyncAt: IsoTimestamp | null
  /** Records received that could not be decrypted or were malformed, and were skipped. Should stay 0. */
  unreadable: number
  /** Local records that could not be sent (malformed or too large). Should stay 0. */
  unsendable: number
}

export const isBreak = (kind: SessionKind) => kind !== 'focus'

export const alive = <T extends BaseRecord>(r: T): boolean => r.deletedAt === null

export const PROJECT_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#78716c', // stone
] as const
