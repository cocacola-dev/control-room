import { db } from './db'
import { nowIso, dateKey } from '@/lib/dates'
import { sanitizeRecord } from '@/sync/records'
import type { BaseRecord, Item, Project, Session } from './schema'

/** The on-disk backup format. Plain JSON so it stays readable by any tool, forever. */
export interface ExportFile {
  app: 'control-room'
  schemaVersion: 1
  exportedAt: string
  projects: Project[]
  items: Item[]
  sessions: Session[]
}

export async function buildExport(): Promise<ExportFile> {
  const [projects, items, sessions] = await Promise.all([
    db.projects.toArray(),
    db.items.toArray(),
    db.sessions.toArray(),
  ])
  return { app: 'control-room', schemaVersion: 1, exportedAt: nowIso(), projects, items, sessions }
}

export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const exportFilename = () => `control-room-backup-${dateKey(new Date())}.json`

export interface ImportSummary {
  projects: number
  items: number
  sessions: number
  skipped: number
}

/** Check every entry of one list and return clean copies. Throws if any entry is malformed. */
function readList<T>(file: Record<string, unknown>, key: string, clean: (entry: unknown) => T | null): T[] {
  const list = file[key]
  if (!Array.isArray(list)) throw new Error(`Missing "${key}" list.`)
  return (list as unknown[]).map((entry) => {
    const record = clean(entry)
    if (!record) throw new Error(`Some entries in "${key}" are malformed.`)
    return record
  })
}

/**
 * Validate a parsed backup. We never trust file contents blindly: every record is rebuilt field
 * by field with the same checks used for records arriving by sync, and anything of the wrong
 * shape rejects the file before the database is touched.
 */
export function parseExport(raw: unknown): ExportFile {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('Not a JSON object.')
  const file = raw as Record<string, unknown>
  if (file.app !== 'control-room') throw new Error('This file was not exported by Control Room.')
  if (file.schemaVersion !== 1) throw new Error(`Unsupported backup version: ${String(file.schemaVersion)}.`)
  return {
    app: 'control-room',
    schemaVersion: 1,
    exportedAt: typeof file.exportedAt === 'string' ? file.exportedAt : '',
    projects: readList(file, 'projects', (e) => sanitizeRecord('projects', e)),
    items: readList(file, 'items', (e) => sanitizeRecord('items', e)),
    sessions: readList(file, 'sessions', (e) => sanitizeRecord('sessions', e)),
  }
}

/**
 * Merge a backup into the local database. For each record the newer `updatedAt` wins,
 * so importing an old backup never overwrites recent work. This is the same rule sync uses.
 * With sync on, whatever the import changed is sent to the other devices on the next run.
 */
export async function importExport(file: ExportFile): Promise<ImportSummary> {
  const summary: ImportSummary = { projects: 0, items: 0, sessions: 0, skipped: 0 }

  async function mergeInto<T extends BaseRecord>(
    get: (id: string) => Promise<T | undefined>,
    put: (record: T) => Promise<unknown>,
    incoming: T[],
    key: keyof Omit<ImportSummary, 'skipped'>,
  ) {
    for (const rec of incoming) {
      const existing = await get(rec.id)
      if (!existing || rec.updatedAt > existing.updatedAt) {
        await put(rec)
        summary[key] += 1
      } else {
        summary.skipped += 1
      }
    }
  }

  await db.transaction('rw', db.projects, db.items, db.sessions, async () => {
    await mergeInto((id) => db.projects.get(id), (r) => db.projects.put(r), file.projects, 'projects')
    await mergeInto((id) => db.items.get(id), (r) => db.items.put(r), file.items, 'items')
    await mergeInto((id) => db.sessions.get(id), (r) => db.sessions.put(r), file.sessions, 'sessions')
  })
  return summary
}
