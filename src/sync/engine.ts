import { remoteWrites, type ControlRoomDB } from '@/db/db'
import type { Session, SyncState, SyncedVersion } from '@/db/schema'
import { SyncError, type PulledChange, type SyncApi, type WireChange } from './api'
import { deriveKeys, generateSyncKey, open, parseSyncKey, seal } from './codec'
import { SYNC_SCHEMA, SYNC_TABLES, readEnvelope, sameRecord, sanitizeRecord, type Envelope, type SyncRecord, type SyncTable } from './records'

/**
 * The sync engine: keeps this device's database and the server's encrypted copy in step.
 *
 * How devices agree
 *   Each record carries `updatedAt`. When two versions of a record meet, the newer one wins
 *   whole. A deletion is just a version with `deletedAt` set, so it travels the same way.
 *
 * What gets sent
 *   The table `syncedVersions` remembers, per record, which version the server holds. Any record
 *   whose `updatedAt` differs from that note is sent. Nothing has to remember to flag a change:
 *   whatever differs from the server gets sent, however it came to differ.
 *
 * One run
 *   1. Pull: fetch what changed on the server since last time, decrypt, check, merge.
 *   2. Push: encrypt and send what changed here. The server only accepts a push from a device
 *      that has seen everything so far. If another device got in first, pull again and retry.
 *
 * Encryption and decryption happen outside database transactions. The database is only
 * touched in short all-or-nothing steps, so a crash or a closed tab can never leave it half merged.
 */

const STATE = 'state'
const PUSH_BATCH = 200
/** Stay under the server's per-record limit. A record this large would otherwise block every push. */
const MAX_BLOB_CHARS = 1_200_000
const MAX_ROUNDS = 6

export interface SyncOutcome {
  /** Records changed on this device by what other devices sent. */
  pulled: number
  /** Records sent from this device. */
  pushed: number
}

interface Dirty {
  table: SyncTable
  id: string
}

interface Decoded {
  id: string
  /** null: could not be decrypted or was malformed. */
  envelope: Envelope | null
}

export class SyncEngine {
  private readonly db: ControlRoomDB
  private readonly api: SyncApi

  constructor(db: ControlRoomDB, api: SyncApi) {
    this.db = db
    this.api = api
  }

  /** The stored sync state, or undefined when sync is off. */
  state(): Promise<SyncState | undefined> {
    return this.db.syncState.get(STATE)
  }

  /** First device: make a new sync key and register it with the server. Returns the key to show once. */
  async create(): Promise<string> {
    const { claimed } = await this.api.status()
    if (claimed) throw new SyncError('claimed', 'Sync is already set up on this server. Join with your sync key instead.')
    const keyText = await generateSyncKey()
    await this.connect(keyText)
    return keyText
  }

  /** Other devices: connect with the key made on the first one. */
  async join(keyText: string): Promise<void> {
    await this.connect(keyText)
  }

  private async connect(keyText: string) {
    const keys = await deriveKeys(await parseSyncKey(keyText))
    const { vault } = await this.api.claim(keys.token)
    const { db } = this
    await db.transaction('rw', db.syncState, db.syncedVersions, async () => {
      // Start with no notes about the server. The first run then compares every record.
      await db.syncedVersions.clear()
      await db.syncState.put({
        key: STATE,
        encKey: keys.encKey,
        token: keys.token,
        vault,
        cursor: 0,
        lastSyncAt: null,
        unreadable: 0,
        unsendable: 0,
      })
    })
  }

  /** Forget the key and all sync notes. Records stay on this device. */
  async disable(): Promise<void> {
    const { db } = this
    await db.transaction('rw', db.syncState, db.syncedVersions, async () => {
      await db.syncState.clear()
      await db.syncedVersions.clear()
    })
  }

  /** How many records on this device differ from what the server holds. */
  async pendingCount(): Promise<number> {
    return (await this.findDirty()).length
  }

  /** One full run: pull, then push, repeated if another device pushes in between. */
  async sync(): Promise<SyncOutcome> {
    const outcome: SyncOutcome = { pulled: 0, pushed: 0 }
    for (let round = 0; ; round++) {
      const pulledBefore = outcome.pulled
      await this.pull(outcome)
      if (outcome.pulled > pulledBefore) await this.endExtraTimers()
      const dirty = await this.findDirty()
      if (dirty.length === 0) break
      if (round >= MAX_ROUNDS) throw new SyncError('busy', 'Other devices kept syncing at the same moment. It will retry shortly.')
      if (await this.push(dirty, outcome)) break
    }
    await this.db.syncState.update(STATE, { lastSyncAt: new Date().toISOString() })
    return outcome
  }

  private async requireState(): Promise<SyncState> {
    const state = await this.state()
    if (!state) throw new SyncError('off', 'Sync is off on this device.')
    return state
  }

  /* ---------- Pull ---------- */

  private async pull(outcome: SyncOutcome) {
    for (;;) {
      const state = await this.requireState()
      const page = await this.api.pull(state.token, state.cursor)

      if (page.vault !== state.vault || page.seq < state.cursor) {
        // The server holds a different data set than last time (it was reset or restored from a
        // backup) but still accepts our key. Forget the notes and compare everything again.
        const { db } = this
        await db.transaction('rw', db.syncState, db.syncedVersions, async () => {
          await db.syncedVersions.clear()
          await db.syncState.update(STATE, { vault: page.vault, cursor: 0 })
        })
        continue
      }
      if (page.changes.length === 0) return

      const decoded = await Promise.all(page.changes.map((change) => this.decode(state.encKey, change)))
      const next = page.more ? page.changes[page.changes.length - 1].seq : page.seq
      outcome.pulled += await this.merge(state, decoded, next)
      if (!page.more) return
    }
  }

  private async decode(key: CryptoKey, change: PulledChange): Promise<Decoded> {
    let raw: unknown
    try {
      raw = await open(key, change.id, change.blob)
    } catch {
      return { id: change.id, envelope: null }
    }
    const envelope = readEnvelope(raw, change.id)
    if (envelope === 'newer') {
      // Stop before anything is merged. The position on the server is not advanced, so this
      // record is read again after the app has been updated.
      throw new SyncError('update-needed', 'Another device uses a newer version of Control Room.')
    }
    return { id: change.id, envelope }
  }

  /** Merge one page of decrypted changes and advance the cursor, all or nothing. Returns how many records changed here. */
  private async merge(state: SyncState, decoded: Decoded[], next: number): Promise<number> {
    const { db } = this
    let changed = 0
    await db.transaction('rw', [db.projects, db.items, db.sessions, db.syncedVersions, db.syncState], async (tx) => {
      remoteWrites.add(tx)
      const current = await db.syncState.get(STATE)
      if (!current || current.vault !== state.vault || current.cursor !== state.cursor) {
        throw new SyncError('busy', 'Sync was changed while it was running.')
      }
      for (const name of SYNC_TABLES) {
        const incoming = decoded.flatMap((d) => (d.envelope && d.envelope.t === name ? [d.envelope.r] : []))
        if (incoming.length === 0) continue
        const table = db.table<SyncRecord, string>(name)
        const locals = await table.bulkGet(incoming.map((r) => r.id))
        const winners = incoming.filter((remote, i) => {
          const local = locals[i]
          if (!local) return true
          if (remote.updatedAt !== local.updatedAt) return remote.updatedAt > local.updatedAt
          // Same timestamp: if the content differs too, the version the server already holds wins,
          // so every device settles on the same one.
          return !sameRecord(name, local, remote)
        })
        if (winners.length > 0) await table.bulkPut(winners)
        // Note what the server holds, whoever won. A local version that won now differs from the
        // note, which is exactly what marks it to be sent.
        await db.syncedVersions.bulkPut(incoming.map((r) => ({ id: r.id, v: r.updatedAt })))
        changed += winners.length
      }
      const unreadable = decoded.filter((d) => d.envelope === null).length
      await db.syncState.update(STATE, { cursor: next, unreadable: current.unreadable + unreadable })
    })
    return changed
  }

  /**
   * Two devices can each start a timer while apart, and after merging both would be running.
   * Keep the one started last. An earlier one ends where it would have finished, or where the
   * later one began, whichever came first.
   */
  private async endExtraTimers() {
    const { db } = this
    await db.transaction('rw', db.sessions, async () => {
      const running = await db.sessions.filter((s) => s.endedAt === null && s.deletedAt === null).toArray()
      if (running.length < 2) return
      running.sort((a, b) => (a.startedAt === b.startedAt ? (a.id < b.id ? -1 : 1) : a.startedAt < b.startedAt ? -1 : 1))
      const keeper = running[running.length - 1]
      const cutoff = Date.parse(keeper.startedAt)
      const stamp = new Date().toISOString()
      for (const s of running.slice(0, -1)) {
        const plannedEnd = Date.parse(s.startedAt) + s.plannedMinutes * 60_000 + s.pausedMs
        const patch: Partial<Session> =
          !s.pausedAt && plannedEnd <= cutoff
            ? { endedAt: new Date(plannedEnd).toISOString(), completed: true }
            : {
                endedAt: keeper.startedAt,
                completed: false,
                pausedMs: s.pausedMs + (s.pausedAt ? Math.max(0, cutoff - Date.parse(s.pausedAt)) : 0),
              }
        await db.sessions.update(s.id, { ...patch, pausedAt: null, updatedAt: stamp })
      }
    })
  }

  /* ---------- Push ---------- */

  /** Every record whose version differs from the one the server is known to hold. Reads index keys only. */
  private async findDirty(): Promise<Dirty[]> {
    const { db } = this
    const noted = new Map((await db.syncedVersions.toArray()).map((n) => [n.id, n.v]))
    const dirty: Dirty[] = []
    for (const name of SYNC_TABLES) {
      await db
        .table<SyncRecord, string>(name)
        .orderBy('updatedAt')
        .eachPrimaryKey((id, cursor) => {
          if (noted.get(id) !== cursor.key) dirty.push({ table: name, id })
        })
    }
    return dirty
  }

  /** Send changed records in batches. Returns false if another device pushed first: pull, then try again. */
  private async push(dirty: Dirty[], outcome: SyncOutcome): Promise<boolean> {
    const { db } = this
    for (let start = 0; start < dirty.length; start += PUSH_BATCH) {
      const state = await this.requireState()
      const batch = dirty.slice(start, start + PUSH_BATCH)
      const changes: WireChange[] = []
      const notes: SyncedVersion[] = []
      let unsendable = 0

      for (const name of SYNC_TABLES) {
        const ids = batch.filter((d) => d.table === name).map((d) => d.id)
        if (ids.length === 0) continue
        for (const row of await db.table<SyncRecord, string>(name).bulkGet(ids)) {
          if (!row) continue
          // Only well-formed records leave the device, in the same clean shape other devices expect.
          const clean = sanitizeRecord(name, row)
          const blob = clean ? await seal(state.encKey, clean.id, { v: SYNC_SCHEMA, t: name, r: clean } satisfies Envelope) : null
          if (!clean || !blob || blob.length > MAX_BLOB_CHARS) {
            // Note it as handled so it is not retried on every run. It is tried again once edited.
            unsendable += 1
            notes.push({ id: row.id, v: row.updatedAt })
            continue
          }
          changes.push({ id: clean.id, blob })
          notes.push({ id: clean.id, v: clean.updatedAt })
        }
      }

      let seq = state.cursor
      if (changes.length > 0) {
        try {
          const reply = await this.api.push(state.token, state.cursor, changes)
          if (reply.vault !== state.vault) throw new SyncError('busy', 'The server changed while syncing.')
          seq = reply.seq
        } catch (err) {
          if (err instanceof SyncError && err.kind === 'stale') return false
          throw err
        }
      }

      await db.transaction('rw', db.syncedVersions, db.syncState, async () => {
        const current = await db.syncState.get(STATE)
        if (!current || current.vault !== state.vault || current.cursor !== state.cursor) {
          throw new SyncError('busy', 'Sync was changed while it was running.')
        }
        // The note records the version that was sent. A record edited again in the meantime
        // has a newer `updatedAt` than its note, so it is picked up by the next run.
        await db.syncedVersions.bulkPut(notes)
        // The push was accepted on top of everything already seen, so the new position is ours.
        await db.syncState.update(STATE, { cursor: seq, unsendable: current.unsendable + unsendable })
      })
      outcome.pushed += changes.length
    }
    return true
  }
}
