/** Keeps the screen on while a focus block runs, when the user opts in. Re-acquired after the tab is hidden. */

let sentinel: WakeLockSentinel | null = null
let wanted = false

async function acquire() {
  if (sentinel || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return
  try {
    sentinel = await navigator.wakeLock.request('screen')
    sentinel.addEventListener('release', () => {
      sentinel = null
    })
  } catch {
    sentinel = null
  }
}

async function release() {
  try {
    await sentinel?.release()
  } catch {
    /* ignore */
  }
  sentinel = null
}

export async function setWakeLock(on: boolean) {
  wanted = on
  if (on) await acquire()
  else await release()
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (wanted && document.visibilityState === 'visible') void acquire()
  })
}
