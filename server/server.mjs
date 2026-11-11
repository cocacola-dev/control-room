#!/usr/bin/env node
/**
 * Control Room server. One small Node program, no dependencies.
 *
 * It does two jobs:
 *   1. Serves the built app (dist/) with strict security headers.
 *   2. Stores sync data: one opaque encrypted blob per record, handed back in order.
 *
 * What it cannot do: read your data. Records are encrypted in the browser with a key this
 * program never receives. It sees random record ids, blob sizes and when requests arrive.
 *
 * Who can reach it: it listens on 127.0.0.1 only, so nothing outside this computer can connect
 * directly. Your other devices come in through `tailscale serve`, which adds HTTPS and admits
 * only devices signed in to your own tailnet. Never publish it with `tailscale funnel`.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

/** Bumped when the wire format changes in a way older apps cannot follow. */
export const PROTOCOL = 1

export const LIMITS = {
  /** Largest request body accepted. */
  bodyBytes: 8 * 1024 * 1024,
  /** Largest single encrypted record, in base64 characters (about 1 MB of ciphertext). */
  blobChars: 1_400_000,
  /** Most records in one push. */
  batch: 500,
  /** Most records the vault will hold. */
  records: 500_000,
  /** Most records and characters returned by one pull. */
  pageRecords: 500,
  pageChars: 4 * 1024 * 1024,
}

const ID = /^[A-Za-z0-9_-]{1,64}$/
const BLOB = /^[A-Za-z0-9+/]+={0,2}$/
const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/

class HttpError extends Error {
  /** @param {number} status @param {string} code */
  constructor(status, code) {
    super(code)
    this.status = status
    this.code = code
  }
}

/* ---------- Storage ---------- */

/**
 * The vault: an append-only log on disk plus an index in memory.
 *
 * Line 1 is a header (vault id and a hash of the access token). Every later line is one stored
 * version of one record: {"s": sequence number, "i": record id, "b": encrypted blob}. Only the
 * newest version of each record is kept in memory and served. Appending is crash-safe: a line is
 * either fully on disk or ignored on the next start.
 */
export class Vault {
  /** @param {string} dir */
  constructor(dir) {
    this.dir = dir
    this.file = path.join(dir, 'vault.jsonl')
    /** @type {string | null} */
    this.id = null
    /** @type {Buffer | null} SHA-256 of the access token. The token itself is never stored. */
    this.auth = null
    this.created = ''
    this.seq = 0
    /** @type {Map<string, { seq: number, blob: string }>} */
    this.records = new Map()
    this.lines = 0
    /** @type {number | null} */
    this.fd = null
    /** @type {Array<{ id: string, seq: number, blob: string }> | null} */
    this.sorted = null
    this.broken = false
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    this.load()
  }

  get claimed() {
    return this.auth !== null
  }

  header() {
    return { app: 'control-room', protocol: PROTOCOL, vault: this.id, auth: this.auth?.toString('hex'), created: this.created }
  }

  load() {
    let text
    try {
      text = fs.readFileSync(this.file, 'utf8')
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return
      throw err
    }
    const lines = text.split('\n')
    // After a clean write the last piece is ''. Otherwise it is a line cut short by a crash: drop it.
    const cutShort = lines.pop() !== ''
    if (lines.length === 0) {
      fs.unlinkSync(this.file)
      return
    }
    lines.forEach((line, index) => {
      const where = `${this.file} line ${index + 1}`
      let row
      try {
        row = JSON.parse(line)
      } catch {
        throw new Error(`${where} is damaged. Restore the file from a backup, or move it away to start empty.`)
      }
      if (index === 0) {
        if (row?.app !== 'control-room' || typeof row.vault !== 'string' || !/^[0-9a-f]{64}$/.test(row.auth ?? '')) {
          throw new Error(`${where} is not a Control Room vault header.`)
        }
        if (row.protocol > PROTOCOL) throw new Error(`${this.file} was written by a newer server. Update this one.`)
        this.id = row.vault
        this.auth = Buffer.from(row.auth, 'hex')
        this.created = String(row.created ?? '')
        return
      }
      if (!Number.isSafeInteger(row?.s) || row.s <= this.seq || !ID.test(row.i ?? '') || typeof row.b !== 'string') {
        throw new Error(`${where} is not a valid record.`)
      }
      this.records.set(row.i, { seq: row.s, blob: row.b })
      this.seq = row.s
    })
    this.lines = lines.length
    if (cutShort || this.wasteful()) this.compact()
    else this.fd = fs.openSync(this.file, 'a', 0o600)
  }

  /** True when superseded versions make up most of the log. */
  wasteful() {
    return this.lines > this.records.size * 2 + 1000
  }

  /** Records ordered by sequence number, oldest change first. */
  ordered() {
    if (!this.sorted) {
      this.sorted = Array.from(this.records, ([id, r]) => ({ id, seq: r.seq, blob: r.blob })).sort((a, b) => a.seq - b.seq)
    }
    return this.sorted
  }

  /** Rewrite the log with only the newest version of each record. Atomic: write a new file, then swap. */
  compact() {
    if (this.fd !== null) fs.closeSync(this.fd)
    this.fd = null
    const out = [JSON.stringify(this.header())]
    for (const r of this.ordered()) out.push(JSON.stringify({ s: r.seq, i: r.id, b: r.blob }))
    const tmp = `${this.file}.tmp`
    const fd = fs.openSync(tmp, 'w', 0o600)
    try {
      fs.writeSync(fd, out.join('\n') + '\n')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(tmp, this.file)
    this.lines = out.length
    this.fd = fs.openSync(this.file, 'a', 0o600)
  }

  /** First use: remember the hash of the token that will be allowed in from now on. */
  claim(/** @type {Buffer} */ authHash) {
    if (this.claimed) throw new Error('The vault is already claimed.')
    const id = randomBytes(16).toString('hex')
    const created = new Date().toISOString()
    const header = { app: 'control-room', protocol: PROTOCOL, vault: id, auth: authHash.toString('hex'), created }
    const fd = fs.openSync(this.file, 'wx', 0o600)
    try {
      fs.writeSync(fd, JSON.stringify(header) + '\n')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    this.id = id
    this.auth = authHash
    this.created = created
    this.lines = 1
    this.fd = fs.openSync(this.file, 'a', 0o600)
  }

  /**
   * Store new versions. Written and flushed to disk before memory is updated, so a failed write
   * leaves the vault exactly as it was.
   * @param {Array<{ id: string, blob: string }>} changes
   */
  push(changes) {
    if (this.broken || this.fd === null) throw new Error('Storage failed earlier. Restart the server.')
    let seq = this.seq
    const rows = changes.map((c) => ({ s: ++seq, i: c.id, b: c.blob }))
    try {
      fs.writeSync(this.fd, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
      fs.fsyncSync(this.fd)
    } catch (err) {
      this.broken = true
      throw err
    }
    for (const r of rows) this.records.set(r.i, { seq: r.s, blob: r.b })
    this.seq = seq
    this.lines += rows.length
    this.sorted = null
    if (this.wasteful()) this.compact()
    return this.seq
  }

  /** One page of records changed after `since`. */
  changesSince(/** @type {number} */ since) {
    const all = this.ordered()
    let lo = 0
    let hi = all.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (all[mid].seq > since) hi = mid
      else lo = mid + 1
    }
    const changes = []
    let chars = 0
    let i = lo
    for (; i < all.length && changes.length < LIMITS.pageRecords; i++) {
      if (changes.length > 0 && chars + all[i].blob.length > LIMITS.pageChars) break
      changes.push(all[i])
      chars += all[i].blob.length
    }
    return { changes, more: i < all.length }
  }

  close() {
    if (this.fd !== null) fs.closeSync(this.fd)
    this.fd = null
  }
}

/* ---------- Static files ---------- */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.txt'])

/**
 * The built app, held in memory. A request path is only ever looked up in this table, so nothing
 * a client sends is used to build a path on disk. That rules out path traversal by construction.
 */
class StaticSite {
  /** @param {string} dir */
  constructor(dir) {
    this.dir = dir
    /** @type {Map<string, { type: string, raw: Buffer, gzip: Buffer | null, etag: string, immutable: boolean }>} */
    this.files = new Map()
    this.csp = ''
    this.signature = ''
    this.checkedAt = 0
    this.refresh()
  }

  /** Every servable file in the build, with its size and modification time. */
  scan() {
    /** @type {Array<{ url: string, full: string, ext: string, immutable: boolean, mark: string }>} */
    const found = []
    const walk = (/** @type {string} */ dir, /** @type {string} */ prefix) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`)
        else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (!(ext in TYPES)) continue
          const stat = fs.statSync(full)
          found.push({ url: `${prefix}${entry.name}`, full, ext, immutable: prefix.startsWith('/assets/'), mark: `${stat.size}:${stat.mtimeMs}` })
        }
      }
    }
    walk(this.dir, '/')
    return found
  }

  /** Reload when anything in the build changed. Throws when there is no usable build. */
  refresh() {
    this.checkedAt = Date.now()
    let found
    try {
      found = this.scan()
    } catch {
      found = []
    }
    if (!found.some((f) => f.url === '/index.html')) throw new Error(`No build found in ${this.dir}. Run "npm run build" first.`)
    const signature = found
      .map((f) => `${f.url}:${f.mark}`)
      .sort()
      .join('|')
    if (signature === this.signature) return

    /** @type {typeof this.files} */
    const files = new Map()
    for (const f of found) {
      const raw = fs.readFileSync(f.full)
      files.set(f.url, {
        type: TYPES[/** @type {keyof typeof TYPES} */ (f.ext)],
        raw,
        gzip: COMPRESSIBLE.has(f.ext) && raw.length > 1024 ? gzipSync(raw) : null,
        etag: `W/"${createHash('sha256').update(raw).digest('base64url').slice(0, 22)}"`,
        immutable: f.immutable,
      })
    }

    const index = files.get('/index.html')
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(index?.raw.toString('utf8') ?? '')
    // Fail closed: a dev build has no policy, and serving the app without one would drop a safety net.
    if (!index || !csp) {
      throw new Error(`${path.join(this.dir, 'index.html')} carries no Content-Security-Policy. Run "npm run build" first.`)
    }
    files.set('/', index)
    this.files = files
    // `frame-ancestors` (no other page may embed the app) only takes effect in a header, so it is added here.
    this.csp = csp[1].includes('frame-ancestors') ? csp[1] : `${csp[1]}; frame-ancestors 'none'`
    this.signature = signature
  }

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {string} pathname */
  serve(req, res, pathname) {
    if (Date.now() - this.checkedAt > 1000) {
      try {
        this.refresh()
      } catch {
        // A rebuild is in progress. Keep serving the copy in memory.
      }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD')
      return sendText(res, 405, 'Method not allowed')
    }
    let file = this.files.get(pathname)
    if (!file) {
      // Single-page app: page addresses like /insights are handled by the app itself.
      const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1)
      if (lastSegment.includes('.')) return sendText(res, 404, 'Not found')
      file = this.files.get('/')
    }
    if (!file) return sendText(res, 404, 'Not found')

    res.setHeader('Content-Type', file.type)
    res.setHeader('ETag', file.etag)
    res.setHeader('Vary', 'Accept-Encoding')
    // Hashed assets never change. Everything else is revalidated so app updates arrive promptly.
    res.setHeader('Cache-Control', file.immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
    if (req.headers['if-none-match'] === file.etag) {
      res.statusCode = 304
      return res.end()
    }
    const gzip = file.gzip !== null && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))
    const body = gzip && file.gzip ? file.gzip : file.raw
    if (gzip) res.setHeader('Content-Encoding', 'gzip')
    res.setHeader('Content-Length', body.length)
    res.statusCode = 200
    res.end(req.method === 'HEAD' ? undefined : body)
  }
}

/* ---------- HTTP helpers ---------- */

/** @param {import('node:http').ServerResponse} res @param {number} status @param {unknown} body */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(text))
  res.end(text)
}

/** @param {import('node:http').ServerResponse} res @param {number} status @param {string} text */
function sendText(res, status, text) {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Length', Buffer.byteLength(text))
  res.end(text)
}

/**
 * Only answer to names this server is meant to be reached by. A web page elsewhere that tricks a
 * browser into calling 127.0.0.1 under its own domain name (DNS rebinding) is turned away here.
 * @param {string | undefined} host @param {string[]} extraHosts
 */
function hostAllowed(host, extraHosts) {
  if (typeof host !== 'string' || host === '') return false
  let name
  try {
    name = new URL(`http://${host}`).hostname.toLowerCase()
  } catch {
    return false
  }
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]' || name.endsWith('.ts.net') || extraHosts.includes(name)
}

/**
 * The API is for the app's own pages only. Browsers label each request with where it came from;
 * anything from another site is refused before it is looked at.
 * @param {import('node:http').IncomingMessage} req @param {string[]} extraHosts
 */
function fromOwnPages(req, extraHosts) {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string') return site === 'same-origin' || (site === 'none' && req.method === 'GET')
  const origin = req.headers.origin
  if (typeof origin !== 'string') return true // Not a browser. The access token still applies.
  try {
    return hostAllowed(new URL(origin).host, extraHosts)
  } catch {
    return false
  }
}

/** @param {import('node:http').IncomingMessage} req @returns {Buffer | null} SHA-256 of the presented token */
function presentedTokenHash(req) {
  const match = BEARER.exec(String(req.headers.authorization ?? ''))
  return match ? createHash('sha256').update(match[1]).digest() : null
}

/** @param {import('node:http').IncomingMessage} req @returns {Promise<unknown>} */
function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) return reject(new HttpError(415, 'json-required'))
    if (Number(req.headers['content-length']) > LIMITS.bodyBytes) return reject(new HttpError(413, 'too-large'))
    /** @type {Buffer[]} */
    const chunks = []
    let size = 0
    let rejected = false
    req.on('data', (chunk) => {
      if (rejected) return
      size += chunk.length
      if (size > LIMITS.bodyBytes) {
        rejected = true
        chunks.length = 0
        reject(new HttpError(413, 'too-large'))
      } else chunks.push(chunk)
    })
    req.on('end', () => {
      if (rejected) return
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new HttpError(400, 'bad-json'))
      }
    })
    req.on('error', () => reject(new HttpError(400, 'aborted')))
  })
}

/** @param {unknown} body @returns {body is { base: number, changes: Array<{ id: string, blob: string }> }} */
function validPush(body) {
  if (typeof body !== 'object' || body === null) return false
  const { base, changes } = /** @type {{ base?: unknown, changes?: unknown }} */ (body)
  if (!Number.isSafeInteger(base) || /** @type {number} */ (base) < 0) return false
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > LIMITS.batch) return false
  return changes.every(
    (c) =>
      typeof c === 'object' &&
      c !== null &&
      typeof c.id === 'string' &&
      ID.test(c.id) &&
      typeof c.blob === 'string' &&
      c.blob.length <= LIMITS.blobChars &&
      BLOB.test(c.blob),
  )
}

/* ---------- The app ---------- */

/**
 * @param {{ distDir: string, dataDir: string, extraHosts?: string[], log?: (line: string) => void }} options
 */
export function createApp({ distDir, dataDir, extraHosts = [], log = () => {} }) {
  const site = new StaticSite(distDir)
  const vault = new Vault(dataDir)

  /** @param {import('node:http').IncomingMessage} req */
  function authorized(req) {
    const hash = presentedTokenHash(req)
    return hash !== null && vault.auth !== null && timingSafeEqual(hash, vault.auth)
  }

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res @param {URL} url */
  async function api(req, res, url) {
    res.setHeader('Cache-Control', 'no-store')
    if (!fromOwnPages(req, extraHosts)) throw new HttpError(403, 'cross-site')

    switch (`${req.method} ${url.pathname}`) {
      // Tells the app whether a server is here and whether sync was already set up. No secrets.
      case 'GET /api/sync/status':
        return sendJson(res, 200, { app: 'control-room', protocol: PROTOCOL, claimed: vault.claimed })

      // First device: the vault adopts the presented token. Later devices: confirms their token matches.
      case 'POST /api/sync/claim': {
        const hash = presentedTokenHash(req)
        if (!hash) throw new HttpError(401, 'unauthorized')
        if (!vault.claimed) {
          vault.claim(hash)
          log('Sync was set up: the first device registered its key.')
          return sendJson(res, 201, { vault: vault.id, seq: vault.seq })
        }
        if (!vault.auth || !timingSafeEqual(hash, vault.auth)) {
          log('A device tried to join with a sync key that is not yours. It was refused.')
          throw new HttpError(403, 'wrong-key')
        }
        log('A device joined with your sync key.')
        return sendJson(res, 200, { vault: vault.id, seq: vault.seq })
      }

      case 'GET /api/sync/changes': {
        if (!authorized(req)) throw new HttpError(401, 'unauthorized')
        const since = Number(url.searchParams.get('since') ?? '0')
        if (!Number.isSafeInteger(since) || since < 0) throw new HttpError(400, 'bad-since')
        const { changes, more } = vault.changesSince(since)
        return sendJson(res, 200, { vault: vault.id, seq: vault.seq, more, changes })
      }

      case 'POST /api/sync/push': {
        if (!authorized(req)) throw new HttpError(401, 'unauthorized')
        const body = await readJson(req)
        if (!validPush(body)) throw new HttpError(400, 'bad-push')
        // A device may only add changes on top of everything it has already seen. If another device
        // got in first, this one is told to fetch those changes and try again. That keeps one
        // agreed order of events without the server ever looking inside a record.
        if (body.base !== vault.seq) return sendJson(res, 409, { error: 'stale', seq: vault.seq })
        const added = body.changes.filter((c) => !vault.records.has(c.id)).length
        if (vault.records.size + added > LIMITS.records) throw new HttpError(507, 'vault-full')
        return sendJson(res, 200, { vault: vault.id, seq: vault.push(body.changes) })
      }

      default:
        throw new HttpError(404, 'not-found')
    }
  }

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  async function handle(req, res) {
    res.setHeader('Content-Security-Policy', site.csp)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')

    if (!hostAllowed(req.headers.host, extraHosts)) throw new HttpError(421, 'unknown-host')
    let url
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      throw new HttpError(400, 'bad-request')
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return api(req, res, url)
    return site.serve(req, res, url.pathname)
  }

  return {
    vault,
    /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
    listener(req, res) {
      handle(req, res).catch((err) => {
        if (res.headersSent) return res.destroy()
        // The request body may be unread. Close the connection rather than reuse it.
        res.setHeader('Connection', 'close')
        res.setHeader('Cache-Control', 'no-store')
        if (err instanceof HttpError) return sendJson(res, err.status, { error: err.code })
        console.error('Request failed:', err instanceof Error ? err.message : err)
        sendJson(res, 500, { error: 'server-error' })
      })
    },
    close() {
      vault.close()
    },
  }
}

/* ---------- Start ---------- */

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const port = Number(process.env.PORT ?? 8787)
  const host = process.env.HOST ?? '127.0.0.1'
  const distDir = process.env.APP_DIST ?? path.join(here, '..', 'dist')
  const dataDir = process.env.SYNC_DATA_DIR ?? path.join(os.homedir(), '.control-room', 'sync')
  const extraHosts = (process.env.SYNC_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)

  let app
  try {
    const stamp = () => new Date().toLocaleString('sv-SE')
    app = createApp({ distDir, dataDir, extraHosts, log: (line) => console.log(`  ${stamp()}  ${line}`) })
  } catch (err) {
    console.error(`Cannot start: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }

  const server = createServer(app.listener)
  server.headersTimeout = 15_000
  server.requestTimeout = 60_000
  server.keepAliveTimeout = 5_000
  server.maxHeadersCount = 64
  server.on('error', (err) => {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code
    console.error(code === 'EADDRINUSE' ? `Port ${port} is already in use. Is the server already running?` : `Server error: ${err.message}`)
    process.exit(1)
  })
  server.listen(port, host, () => {
    const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1'
    console.log(
      [
        '',
        'Control Room is running.',
        '',
        `  On this computer:   http://localhost:${port}`,
        `  Other devices:      run "tailscale serve --bg ${port}" and open the https://… address it prints`,
        `  Sync data:          ${app.vault.file} (encrypted, ${app.vault.claimed ? `${app.vault.records.size} records` : 'not set up yet'})`,
        '',
        loopback
          ? '  Only this computer can connect directly. Press Ctrl+C to stop.'
          : `  WARNING: listening on ${host}. Anything that can reach this address can reach the server.`,
        '',
      ].join('\n'),
    )
  })

  const stop = () => {
    server.close(() => {
      app.close()
      process.exit(0)
    })
    server.closeAllConnections()
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main()
