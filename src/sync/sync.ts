import { useSyncExternalStore } from 'react'
import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { createApi, SyncError } from './api'
import { SyncEngine } from './engine'
import { SYNC_TABLES } from './records'

/**
 * Decides when sync runs, and tells the UI how it is going.
 *
 * Sync runs: when the app opens, a moment after you change something, when you come back to
 * the app, when the network returns, and every half minute while the app is on screen.
 * It never blocks anything. The app reads and writes its local database; sync follows behind.
 */

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'rejected' | 'update-needed' | 'error'

export interface SyncStatus {
  phase: SyncPhase
  /** Extra detail for the 'error' phase. */
  detail: string | null
}

const IDLE: SyncStatus = { phase: 'idle', detail: null }
const POLL_MS = 30_000
const DEBOUNCE_MS = 1_500
const MAX_BACKOFF_MS = 5 * 60_000

const api = createApi()
const engine = new SyncEngine(db, api)

/* ---------- Status store ---------- */

let status: SyncStatus = IDLE
const listeners = new Set<() => void>()

function setStatus(next: SyncStatus) {
  if (next.phase === status.phase && next.detail === status.detail) return
  status = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    subscribe,
    () => status,
    () => IDLE,
  )
}

export interface SyncInfo {
  lastSyncAt: string | null
  unreadable: number
  unsendable: number
}

/** `undefined` while loading, `null` when sync is off on this device. The key itself is never handed to the UI. */
export function useSyncInfo(): SyncInfo | null | undefined {
  return useLiveQuery(async () => {
    const state = await db.syncState.get('state')
    return state ? { lastSyncAt: state.lastSyncAt, unreadable: state.unreadable, unsendable: state.unsendable } : null
  }, [])
}

function describe(err: unknown): SyncStatus {
  if (err instanceof SyncError) {
    if (err.kind === 'offline' || err.kind === 'no-server') return { phase: 'offline', detail: null }
    if (err.kind === 'rejected') return { phase: 'rejected', detail: null }
    if (err.kind === 'update-needed') return { phase: 'update-needed', detail: null }
    if (err.kind === 'off') return IDLE
    return { phase: 'error', detail: err.message }
  }
  return { phase: 'error', detail: err instanceof Error ? err.message : 'Something went wrong while syncing.' }
}

/* ---------- Running ---------- */

type Reason =
  /** Something changed on this device. Only goes to the network if there is something to send. */
  | 'local'
  /** A routine check for changes from other devices. */
  | 'check'
  /** The person asked. Shows progress. */
  | 'manual'

let running: Promise<void> | null = null
let queued: Reason | null = null
let failures = 0
let retryAfter = 0

async function run(reason: Reason) {
  if (!(await engine.state())) return
  if (reason === 'local' && (await engine.pendingCount()) === 0) return
  if (reason === 'manual') setStatus({ phase: 'syncing', detail: null })
  try {
    await engine.sync()
    failures = 0
    retryAfter = 0
    setStatus(IDLE)
  } catch (err) {
    failures += 1
    retryAfter = Date.now() + Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** Math.min(failures, 8))
    setStatus(describe(err))
  }
}

/** Only one tab syncs at a time. Other tabs skip a routine run, and wait their turn for a manual one. */
async function exclusively(reason: Reason, task: () => Promise<void>) {
  if (typeof navigator === 'undefined' || !navigator.locks) return task()
  await navigator.locks.request('control-room-sync', { ifAvailable: reason !== 'manual' }, async (lock) => {
    if (lock) await task()
  })
}

const rank = (reason: Reason) => (reason === 'manual' ? 2 : reason === 'check' ? 1 : 0)

export function requestSync(reason: Reason): Promise<void> {
  if (running) {
    if (!queued || rank(reason) > rank(queued)) queued = reason
    return running
  }
  running = exclusively(reason, () => run(reason))
    .catch((err: unknown) => setStatus(describe(err)))
    .finally(() => {
      running = null
      const next = queued
      queued = null
      if (next) void requestSync(next)
    })
  return running
}

/* ---------- Triggers ---------- */

let started = false
let debounce: ReturnType<typeof setTimeout> | undefined

const onScreen = () => document.visibilityState === 'visible'

/** Start watching for reasons to sync. Called once when the app starts. Does nothing until sync is turned on. */
export function startSync() {
  if (started) return
  started = true

  // Dexie announces every committed change, from this tab and from other tabs.
  const watched = SYNC_TABLES.map((table) => `idb://${db.name}/${table}/`)
  Dexie.on('storagemutated', (parts) => {
    if (!Object.keys(parts).some((part) => watched.some((prefix) => part.startsWith(prefix)))) return
    clearTimeout(debounce)
    debounce = setTimeout(() => {
      if (Date.now() >= retryAfter) void requestSync('local')
    }, DEBOUNCE_MS)
  })

  document.addEventListener('visibilitychange', () => {
    if (onScreen()) void requestSync('check')
  })
  window.addEventListener('online', () => void requestSync('check'))
  window.setInterval(() => {
    if (onScreen() && navigator.onLine !== false && Date.now() >= retryAfter) void requestSync('check')
  }, POLL_MS)

  void requestSync('check')
}

/* ---------- Actions for the Settings page ---------- */

export type ServerProbe = 'ready' | 'in-use' | 'none' | 'offline' | 'update-needed' | 'insecure'

/** Is there a sync server behind this copy of the app, and has sync been set up on it? */
export async function probeServer(): Promise<ServerProbe> {
  // Browsers only offer their cryptography on https addresses and on localhost.
  if (!globalThis.isSecureContext || typeof crypto === 'undefined' || !crypto.subtle) return 'insecure'
  try {
    return (await api.status()).claimed ? 'in-use' : 'ready'
  } catch (err) {
    if (err instanceof SyncError && err.kind === 'update-needed') return 'update-needed'
    return err instanceof SyncError && err.kind === 'offline' ? 'offline' : 'none'
  }
}

/** First device. Resolves with the new sync key, to be shown once. */
export async function setUpSync(): Promise<string> {
  const key = await engine.create()
  void requestSync('manual')
  return key
}

/** Another device. Rejects with a readable message if the key is wrong. */
export async function joinSync(keyText: string): Promise<void> {
  await engine.join(keyText)
  void requestSync('manual')
}

export async function turnOffSync(): Promise<void> {
  await engine.disable()
  failures = 0
  retryAfter = 0
  setStatus(IDLE)
}

export const syncNow = () => requestSync('manual')
