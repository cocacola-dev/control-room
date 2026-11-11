/**
 * Tests for the Focus timer's arithmetic around pause and resume.
 * The clock is controlled by the test, so every moment is exact.
 * Run with: npm test
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, mock, test } from 'node:test'
import { db } from '@/db/db'
import { pauseSession, resumeSession, startSession, stopSession } from '@/db/repo'
import { MINUTE, elapsedMs, formatClock, progress, remainingMs } from '@/lib/sessions'

const T0 = Date.parse('2026-11-12T09:00:00.000Z')
/** Move the clock to `seconds` after the start of the test. */
const at = (seconds) => mock.timers.setTime(T0 + Math.round(seconds * 1000))
const stored = (id) => db.sessions.get(id)
const startFocus = () => startSession({ kind: 'focus', projectId: null, itemId: null, plannedMinutes: 25 })

beforeEach(async () => {
  mock.timers.enable({ apis: ['Date'], now: T0 })
  await db.sessions.clear()
})
afterEach(() => mock.timers.reset())

describe('what the timer shows', () => {
  test('a resumed timer shows what it showed while paused, however far behind the screen clock is', async () => {
    const { id } = await startFocus()
    // The clock on screen ticks once a second. Its last tick before the pause was at 2.0 s.
    const screenClock = T0 + 2000
    at(2.6)
    await pauseSession(id)
    const whilePaused = remainingMs(await stored(id), screenClock)
    assert.equal(whilePaused, 25 * MINUTE - 2600)

    at(6.6)
    await resumeSession(id)
    const resumed = await stored(id)
    // The screen clock has not ticked yet: it still says 2.0 s, more than four seconds ago.
    assert.equal(remainingMs(resumed, screenClock), whilePaused)
    assert.equal(formatClock(remainingMs(resumed, screenClock)), '24:58')
    assert.equal(progress(resumed, screenClock), 2600 / (25 * MINUTE))
    // Once it ticks, the countdown carries on from there.
    assert.equal(remainingMs(resumed, T0 + 7600), 25 * MINUTE - 3600)
  })

  test('pausing and resuming quickly never makes the time left go up', async () => {
    const { id } = await startFocus()
    const screenClock = T0 + 1000 // never ticks during the burst
    const shown = []
    let t = 1.3
    let pausedTotal = 0
    for (let press = 0; press < 20; press++) {
      at(t)
      if (press % 2 === 0) await pauseSession(id)
      else {
        await resumeSession(id)
        pausedTotal += 150
      }
      shown.push(remainingMs(await stored(id), screenClock))
      t += 0.15
    }
    for (let i = 1; i < shown.length; i++) {
      assert.ok(shown[i] <= shown[i - 1], `press ${i + 1}: ${shown[i - 1]} ms left became ${shown[i]} ms`)
    }
    const final = await stored(id)
    assert.equal(final.pausedMs, pausedTotal)
    assert.equal(final.pausedAt, null)
    // With a fresh clock the answer is exact: everything since the start, minus the pauses.
    at(10)
    assert.equal(elapsedMs(final), 10_000 - pausedTotal)
  })

  test('the floor only applies to a running timer and ignores an unreadable timestamp', () => {
    const base = { startedAt: new Date(T0).toISOString(), endedAt: null, pausedAt: null, pausedMs: 0, plannedMinutes: 25 }
    assert.equal(elapsedMs({ ...base, updatedAt: new Date(T0 + 5000).toISOString() }, T0 + 1000), 5000)
    assert.equal(elapsedMs({ ...base, updatedAt: new Date(T0 + 5000).toISOString() }, T0 + 9000), 9000)
    assert.equal(elapsedMs({ ...base, updatedAt: 'not a date' }, T0 + 3000), 3000)
    const ended = { ...base, endedAt: new Date(T0 + 60_000).toISOString(), updatedAt: new Date(T0 + 900_000).toISOString() }
    assert.equal(elapsedMs(ended, T0 + 5000), 60_000)
    const paused = { ...base, pausedAt: new Date(T0 + 30_000).toISOString(), updatedAt: new Date(T0 + 30_000).toISOString() }
    assert.equal(elapsedMs(paused, T0 + 500_000), 30_000)
  })
})

describe('pause, resume and stop act on the stored session, not on an outdated copy', () => {
  test('a second pause or a second resume changes nothing', async () => {
    const { id } = await startFocus()
    at(10)
    await pauseSession(id)
    at(12)
    await pauseSession(id)
    assert.equal((await stored(id)).pausedAt, new Date(T0 + 10_000).toISOString())

    at(15)
    await resumeSession(id)
    at(20)
    await resumeSession(id)
    const s = await stored(id)
    assert.equal(s.pausedMs, 5000)
    assert.equal(s.pausedAt, null)
    assert.equal(s.updatedAt, new Date(T0 + 15_000).toISOString())
    at(30)
    assert.equal(elapsedMs(s), 25_000)
  })

  test('presses that arrive together are applied one after another', async () => {
    const { id } = await startFocus()
    at(10)
    await Promise.all([pauseSession(id), resumeSession(id), pauseSession(id), resumeSession(id)])
    const s = await stored(id)
    assert.equal(s.pausedAt, null)
    assert.equal(s.pausedMs, 0)
  })

  test('stopping right after pausing does not count the pause as focus time', async () => {
    const { id } = await startFocus()
    at(120)
    await pauseSession(id)
    at(300)
    assert.equal(await stopSession(id), 'saved')
    const s = await stored(id)
    assert.equal(s.endedAt, new Date(T0 + 300_000).toISOString())
    assert.equal(s.pausedMs, 180_000)
    assert.equal(elapsedMs(s), 120_000)
    // Stopping, pausing or resuming something already stopped does nothing.
    at(400)
    assert.equal(await stopSession(id), 'saved')
    await pauseSession(id)
    await resumeSession(id)
    assert.deepEqual(await stored(id), s)
  })

  test('a block under a minute is discarded', async () => {
    const { id } = await startFocus()
    at(40)
    assert.equal(await stopSession(id), 'discarded')
    assert.ok((await stored(id)).deletedAt)
  })
})
