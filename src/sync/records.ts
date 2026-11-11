import type { BaseRecord, Item, Project, Session } from '@/db/schema'

/**
 * Checking records that arrive from outside this device: from the sync server or from a backup file.
 *
 * Nothing from outside is trusted on arrival. Each record is rebuilt field by field from values of
 * the expected type. Unknown fields are dropped and anything malformed is rejected whole.
 */

export const SYNC_TABLES = ['projects', 'items', 'sessions'] as const
export type SyncTable = (typeof SYNC_TABLES)[number]
export type SyncRecord = Project | Item | Session

/**
 * Version of the record shapes below. Raise it whenever a table or field is added. A device that
 * meets a higher number than its own stops syncing until the app is updated, so an old version
 * can never overwrite data it does not understand.
 */
export const SYNC_SCHEMA = 1

/** What gets encrypted for one record. */
export interface Envelope {
  v: number
  t: SyncTable
  r: SyncRecord
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const ID = /^[A-Za-z0-9_-]{1,64}$/

type Raw = Record<string, unknown>

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const isIso = (v: unknown): v is string => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v))
const isIsoOrNull = (v: unknown): v is string | null => v === null || isIso(v)
const isIdOrNull = (v: unknown): v is string | null => v === null || (typeof v === 'string' && ID.test(v))
const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const oneOf = <T extends string>(v: unknown, options: readonly T[]): v is T => options.includes(v as T)

export const syncableId = (v: unknown): v is string => typeof v === 'string' && ID.test(v)

function base(r: Raw): BaseRecord | null {
  if (!syncableId(r.id) || !isIso(r.createdAt) || !isIso(r.updatedAt) || !isIsoOrNull(r.deletedAt)) return null
  return { id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt, deletedAt: r.deletedAt }
}

function project(r: Raw): Project | null {
  const b = base(r)
  if (!b || typeof r.name !== 'string' || typeof r.color !== 'string' || typeof r.archived !== 'boolean') return null
  return { ...b, name: r.name, color: r.color, archived: r.archived }
}

function item(r: Raw): Item | null {
  const b = base(r)
  if (
    !b ||
    !oneOf(r.type, ['idea', 'todo'] as const) ||
    typeof r.title !== 'string' ||
    typeof r.notes !== 'string' ||
    !isIdOrNull(r.projectId) ||
    !oneOf(r.status, ['open', 'done'] as const) ||
    !isIsoOrNull(r.doneAt) ||
    !(r.dueDate === null || (typeof r.dueDate === 'string' && DAY.test(r.dueDate)))
  ) {
    return null
  }
  return {
    ...b,
    type: r.type,
    title: r.title,
    notes: r.notes,
    projectId: r.projectId,
    status: r.status,
    doneAt: r.doneAt,
    dueDate: r.dueDate,
  }
}

function session(r: Raw): Session | null {
  const b = base(r)
  if (
    !b ||
    !oneOf(r.kind, ['focus', 'short-break', 'long-break'] as const) ||
    !oneOf(r.source, ['timer', 'manual'] as const) ||
    !isIdOrNull(r.projectId) ||
    !isIdOrNull(r.itemId) ||
    !isIso(r.startedAt) ||
    !isIsoOrNull(r.endedAt) ||
    !isAmount(r.plannedMinutes) ||
    !isAmount(r.pausedMs) ||
    !isIsoOrNull(r.pausedAt) ||
    typeof r.completed !== 'boolean' ||
    typeof r.note !== 'string'
  ) {
    return null
  }
  return {
    ...b,
    kind: r.kind,
    source: r.source,
    projectId: r.projectId,
    itemId: r.itemId,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    plannedMinutes: r.plannedMinutes,
    pausedMs: r.pausedMs,
    pausedAt: r.pausedAt,
    completed: r.completed,
    note: r.note,
  }
}

/** A clean copy of `raw` if it is a well-formed record of `table`, otherwise null. */
export function sanitizeRecord(table: 'projects', raw: unknown): Project | null
export function sanitizeRecord(table: 'items', raw: unknown): Item | null
export function sanitizeRecord(table: 'sessions', raw: unknown): Session | null
export function sanitizeRecord(table: SyncTable, raw: unknown): SyncRecord | null
export function sanitizeRecord(table: SyncTable, raw: unknown): SyncRecord | null {
  if (!isObject(raw)) return null
  return table === 'projects' ? project(raw) : table === 'items' ? item(raw) : session(raw)
}

/**
 * Read a decrypted envelope that claims to be the record `id`.
 * 'newer' means another device runs a newer app version; null means malformed.
 */
export function readEnvelope(raw: unknown, id: string): Envelope | 'newer' | null {
  if (!isObject(raw) || typeof raw.v !== 'number' || !Number.isInteger(raw.v) || raw.v < 1) return null
  if (raw.v > SYNC_SCHEMA) return 'newer'
  if (!oneOf(raw.t, SYNC_TABLES)) return null
  const record = sanitizeRecord(raw.t, raw.r)
  return record && record.id === id ? { v: raw.v, t: raw.t, r: record } : null
}

/** True when two records of `table` hold the same data. Fields are compared in a fixed order. */
export function sameRecord(table: SyncTable, a: unknown, b: unknown): boolean {
  const cleanA = sanitizeRecord(table, a)
  const cleanB = sanitizeRecord(table, b)
  return cleanA !== null && cleanB !== null && JSON.stringify(cleanA) === JSON.stringify(cleanB)
}
