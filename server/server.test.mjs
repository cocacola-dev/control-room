/**
 * Tests for the sync server, run against a real HTTP listener on a random local port.
 * Run with: npm test
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { LIMITS, createApp } from './server.mjs'

const CSP = "default-src 'self'; script-src 'self'; connect-src 'self'"
const TOKEN_A = 'A'.repeat(43)
const TOKEN_B = 'B'.repeat(43)
const BLOB = Buffer.from('not really ciphertext').toString('base64')

function makeDist(dir) {
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    `<!doctype html><html><head><meta charset="UTF-8" />\n<meta http-equiv="Content-Security-Policy" content="${CSP}" /></head><body>app</body></html>`,
  )
  fs.writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), `console.log("${'x'.repeat(2000)}")`)
  fs.writeFileSync(path.join(dir, 'sw.js'), '// service worker')
  fs.writeFileSync(path.join(dir, '.secret'), 'hidden file')
  fs.writeFileSync(path.join(dir, 'notes.exe'), 'unknown type')
}

/** Start a server on a random port with fresh temp folders. */
async function start(dirs) {
  const root = dirs?.root ?? fs.mkdtempSync(path.join(os.tmpdir(), 'control-room-test-'))
  const distDir = path.join(root, 'dist')
  const dataDir = path.join(root, 'data')
  if (!dirs) makeDist(distDir)
  const app = createApp({ distDir, dataDir })
  const server = http.createServer(app.listener)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  /** Raw request, so tests control every header (including Host). */
  function request(method, pathname, { headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method,
          path: pathname,
          headers: {
            ...(payload !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}),
            ...(payload !== undefined ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
            ...headers,
          },
        },
        (res) => {
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => {
            const raw = Buffer.concat(chunks)
            let json
            try {
              json = JSON.parse(raw.toString('utf8'))
            } catch {
              json = undefined
            }
            resolve({ status: res.statusCode, headers: res.headers, raw, text: raw.toString('utf8'), json })
          })
        },
      )
      req.on('error', reject)
      req.end(payload)
    })
  }

  const auth = (token) => ({ Authorization: `Bearer ${token}` })
  return {
    root,
    distDir,
    dataDir,
    app,
    port,
    request,
    auth,
    async stop() {
      await new Promise((resolve) => server.close(resolve))
      server.closeAllConnections()
      app.close()
    },
  }
}

describe('static files', () => {
  let s
  before(async () => {
    s = await start()
  })
  after(async () => {
    await s.stop()
    fs.rmSync(s.root, { recursive: true, force: true })
  })

  test('serves the app with security headers', async () => {
    const res = await s.request('GET', '/')
    assert.equal(res.status, 200)
    assert.match(res.headers['content-type'], /^text\/html/)
    assert.equal(res.headers['content-security-policy'], `${CSP}; frame-ancestors 'none'`)
    assert.equal(res.headers['x-content-type-options'], 'nosniff')
    assert.equal(res.headers['x-frame-options'], 'DENY')
    assert.equal(res.headers['referrer-policy'], 'no-referrer')
    assert.equal(res.headers['cache-control'], 'no-cache')
    assert.match(res.text, /app/)
  })

  test('page addresses fall back to the app, missing files do not', async () => {
    assert.equal((await s.request('GET', '/insights')).status, 200)
    assert.match((await s.request('GET', '/insights')).text, /app/)
    assert.equal((await s.request('GET', '/missing.js')).status, 404)
  })

  test('hashed assets are cached for good and compressed on request', async () => {
    const plain = await s.request('GET', '/assets/app-abc123.js')
    assert.equal(plain.status, 200)
    assert.match(plain.headers['cache-control'], /immutable/)
    assert.equal(plain.headers['content-encoding'], undefined)
    const gz = await s.request('GET', '/assets/app-abc123.js', { headers: { 'Accept-Encoding': 'gzip, br' } })
    assert.equal(gz.headers['content-encoding'], 'gzip')
    assert.ok(gz.raw.length < plain.raw.length)
    const cached = await s.request('GET', '/assets/app-abc123.js', { headers: { 'If-None-Match': plain.headers.etag } })
    assert.equal(cached.status, 304)
  })

  test('never serves anything outside the build, hidden files or unknown types', async () => {
    fs.writeFileSync(path.join(s.root, 'outside.txt'), 'TOP SECRET')
    for (const p of [
      '/../outside.txt',
      '/%2e%2e/outside.txt',
      '/..%2foutside.txt',
      '/assets/../../outside.txt',
      '/assets/%2e%2e/%2e%2e/outside.txt',
      '//outside.txt',
      '/.secret',
      '/notes.exe',
      '/../data/vault.jsonl',
    ]) {
      const res = await s.request('GET', p)
      assert.ok(!res.text.includes('TOP SECRET') && !res.text.includes('hidden file') && !res.text.includes('unknown type'), `${p} leaked a file`)
      assert.ok(res.status === 404 || res.text.includes('app'), `${p} answered ${res.status}`)
    }
  })

  test('picks up a new build without a restart', async () => {
    fs.writeFileSync(path.join(s.distDir, 'assets', 'late-def456.js'), 'console.log("written after index.html")')
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const res = await s.request('GET', '/assets/late-def456.js')
    assert.equal(res.status, 200)
    assert.match(res.text, /written after/)
    // A build that is half written (no index.html yet) keeps the previous copy in service.
    fs.renameSync(path.join(s.distDir, 'index.html'), path.join(s.distDir, 'index.html.bak'))
    await new Promise((resolve) => setTimeout(resolve, 1100))
    assert.equal((await s.request('GET', '/')).status, 200)
    fs.renameSync(path.join(s.distDir, 'index.html.bak'), path.join(s.distDir, 'index.html'))
  })

  test('only reads are allowed on pages', async () => {
    const res = await s.request('POST', '/', { body: 'x' })
    assert.equal(res.status, 405)
    assert.equal((await s.request('HEAD', '/')).raw.length, 0)
  })

  test('refuses names it is not meant to be reached by', async () => {
    assert.equal((await s.request('GET', '/', { headers: { Host: 'evil.example' } })).status, 421)
    assert.equal((await s.request('GET', '/api/sync/status', { headers: { Host: 'evil.example:8787' } })).status, 421)
    assert.equal((await s.request('GET', '/', { headers: { Host: 'my-mac.tail1234.ts.net' } })).status, 200)
    assert.equal((await s.request('GET', '/', { headers: { Host: 'localhost:8787' } })).status, 200)
    assert.equal((await s.request('GET', '/', { headers: { Host: 'evil.example.ts.net.attacker.com' } })).status, 421)
  })
})

describe('sync API', () => {
  let s
  before(async () => {
    s = await start()
  })
  after(async () => {
    await s.stop()
    fs.rmSync(s.root, { recursive: true, force: true })
  })

  test('status needs no key and reveals only whether sync is set up', async () => {
    const res = await s.request('GET', '/api/sync/status')
    assert.equal(res.status, 200)
    assert.deepEqual(res.json, { app: 'control-room', protocol: 1, claimed: false })
    assert.equal(res.headers['cache-control'], 'no-store')
  })

  test('nothing works before the vault is claimed', async () => {
    assert.equal((await s.request('GET', '/api/sync/changes?since=0', { headers: s.auth(TOKEN_A) })).status, 401)
    assert.equal((await s.request('POST', '/api/sync/push', { headers: s.auth(TOKEN_A), body: { base: 0, changes: [{ id: 'a', blob: BLOB }] } })).status, 401)
  })

  test('the first device claims the vault; a different key is refused from then on', async () => {
    assert.equal((await s.request('POST', '/api/sync/claim')).status, 401)
    assert.equal((await s.request('POST', '/api/sync/claim', { headers: { Authorization: 'Bearer short' } })).status, 401)
    const first = await s.request('POST', '/api/sync/claim', { headers: s.auth(TOKEN_A) })
    assert.equal(first.status, 201)
    assert.match(first.json.vault, /^[0-9a-f]{32}$/)
    const again = await s.request('POST', '/api/sync/claim', { headers: s.auth(TOKEN_A) })
    assert.equal(again.status, 200)
    assert.equal(again.json.vault, first.json.vault)
    const other = await s.request('POST', '/api/sync/claim', { headers: s.auth(TOKEN_B) })
    assert.equal(other.status, 403)
    assert.equal(other.json.error, 'wrong-key')
    assert.equal((await s.request('GET', '/api/sync/status')).json.claimed, true)
  })

  test('the token itself is never written to disk, and the file is private', () => {
    const file = path.join(s.dataDir, 'vault.jsonl')
    assert.ok(!fs.readFileSync(file, 'utf8').includes(TOKEN_A))
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    assert.equal(fs.statSync(s.dataDir).mode & 0o077, 0)
  })

  test('reading and writing need the right key', async () => {
    for (const headers of [{}, s.auth(TOKEN_B), { Authorization: `Basic ${TOKEN_A}` }, { Authorization: `Bearer ${TOKEN_A}x` }]) {
      assert.equal((await s.request('GET', '/api/sync/changes?since=0', { headers })).status, 401)
      assert.equal((await s.request('POST', '/api/sync/push', { headers, body: { base: 0, changes: [{ id: 'a', blob: BLOB }] } })).status, 401)
    }
  })

  test('push stores records in order; pull returns only what is newer', async () => {
    const push = await s.request('POST', '/api/sync/push', {
      headers: s.auth(TOKEN_A),
      body: { base: 0, changes: [{ id: 'rec-1', blob: BLOB }, { id: 'rec-2', blob: BLOB }] },
    })
    assert.equal(push.status, 200)
    assert.equal(push.json.seq, 2)

    const all = await s.request('GET', '/api/sync/changes?since=0', { headers: s.auth(TOKEN_A) })
    assert.deepEqual(all.json.changes, [{ id: 'rec-1', seq: 1, blob: BLOB }, { id: 'rec-2', seq: 2, blob: BLOB }])
    assert.equal(all.json.seq, 2)
    assert.equal(all.json.more, false)

    // A new version of rec-1 replaces the old one and moves to the end of the order.
    const newer = Buffer.from('second version').toString('base64')
    const push2 = await s.request('POST', '/api/sync/push', { headers: s.auth(TOKEN_A), body: { base: 2, changes: [{ id: 'rec-1', blob: newer }] } })
    assert.equal(push2.json.seq, 3)
    const since2 = await s.request('GET', '/api/sync/changes?since=2', { headers: s.auth(TOKEN_A) })
    assert.deepEqual(since2.json.changes, [{ id: 'rec-1', seq: 3, blob: newer }])
    const fromStart = await s.request('GET', '/api/sync/changes?since=0', { headers: s.auth(TOKEN_A) })
    assert.deepEqual(fromStart.json.changes.map((c) => c.id), ['rec-2', 'rec-1'])
    assert.deepEqual((await s.request('GET', '/api/sync/changes?since=3', { headers: s.auth(TOKEN_A) })).json.changes, [])
  })

  test('a device that has not seen the latest changes is told to pull first', async () => {
    const stale = await s.request('POST', '/api/sync/push', { headers: s.auth(TOKEN_A), body: { base: 1, changes: [{ id: 'rec-9', blob: BLOB }] } })
    assert.equal(stale.status, 409)
    assert.deepEqual(stale.json, { error: 'stale', seq: 3 })
    const ahead = await s.request('POST', '/api/sync/push', { headers: s.auth(TOKEN_A), body: { base: 99, changes: [{ id: 'rec-9', blob: BLOB }] } })
    assert.equal(ahead.status, 409)
    assert.equal((await s.request('GET', '/api/sync/changes?since=3', { headers: s.auth(TOKEN_A) })).json.changes.length, 0)
  })

  test('malformed requests are rejected and change nothing', async () => {
    const post = (body, headers = {}) => s.request('POST', '/api/sync/push', { headers: { ...s.auth(TOKEN_A), ...headers }, body })
    const bad = [
      { base: 3, changes: [] },
      { base: 3, changes: [{ id: '../etc/passwd', blob: BLOB }] },
      { base: 3, changes: [{ id: 'a b', blob: BLOB }] },
      { base: 3, changes: [{ id: 'x'.repeat(65), blob: BLOB }] },
      { base: 3, changes: [{ id: 'ok', blob: 'not base64 <script>' }] },
      { base: 3, changes: [{ id: 'ok', blob: '' }] },
      { base: 3, changes: [{ id: 'ok' }] },
      { base: 3, changes: [null] },
      { base: 3, changes: 'nope' },
      { base: -1, changes: [{ id: 'ok', blob: BLOB }] },
      { base: '3', changes: [{ id: 'ok', blob: BLOB }] },
      { base: 3, changes: Array.from({ length: LIMITS.batch + 1 }, (_, i) => ({ id: `r${i}`, blob: BLOB })) },
      [],
      null,
    ]
    for (const body of bad) assert.equal((await post(body)).status, 400, JSON.stringify(body).slice(0, 80))
    assert.equal((await post('{"base":3,', { 'Content-Type': 'application/json' })).status, 400)
    assert.equal((await post('base=3', { 'Content-Type': 'text/plain' })).status, 415)
    assert.equal((await s.request('GET', '/api/sync/changes?since=abc', { headers: s.auth(TOKEN_A) })).status, 400)
    assert.equal((await s.request('GET', '/api/sync/changes?since=-5', { headers: s.auth(TOKEN_A) })).status, 400)
    assert.equal((await s.request('GET', '/api/unknown')).status, 404)
    assert.equal((await s.request('DELETE', '/api/sync/changes', { headers: s.auth(TOKEN_A) })).status, 404)
    assert.equal(s.app.vault.seq, 3)
  })

  test('oversized bodies are refused', async () => {
    const big = Buffer.alloc(LIMITS.bodyBytes + 1024, 0x20)
    const res = await s
      .request('POST', '/api/sync/push', { headers: { ...s.auth(TOKEN_A), 'Content-Type': 'application/json' }, body: big })
      .catch((err) => ({ status: err.code })) // the server may hang up before the upload completes
    assert.ok(res.status === 413 || res.status === 'ECONNRESET' || res.status === 'EPIPE', `got ${res.status}`)
    assert.equal(s.app.vault.seq, 3)
  })

  test('requests from other websites are refused, even with the right key', async () => {
    const body = { base: 3, changes: [{ id: 'csrf', blob: BLOB }] }
    const crossSite = await s.request('POST', '/api/sync/push', { headers: { ...s.auth(TOKEN_A), 'Sec-Fetch-Site': 'cross-site' }, body })
    assert.equal(crossSite.status, 403)
    const sameSite = await s.request('POST', '/api/sync/push', { headers: { ...s.auth(TOKEN_A), 'Sec-Fetch-Site': 'same-site' }, body })
    assert.equal(sameSite.status, 403)
    const foreignOrigin = await s.request('POST', '/api/sync/push', { headers: { ...s.auth(TOKEN_A), Origin: 'https://evil.example' }, body })
    assert.equal(foreignOrigin.status, 403)
    const read = await s.request('GET', '/api/sync/changes?since=0', { headers: { ...s.auth(TOKEN_A), 'Sec-Fetch-Site': 'cross-site' } })
    assert.equal(read.status, 403)
    assert.equal(s.app.vault.seq, 3)
    // The app's own pages are let through.
    const own = await s.request('GET', '/api/sync/changes?since=3', { headers: { ...s.auth(TOKEN_A), 'Sec-Fetch-Site': 'same-origin' } })
    assert.equal(own.status, 200)
  })

  test('large result sets are returned in pages', async () => {
    const total = LIMITS.pageRecords + 20
    let base = s.app.vault.seq
    for (let i = 0; i < total; i += LIMITS.batch) {
      const changes = Array.from({ length: Math.min(LIMITS.batch, total - i) }, (_, j) => ({ id: `bulk-${i + j}`, blob: BLOB }))
      base = (await s.request('POST', '/api/sync/push', { headers: s.auth(TOKEN_A), body: { base, changes } })).json.seq
    }
    const first = await s.request('GET', '/api/sync/changes?since=3', { headers: s.auth(TOKEN_A) })
    assert.equal(first.json.changes.length, LIMITS.pageRecords)
    assert.equal(first.json.more, true)
    const last = first.json.changes.at(-1).seq
    const second = await s.request('GET', `/api/sync/changes?since=${last}`, { headers: s.auth(TOKEN_A) })
    assert.equal(second.json.changes.length, 20)
    assert.equal(second.json.more, false)
  })
})

describe('storage on disk', () => {
  test('data survives a restart', async () => {
    const a = await start()
    await a.request('POST', '/api/sync/claim', { headers: a.auth(TOKEN_A) })
    await a.request('POST', '/api/sync/push', { headers: a.auth(TOKEN_A), body: { base: 0, changes: [{ id: 'keep', blob: BLOB }] } })
    const vault = a.app.vault.id
    await a.stop()

    const b = await start(a)
    assert.equal(b.app.vault.id, vault)
    assert.equal(b.app.vault.seq, 1)
    assert.equal((await b.request('GET', '/api/sync/changes?since=0', { headers: b.auth(TOKEN_B) })).status, 401)
    const pulled = await b.request('GET', '/api/sync/changes?since=0', { headers: b.auth(TOKEN_A) })
    assert.deepEqual(pulled.json.changes, [{ id: 'keep', seq: 1, blob: BLOB }])
    await b.stop()
    fs.rmSync(a.root, { recursive: true, force: true })
  })

  test('a line cut short by a crash is dropped; the rest is kept', async () => {
    const a = await start()
    await a.request('POST', '/api/sync/claim', { headers: a.auth(TOKEN_A) })
    await a.request('POST', '/api/sync/push', { headers: a.auth(TOKEN_A), body: { base: 0, changes: [{ id: 'whole', blob: BLOB }] } })
    await a.stop()
    fs.appendFileSync(path.join(a.dataDir, 'vault.jsonl'), '{"s":2,"i":"half","b":"AAAA')

    const b = await start(a)
    assert.equal(b.app.vault.seq, 1)
    assert.deepEqual([...b.app.vault.records.keys()], ['whole'])
    // The file was repaired, so new writes land on a clean line.
    const push = await b.request('POST', '/api/sync/push', { headers: b.auth(TOKEN_A), body: { base: 1, changes: [{ id: 'next', blob: BLOB }] } })
    assert.equal(push.json.seq, 2)
    await b.stop()
    const c = await start(a)
    assert.deepEqual([...c.app.vault.records.keys()], ['whole', 'next'])
    await c.stop()
    fs.rmSync(a.root, { recursive: true, force: true })
  })

  test('a damaged file stops the server instead of being silently discarded', async () => {
    const a = await start()
    await a.request('POST', '/api/sync/claim', { headers: a.auth(TOKEN_A) })
    await a.request('POST', '/api/sync/push', { headers: a.auth(TOKEN_A), body: { base: 0, changes: [{ id: 'one', blob: BLOB }, { id: 'two', blob: BLOB }] } })
    await a.stop()
    const file = path.join(a.dataDir, 'vault.jsonl')
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    lines[1] = lines[1].slice(0, 10)
    fs.writeFileSync(file, lines.join('\n'))
    assert.throws(() => createApp({ distDir: a.distDir, dataDir: a.dataDir }), /damaged/)
    fs.rmSync(a.root, { recursive: true, force: true })
  })

  test('old versions are cleaned out of the log without losing the newest', async () => {
    const a = await start()
    await a.request('POST', '/api/sync/claim', { headers: a.auth(TOKEN_A) })
    let base = 0
    for (let round = 0; round < 6; round++) {
      const changes = Array.from({ length: 400 }, (_, i) => ({ id: `r${i}`, blob: Buffer.from(`round ${round}`).toString('base64') }))
      base = (await a.request('POST', '/api/sync/push', { headers: a.auth(TOKEN_A), body: { base, changes } })).json.seq
    }
    assert.equal(base, 2400)
    const lineCount = fs.readFileSync(path.join(a.dataDir, 'vault.jsonl'), 'utf8').trimEnd().split('\n').length
    assert.ok(lineCount < 2401, `log was not compacted (${lineCount} lines)`)
    await a.stop()
    const b = await start(a)
    assert.equal(b.app.vault.records.size, 400)
    assert.equal(b.app.vault.seq, 2400)
    const pulled = await b.request('GET', '/api/sync/changes?since=0', { headers: b.auth(TOKEN_A) })
    assert.ok(pulled.json.changes.every((c) => c.blob === Buffer.from('round 5').toString('base64')))
    await b.stop()
    fs.rmSync(a.root, { recursive: true, force: true })
  })

  test('refuses to start without a built app or without its security policy', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'control-room-test-'))
    assert.throws(() => createApp({ distDir: path.join(root, 'dist'), dataDir: path.join(root, 'data') }), /npm run build/)
    fs.mkdirSync(path.join(root, 'dist'))
    fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<!doctype html><html><head></head><body>dev build</body></html>')
    assert.throws(() => createApp({ distDir: path.join(root, 'dist'), dataDir: path.join(root, 'data') }), /Content-Security-Policy/)
    fs.rmSync(root, { recursive: true, force: true })
  })
})
