/**
 * Tests for sync: the cryptography, the checks on incoming records, and whole "devices"
 * (real database code on an in-memory IndexedDB) syncing through the real server.
 * Run with: npm test
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { ControlRoomDB } from '@/db/db'
import { SyncError, createApi } from '@/sync/api'
import { SyncKeyError, deriveKeys, formatSyncKey, generateSyncKey, open, parseSyncKey, seal } from '@/sync/codec'
import { SyncEngine } from '@/sync/engine'
import { readEnvelope, sanitizeRecord } from '@/sync/records'
import { createApp } from '../server/server.mjs'

/* ---------- Helpers ---------- */

const CSP = "default-src 'self'; script-src 'self'; connect-src 'self'"
const T0 = Date.parse('2026-11-01T10:00:00.000Z')
const MIN = 60_000
const iso = (ms) => new Date(ms).toISOString()
const uid = () => crypto.randomUUID()
const cleanups = []

after(async () => {
  for (const fn of cleanups.reverse()) await fn()
})

async function startServer(root = fs.mkdtempSync(path.join(os.tmpdir(), 'control-room-sync-'))) {
  const distDir = path.join(root, 'dist')
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true })
    fs.writeFileSync(path.join(distDir, 'index.html'), `<meta charset="UTF-8" />\n<meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
  }
  const dataDir = path.join(root, 'data')
  const app = createApp({ distDir, dataDir })
  const server = http.createServer(app.listener)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    await new Promise((resolve) => server.close(resolve))
    server.closeAllConnections()
    app.close()
  }
  cleanups.push(async () => {
    await stop()
    fs.rmSync(root, { recursive: true, force: true })
  })
  return { url: `http://127.0.0.1:${server.address().port}`, app, root, dataDir, vaultFile: path.join(dataDir, 'vault.jsonl'), stop }
}

/** One "device": its own database, syncing with the server at `url`. */
function device(url, api = createApi(url)) {
  const db = new ControlRoomDB(`device-${uid()}`)
  cleanups.push(() => db.close())
  return { db, engine: new SyncEngine(db, api) }
}

const base = (ms = T0) => ({ id: uid(), createdAt: iso(ms), updatedAt: iso(ms), deletedAt: null })
const makeProject = (over = {}) => ({ ...base(), name: 'Garden', color: '#22c55e', archived: false, ...over })
const makeItem = (over = {}) => ({ ...base(), type: 'todo', title: 'Water the plants', notes: '', projectId: null, status: 'open', doneAt: null, dueDate: null, ...over })
const makeSession = (over = {}) => ({
  ...base(),
  kind: 'focus',
  source: 'timer',
  projectId: null,
  itemId: null,
  startedAt: iso(T0),
  endedAt: iso(T0 + 25 * MIN),
  plannedMinutes: 25,
  pausedMs: 0,
  pausedAt: null,
  completed: true,
  note: '',
  ...over,
})

const byId = (a, b) => (a.id < b.id ? -1 : 1)
async function contents(db) {
  return {
    projects: (await db.projects.toArray()).sort(byId),
    items: (await db.items.toArray()).sort(byId),
    sessions: (await db.sessions.toArray()).sort(byId),
  }
}
const assertSame = async (a, b) => assert.deepEqual(await contents(a.db), await contents(b.db))
const isSyncError = (kind) => (err) => err instanceof SyncError && err.kind === kind

/** Two devices already paired and in step. */
async function pair() {
  const server = await startServer()
  const a = device(server.url)
  const b = device(server.url)
  const key = await a.engine.create()
  await a.engine.sync()
  await b.engine.join(key)
  await b.engine.sync()
  return { server, a, b, key }
}

/* ---------- The sync key and encryption ---------- */

describe('sync key', () => {
  const secret = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 255)

  test('is 11 groups of 5 unambiguous characters and reads back to the same bytes', async () => {
    const key = await formatSyncKey(secret)
    assert.match(key, /^([0-9A-HJKMNP-TV-Z]{5}-){10}[0-9A-HJKMNP-TV-Z]{5}$/)
    assert.deepEqual(await parseSyncKey(key), secret)
  })

  test('each generated key is different', async () => {
    const keys = new Set(await Promise.all(Array.from({ length: 50 }, () => generateSyncKey())))
    assert.equal(keys.size, 50)
  })

  test('forgives case, spaces, missing dashes and look-alike letters', async () => {
    const key = await formatSyncKey(secret)
    const messy = `  ${key.toLowerCase().replaceAll('-', ' ').replaceAll('0', 'o').replaceAll('1', 'l')} `
    assert.deepEqual(await parseSyncKey(messy), secret)
    assert.deepEqual(await parseSyncKey(key.replaceAll('-', '').replaceAll('1', 'I')), secret)
  })

  test('catches a typo in any position before anything is sent', async () => {
    const key = (await formatSyncKey(secret)).replaceAll('-', '')
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
    for (let i = 0; i < key.length; i++) {
      const wrong = alphabet[(alphabet.indexOf(key[i]) + 1) % 32]
      await assert.rejects(parseSyncKey(key.slice(0, i) + wrong + key.slice(i + 1)), SyncKeyError, `typo at ${i} went unnoticed`)
    }
    await assert.rejects(parseSyncKey(''), SyncKeyError)
    await assert.rejects(parseSyncKey('hello'), SyncKeyError)
    await assert.rejects(parseSyncKey(key.slice(0, -1)), SyncKeyError)
    await assert.rejects(parseSyncKey(`${key}0`), SyncKeyError)
    await assert.rejects(parseSyncKey(key.replace(/.$/, 'U')), SyncKeyError)
  })

  test('derives a server token that is stable, differs per key and does not expose the encryption key', async () => {
    const one = await deriveKeys(secret)
    const again = await deriveKeys(secret)
    const other = await deriveKeys(Uint8Array.from(secret, (b) => b ^ 1))
    assert.match(one.token, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(one.token, again.token)
    assert.notEqual(one.token, other.token)
    assert.equal(one.encKey.extractable, false)
    await assert.rejects(crypto.subtle.exportKey('raw', one.encKey))
  })
})

describe('record encryption', () => {
  const keys = deriveKeys(Uint8Array.from({ length: 32 }, (_, i) => i))
  const otherKeys = deriveKeys(Uint8Array.from({ length: 32 }, (_, i) => 255 - i))
  const value = { v: 1, t: 'items', r: { title: 'Ünïcødé ✓ 日本語', notes: 'x'.repeat(5000) } }

  test('round trips, and the same content never encrypts to the same blob twice', async () => {
    const { encKey } = await keys
    const one = await seal(encKey, 'rec-1', value)
    const two = await seal(encKey, 'rec-1', value)
    assert.notEqual(one, two)
    assert.deepEqual(await open(encKey, 'rec-1', one), value)
    assert.deepEqual(await open(encKey, 'rec-1', two), value)
    assert.ok(!Buffer.from(one, 'base64').toString('latin1').includes('xxxxxxxx'))
  })

  test('hides how long short content is', async () => {
    const { encKey } = await keys
    const short = await seal(encKey, 'a', { title: 'Hi' })
    const longer = await seal(encKey, 'a', { title: 'A noticeably longer title than the other one, by quite a margin' })
    assert.equal(short.length, longer.length)
  })

  test('refuses a blob that was altered, moved to another record, or made with another key', async () => {
    const { encKey } = await keys
    const blob = await seal(encKey, 'rec-1', value)
    const bytes = Buffer.from(blob, 'base64')
    for (const position of [0, 1, 13, 40, bytes.length - 1]) {
      const altered = Buffer.from(bytes)
      altered[position] ^= 1
      await assert.rejects(open(encKey, 'rec-1', altered.toString('base64')), `flipped bit at ${position} was accepted`)
    }
    await assert.rejects(open(encKey, 'rec-1', bytes.subarray(0, bytes.length - 8).toString('base64')))
    await assert.rejects(open(encKey, 'rec-2', blob))
    await assert.rejects(open((await otherKeys).encKey, 'rec-1', blob))
    await assert.rejects(open(encKey, 'rec-1', 'AAAA'))
    await assert.rejects(open(encKey, 'rec-1', 'not base64!'))
  })
})

describe('checks on incoming records', () => {
  test('keeps known fields, drops unknown ones', () => {
    const item = makeItem()
    assert.deepEqual(sanitizeRecord('items', { ...item, admin: true, __proto__: { polluted: true } }), item)
    const project = makeProject()
    assert.deepEqual(sanitizeRecord('projects', { ...project, extra: 1 }), project)
    const session = makeSession()
    assert.deepEqual(sanitizeRecord('sessions', session), session)
  })

  test('rejects wrong types, bad dates and bad ids', () => {
    const bad = [
      ['items', makeItem({ title: 42 })],
      ['items', makeItem({ type: 'note' })],
      ['items', makeItem({ status: 'archived' })],
      ['items', makeItem({ updatedAt: '9999' })],
      ['items', makeItem({ updatedAt: '2026-13-45T99:99:99.999Z' })],
      ['items', makeItem({ updatedAt: '2026-11-01 10:00:00' })],
      ['items', makeItem({ deletedAt: 'yes' })],
      ['items', makeItem({ dueDate: 'tomorrow' })],
      ['items', makeItem({ id: '../../x' })],
      ['items', makeItem({ id: '' })],
      ['items', makeItem({ projectId: { $ne: null } })],
      ['items', (() => { const { notes: _notes, ...rest } = makeItem(); return rest })()],
      ['projects', makeProject({ archived: 'no' })],
      ['projects', makeProject({ name: null })],
      ['sessions', makeSession({ plannedMinutes: -5 })],
      ['sessions', makeSession({ pausedMs: Number.POSITIVE_INFINITY })],
      ['sessions', makeSession({ kind: 'nap' })],
      ['sessions', makeSession({ startedAt: null })],
      ['items', null],
      ['items', 'text'],
      ['items', [makeItem()]],
    ]
    for (const [table, raw] of bad) assert.equal(sanitizeRecord(table, raw), null, JSON.stringify(raw)?.slice(0, 90))
  })

  test('an envelope must name a known table and match the id it arrived under', () => {
    const item = makeItem()
    assert.deepEqual(readEnvelope({ v: 1, t: 'items', r: item }, item.id), { v: 1, t: 'items', r: item })
    assert.equal(readEnvelope({ v: 1, t: 'items', r: item }, 'another-id'), null)
    assert.equal(readEnvelope({ v: 1, t: 'syncState', r: item }, item.id), null)
    assert.equal(readEnvelope({ v: 1, t: 'projects', r: item }, item.id), null)
    assert.equal(readEnvelope({ v: 0, t: 'items', r: item }, item.id), null)
    assert.equal(readEnvelope({ t: 'items', r: item }, item.id), null)
    assert.equal(readEnvelope('items', item.id), null)
    assert.equal(readEnvelope({ v: 2, t: 'habits', r: {} }, item.id), 'newer')
  })
})

/* ---------- Whole devices ---------- */

describe('two devices', () => {
  test('the second device receives everything, and the server only ever holds ciphertext', async () => {
    const server = await startServer()
    const a = device(server.url)
    const project = makeProject({ name: 'Secret garden project' })
    await a.db.projects.add(project)
    await a.db.items.bulkAdd([
      makeItem({ title: 'Buy tulip bulbs for the hidden bed', projectId: project.id }),
      makeItem({ type: 'idea', title: 'A pond, maybe', notes: 'Private thoughts about the pond' }),
    ])
    await a.db.sessions.add(makeSession({ projectId: project.id, note: 'Dug the trench' }))

    const key = await a.engine.create()
    assert.deepEqual(await a.engine.sync(), { pulled: 0, pushed: 4 })

    const b = device(server.url)
    await b.engine.join(key)
    assert.deepEqual(await b.engine.sync(), { pulled: 4, pushed: 0 })
    await assertSame(a, b)

    // Look at what the server wrote to disk, both as text and with every blob decoded from base64.
    const stored = fs.readFileSync(server.vaultFile, 'utf8')
    const decoded = stored
      .trimEnd()
      .split('\n')
      .slice(1)
      .map((line) => Buffer.from(JSON.parse(line).b, 'base64').toString('latin1'))
      .join('\n')
    const state = await a.db.syncState.get('state')
    for (const secret of ['tulip bulbs', 'Secret garden', 'Private thoughts', 'Dug the trench', '"title"', key, key.replaceAll('-', ''), state.token]) {
      assert.ok(!stored.includes(secret) && !decoded.includes(secret), `the server file contains "${secret}"`)
    }
    assert.equal(state.encKey.extractable, false)

    // A second run with nothing new moves nothing.
    assert.deepEqual(await a.engine.sync(), { pulled: 0, pushed: 0 })
    assert.deepEqual(await b.engine.sync(), { pulled: 0, pushed: 0 })
    assert.equal(await b.engine.pendingCount(), 0)
  })

  test('edits and deletions travel both ways', async () => {
    const { a, b } = await pair()
    const item = makeItem({ title: 'Original' })
    await a.db.items.add(item)
    await a.engine.sync()
    await b.engine.sync()
    assert.equal((await b.db.items.get(item.id)).title, 'Original')

    await b.db.items.update(item.id, { title: 'Edited on B', updatedAt: new Date().toISOString() })
    assert.equal(await b.engine.pendingCount(), 1)
    await b.engine.sync()
    await a.engine.sync()
    assert.equal((await a.db.items.get(item.id)).title, 'Edited on B')

    const stamp = new Date(Date.now() + 5).toISOString()
    await a.db.items.update(item.id, { deletedAt: stamp, updatedAt: stamp })
    await a.engine.sync()
    await b.engine.sync()
    assert.equal((await b.db.items.get(item.id)).deletedAt, stamp)
    await assertSame(a, b)
  })

  test('changes made apart on different records are all kept', async () => {
    const { a, b } = await pair()
    await a.db.items.add(makeItem({ title: 'From A' }))
    await b.db.items.add(makeItem({ title: 'From B' }))
    await b.db.projects.add(makeProject({ name: 'From B too' }))
    await a.engine.sync()
    await b.engine.sync()
    await a.engine.sync()
    await assertSame(a, b)
    assert.equal((await a.db.items.count()) + (await a.db.projects.count()), 3)
  })

  test('when both edit the same record, the later edit wins on both', async () => {
    const { a, b } = await pair()
    const item = makeItem()
    await a.db.items.add(item)
    await a.engine.sync()
    await b.engine.sync()

    await a.db.items.update(item.id, { title: 'Earlier edit on A', updatedAt: iso(T0 + 1 * MIN) })
    await b.db.items.update(item.id, { title: 'Later edit on B', updatedAt: iso(T0 + 2 * MIN) })
    // Whichever device reaches the server first, the result is the same.
    await b.engine.sync()
    await a.engine.sync()
    await b.engine.sync()
    assert.equal((await a.db.items.get(item.id)).title, 'Later edit on B')
    await assertSame(a, b)

    await a.db.items.update(item.id, { title: 'Earlier again on A', updatedAt: iso(T0 + 3 * MIN) })
    await b.db.items.update(item.id, { title: 'Latest on B', updatedAt: iso(T0 + 4 * MIN) })
    await a.engine.sync()
    await b.engine.sync()
    await a.engine.sync()
    assert.equal((await a.db.items.get(item.id)).title, 'Latest on B')
    await assertSame(a, b)
  })

  test('identical timestamps with different content still settle on one version', async () => {
    const { a, b } = await pair()
    const item = makeItem()
    await a.db.items.add(item)
    await a.engine.sync()
    await b.engine.sync()
    const same = iso(T0 + 9 * MIN)
    await a.db.items.update(item.id, { title: 'Version A', updatedAt: same })
    await b.db.items.update(item.id, { title: 'Version B', updatedAt: same })
    await a.engine.sync()
    await b.engine.sync()
    await a.engine.sync()
    await assertSame(a, b)
    assert.equal((await a.db.items.get(item.id)).title, 'Version A')
    assert.equal(await a.engine.pendingCount(), 0)
    assert.equal(await b.engine.pendingCount(), 0)
  })

  test('a device that pushes while another is mid-sync does not cause lost changes', async () => {
    const server = await startServer()
    const a = device(server.url)
    const key = await a.engine.create()
    await a.engine.sync()

    // B's connection is rigged: right after B's first pull, A sneaks a change onto the server.
    const real = createApi(server.url)
    let sneak = true
    let pushes = 0
    const b = device(server.url, {
      ...real,
      async pull(...args) {
        const page = await real.pull(...args)
        if (sneak) {
          sneak = false
          await a.db.items.add(makeItem({ title: 'Sneaked in by A' }))
          await a.engine.sync()
        }
        return page
      },
      async push(...args) {
        pushes += 1
        return real.push(...args)
      },
    })
    await b.engine.join(key)
    await b.db.items.add(makeItem({ title: 'Made on B' }))
    await b.engine.sync()
    assert.equal(pushes, 2, 'expected one refused push and one accepted push')
    await a.engine.sync()
    await assertSame(a, b)
    assert.equal(await a.db.items.count(), 2)
  })

  test('a record edited while it is being sent is sent again', async () => {
    const server = await startServer()
    const real = createApi(server.url)
    const item = makeItem({ title: 'First' })
    let editDuringPush = true
    const a = device(server.url, {
      ...real,
      async push(...args) {
        const reply = await real.push(...args)
        if (editDuringPush) {
          editDuringPush = false
          await a.db.items.update(item.id, { title: 'Edited mid-flight', updatedAt: new Date(Date.now() + 10).toISOString() })
        }
        return reply
      },
    })
    await a.db.items.add(item)
    const key = await a.engine.create()
    await a.engine.sync()
    assert.equal(await a.engine.pendingCount(), 1)
    await a.engine.sync()
    assert.equal(await a.engine.pendingCount(), 0)

    const b = device(server.url)
    await b.engine.join(key)
    await b.engine.sync()
    assert.equal((await b.db.items.get(item.id)).title, 'Edited mid-flight')
  })

  test('records with old timestamps are still sent (for example after importing a backup)', async () => {
    const { a, b } = await pair()
    await a.db.items.add(makeItem({ title: 'Recent' }))
    await a.engine.sync()
    const old = makeItem({ title: 'From a two-year-old backup', createdAt: iso(T0 - 700 * 24 * 60 * MIN), updatedAt: iso(T0 - 700 * 24 * 60 * MIN) })
    await a.db.items.put(old)
    assert.equal(await a.engine.pendingCount(), 1)
    await a.engine.sync()
    await b.engine.sync()
    assert.equal((await b.db.items.get(old.id)).title, 'From a two-year-old backup')
    await assertSame(a, b)
  })

  test('a large first sync arrives complete', async () => {
    const server = await startServer()
    const a = device(server.url)
    const items = Array.from({ length: 1250 }, (_, i) => makeItem({ title: `Item ${i}`, updatedAt: iso(T0 + i) }))
    await a.db.items.bulkAdd(items)
    const key = await a.engine.create()
    assert.equal((await a.engine.sync()).pushed, 1250)
    const b = device(server.url)
    await b.db.items.add(makeItem({ title: 'Already on B' }))
    await b.engine.join(key)
    assert.deepEqual(await b.engine.sync(), { pulled: 1250, pushed: 1 })
    await a.engine.sync()
    await assertSame(a, b)
    assert.equal(await a.db.items.count(), 1251)
  })
})

describe('clocks and timers', () => {
  test('an edit on a device whose clock runs behind still wins over the version it edited', async () => {
    const { a, b } = await pair()
    // A's clock is an hour fast.
    const future = new Date(Date.now() + 60 * MIN).toISOString()
    const item = makeItem({ title: 'Done on A', status: 'done', doneAt: future, updatedAt: future })
    await a.db.items.add(item)
    await a.engine.sync()
    await b.engine.sync()

    // B reopens it, stamping with its own (correct, so earlier) clock.
    await b.db.items.update(item.id, { status: 'open', doneAt: null, updatedAt: new Date().toISOString() })
    const onB = await b.db.items.get(item.id)
    assert.ok(onB.updatedAt > future, 'the stamp did not move past the edited version')
    await b.engine.sync()
    await a.engine.sync()
    assert.equal((await a.db.items.get(item.id)).status, 'open')
    await assertSame(a, b)
  })

  test('an update that forgets its timestamp is stamped anyway, and an empty update changes nothing', async () => {
    const { a, b } = await pair()
    const item = makeItem()
    await a.db.items.add(item)
    await a.engine.sync()
    await a.db.items.update(item.id, {})
    assert.equal(await a.engine.pendingCount(), 0)
    await a.db.items.update(item.id, { title: 'Renamed without a stamp' })
    assert.ok((await a.db.items.get(item.id)).updatedAt > item.updatedAt)
    await a.engine.sync()
    await b.engine.sync()
    assert.equal((await b.db.items.get(item.id)).title, 'Renamed without a stamp')
  })

  test('timers started on two devices while apart: the later one keeps running', async () => {
    const { a, b } = await pair()
    const first = makeSession({ startedAt: iso(T0), endedAt: null, completed: false, plannedMinutes: 25 })
    const second = makeSession({ startedAt: iso(T0 + 10 * MIN), endedAt: null, completed: false, plannedMinutes: 25, createdAt: iso(T0 + 10 * MIN), updatedAt: iso(T0 + 10 * MIN) })
    await a.db.sessions.add(first)
    await b.db.sessions.add(second)
    await a.engine.sync()
    await b.engine.sync()
    await a.engine.sync()
    await assertSame(a, b)
    const running = (await a.db.sessions.toArray()).filter((s) => s.endedAt === null)
    assert.deepEqual(running.map((s) => s.id), [second.id])
    const ended = await a.db.sessions.get(first.id)
    assert.equal(ended.endedAt, second.startedAt)
    assert.equal(ended.completed, false)
  })

  test('an earlier timer that had already run its full length is recorded as completed', async () => {
    const { a, b } = await pair()
    const first = makeSession({ startedAt: iso(T0), endedAt: null, completed: false, plannedMinutes: 5 })
    const paused = makeSession({ startedAt: iso(T0 + 1 * MIN), endedAt: null, completed: false, plannedMinutes: 25, pausedAt: iso(T0 + 4 * MIN), pausedMs: 1000 })
    const latest = makeSession({ startedAt: iso(T0 + 10 * MIN), endedAt: null, completed: false })
    await a.db.sessions.bulkAdd([first, paused])
    await b.db.sessions.add(latest)
    await a.engine.sync()
    await b.engine.sync()
    await a.engine.sync()
    await assertSame(a, b)
    const one = await a.db.sessions.get(first.id)
    assert.equal(one.endedAt, iso(T0 + 5 * MIN))
    assert.equal(one.completed, true)
    const two = await a.db.sessions.get(paused.id)
    assert.equal(two.endedAt, latest.startedAt)
    assert.equal(two.pausedAt, null)
    assert.equal(two.pausedMs, 1000 + 6 * MIN)
    assert.equal((await a.db.sessions.get(latest.id)).endedAt, null)
  })
})

describe('keys, trust and failure', () => {
  test('a wrong key is refused and leaves the device untouched', async () => {
    const { server, a } = await pair()
    await a.db.items.add(makeItem({ title: 'Only for my devices' }))
    await a.engine.sync()
    const stranger = device(server.url)
    await assert.rejects(stranger.engine.join(await generateSyncKey()), isSyncError('rejected'))
    await assert.rejects(stranger.engine.join('AAAAA-BBBBB'), SyncKeyError)
    assert.equal(await stranger.engine.state(), undefined)
    await assert.rejects(stranger.engine.sync(), isSyncError('off'))
    await assert.rejects(stranger.engine.create(), isSyncError('claimed'))
    assert.equal(await stranger.db.items.count(), 0)
  })

  test('blobs tampered with or swapped on the server are skipped, and everything else still syncs', async () => {
    const { server, a, b } = await pair()
    const good = makeItem({ title: 'Untouched' })
    const altered = makeItem({ title: 'Will be altered' })
    const swappedOne = makeItem({ title: 'Swap one' })
    const swappedTwo = makeItem({ title: 'Swap two' })
    await a.db.items.bulkAdd([good, altered, swappedOne, swappedTwo])
    await a.engine.sync()

    const records = server.app.vault.records
    const bytes = Buffer.from(records.get(altered.id).blob, 'base64')
    bytes[bytes.length - 3] ^= 0xff
    records.get(altered.id).blob = bytes.toString('base64')
    const keep = records.get(swappedOne.id).blob
    records.get(swappedOne.id).blob = records.get(swappedTwo.id).blob
    records.get(swappedTwo.id).blob = keep
    server.app.vault.sorted = null

    assert.deepEqual(await b.engine.sync(), { pulled: 1, pushed: 0 })
    assert.equal((await b.db.items.get(good.id)).title, 'Untouched')
    assert.equal(await b.db.items.count(), 1)
    assert.equal((await b.db.syncState.get('state')).unreadable, 3)
  })

  test('a well-encrypted but malformed record from another device is not let in', async () => {
    const { server, a, b, key } = await pair()
    const { encKey, token } = await deriveKeys(await parseSyncKey(key))
    const api = createApi(server.url)
    const evil = makeItem({ title: 12345, notes: { nested: 'object' } })
    const wrongTable = makeItem()
    const mismatched = makeItem()
    const fine = makeItem({ title: 'Fine' })
    const seq = (await a.db.syncState.get('state')).cursor
    await api.push(token, seq, [
      { id: evil.id, blob: await seal(encKey, evil.id, { v: 1, t: 'items', r: evil }) },
      { id: wrongTable.id, blob: await seal(encKey, wrongTable.id, { v: 1, t: 'syncState', r: wrongTable }) },
      { id: mismatched.id, blob: await seal(encKey, mismatched.id, { v: 1, t: 'items', r: { ...mismatched, id: fine.id } }) },
      { id: fine.id, blob: await seal(encKey, fine.id, { v: 1, t: 'items', r: { ...fine, isAdmin: true } }) },
    ])
    await b.engine.sync()
    assert.deepEqual(await b.db.items.toArray(), [fine])
    assert.equal((await b.db.syncState.get('state')).unreadable, 3)
    assert.equal((await b.db.syncState.get('state')).key, 'state')
  })

  test('data written by a newer app version pauses sync instead of being mangled', async () => {
    const { server, a, b, key } = await pair()
    const { encKey, token } = await deriveKeys(await parseSyncKey(key))
    await a.db.items.add(makeItem({ title: 'Before the newer record' }))
    await a.engine.sync()
    const before = (await b.db.syncState.get('state')).cursor
    const id = uid()
    const seq = (await a.db.syncState.get('state')).cursor
    await createApi(server.url).push(token, seq, [{ id, blob: await seal(encKey, id, { v: 2, t: 'habits', r: { id, streak: 4 } }) }])

    await assert.rejects(b.engine.sync(), isSyncError('update-needed'))
    assert.equal((await b.db.syncState.get('state')).cursor, before, 'the position moved past data this version cannot read')
    assert.equal(await b.db.items.count(), 0)
  })

  test('turning sync off keeps the data and forgets the key', async () => {
    const { a } = await pair()
    await a.db.items.add(makeItem())
    await a.engine.sync()
    await a.engine.disable()
    assert.equal(await a.engine.state(), undefined)
    assert.equal(await a.db.syncedVersions.count(), 0)
    assert.equal(await a.db.items.count(), 1)
    await assert.rejects(a.engine.sync(), isSyncError('off'))
  })

  test('an unreachable server is reported as such and nothing is lost', async () => {
    const { server, a, b } = await pair()
    await server.stop()
    await a.db.items.add(makeItem({ title: 'Made while offline' }))
    await assert.rejects(a.engine.sync(), isSyncError('offline'))
    assert.equal(await a.engine.pendingCount(), 1)
    assert.equal(await b.engine.pendingCount(), 0)
  })

  test('after the server loses its data, devices fill it again', async () => {
    const { server, a, b, key } = await pair()
    await a.db.items.bulkAdd([makeItem({ title: 'One' }), makeItem({ title: 'Two' })])
    await a.engine.sync()
    await b.engine.sync()
    await b.db.items.add(makeItem({ title: 'Made on B before the loss was noticed' }))

    await server.stop()
    fs.rmSync(server.vaultFile)
    const fresh = await startServer(server.root)
    const a2 = { db: a.db, engine: new SyncEngine(a.db, createApi(fresh.url)) }
    const b2 = { db: b.db, engine: new SyncEngine(b.db, createApi(fresh.url)) }

    // The empty server knows no key, so the old pairing is refused.
    await assert.rejects(a2.engine.sync(), isSyncError('rejected'))
    // Setting it up again from A with the same key uploads everything A has.
    await a2.engine.disable()
    await a2.engine.join(key)
    assert.deepEqual(await a2.engine.sync(), { pulled: 0, pushed: 2 })
    // B notices the server holds a different data set, compares everything, and adds what only it has.
    assert.deepEqual(await b2.engine.sync(), { pulled: 0, pushed: 1 })
    await a2.engine.sync()
    await assertSame(a2, b2)
    assert.equal(await a.db.items.count(), 3)
    assert.equal(fresh.app.vault.records.size, 3)
  })
})
