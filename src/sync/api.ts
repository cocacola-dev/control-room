/**
 * Talking to the sync server. This is the only network code in the app.
 *
 * Requests go to the app's own address and nowhere else (the Content Security Policy enforces
 * that as well). Every reply is checked for shape before it is used: the server is treated as
 * a party that may be wrong.
 */

export type SyncErrorKind =
  /** The server could not be reached. Normal when away from the private network. */
  | 'offline'
  /** This copy of the app is not being served by the sync server. */
  | 'no-server'
  /** The server does not accept this device's key. */
  | 'rejected'
  /** Another device pushed first. Pull and try again. */
  | 'stale'
  /** Sync is already set up on the server. */
  | 'claimed'
  /** Another device or the server runs a newer version than this app. */
  | 'update-needed'
  /** Sync was changed or turned off while a run was in progress. */
  | 'busy'
  /** Sync is not turned on. */
  | 'off'
  | 'server'

export class SyncError extends Error {
  readonly kind: SyncErrorKind
  constructor(kind: SyncErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

export interface WireChange {
  id: string
  blob: string
}

export interface PulledChange extends WireChange {
  seq: number
}

export interface PullPage {
  vault: string
  seq: number
  more: boolean
  changes: PulledChange[]
}

export interface SyncApi {
  status(): Promise<{ claimed: boolean }>
  claim(token: string): Promise<{ vault: string; seq: number }>
  pull(token: string, since: number): Promise<PullPage>
  push(token: string, base: number, changes: WireChange[]): Promise<{ vault: string; seq: number }>
}

const PROTOCOL = 1
const TIMEOUT_MS = 20_000

type Raw = Record<string, unknown>
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

const unexpected = () => new SyncError('server', 'The sync server sent a reply this app does not understand.')

/** `base` is empty in the app (same address as the page). Tests pass a full address. */
export function createApi(base = '', fetchImpl: typeof fetch = (...args) => fetch(...args)): SyncApi {
  async function call(path: string, init: RequestInit): Promise<{ status: number; body: Raw }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    let response: Response
    try {
      response = await fetchImpl(base + path, {
        ...init,
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      })
    } catch {
      throw new SyncError('offline', 'The sync server cannot be reached right now.')
    } finally {
      clearTimeout(timer)
    }
    // Without the sync server, a request for /api/… gets a web page or an error page, not JSON.
    if (!(response.headers.get('content-type') ?? '').startsWith('application/json')) {
      throw new SyncError('no-server', 'There is no sync server at this address.')
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw unexpected()
    }
    if (!isObject(body)) throw unexpected()
    if (response.status === 401) throw new SyncError('rejected', "The server does not accept this device's key.")
    if (response.status >= 500) throw new SyncError('server', 'The sync server ran into a problem.')
    return { status: response.status, body }
  }

  const authed = (token: string, extra?: Record<string, string>) => ({ Authorization: `Bearer ${token}`, ...extra })

  return {
    async status() {
      const { status, body } = await call('/api/sync/status', { method: 'GET' })
      if (status !== 200 || body.app !== 'control-room' || typeof body.claimed !== 'boolean') {
        throw new SyncError('no-server', 'There is no sync server at this address.')
      }
      if (typeof body.protocol !== 'number' || body.protocol > PROTOCOL) {
        throw new SyncError('update-needed', 'The sync server is newer than this app. Reload to update.')
      }
      return { claimed: body.claimed }
    },

    async claim(token) {
      const { status, body } = await call('/api/sync/claim', { method: 'POST', headers: authed(token) })
      if (status === 403 && body.error === 'wrong-key') {
        throw new SyncError('rejected', 'This is not the sync key the server was set up with.')
      }
      if ((status !== 200 && status !== 201) || typeof body.vault !== 'string' || !isCount(body.seq)) throw unexpected()
      return { vault: body.vault, seq: body.seq }
    },

    async pull(token, since) {
      const { status, body } = await call(`/api/sync/changes?since=${since}`, { method: 'GET', headers: authed(token) })
      if (status !== 200 || typeof body.vault !== 'string' || !isCount(body.seq) || typeof body.more !== 'boolean') throw unexpected()
      if (!Array.isArray(body.changes)) throw unexpected()
      const changes: PulledChange[] = []
      let last = since
      for (const c of body.changes as unknown[]) {
        // Changes must move strictly forward, or a faulty server could keep a device pulling forever.
        if (!isObject(c) || typeof c.id !== 'string' || typeof c.blob !== 'string' || !isCount(c.seq) || c.seq <= last) throw unexpected()
        changes.push({ id: c.id, blob: c.blob, seq: c.seq })
        last = c.seq
      }
      if (body.more && changes.length === 0) throw unexpected()
      return { vault: body.vault, seq: body.seq, more: body.more, changes }
    },

    async push(token, baseSeq, changes) {
      const { status, body } = await call('/api/sync/push', {
        method: 'POST',
        headers: authed(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ base: baseSeq, changes }),
      })
      if (status === 409) throw new SyncError('stale', 'Another device synced first.')
      if (status !== 200 || typeof body.vault !== 'string' || !isCount(body.seq) || body.seq <= baseSeq) throw unexpected()
      return { vault: body.vault, seq: body.seq }
    },
  }
}
