/**
 * End-of-block alerts: a generated chime (no audio files, so the strict CSP holds),
 * a system notification when permitted, and a vibration on phones.
 */

let audio: AudioContext | null = null

/** Create or resume the audio context. Must be called from a user gesture (the Start button) for iOS. */
export function primeAudio() {
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') void audio.resume()
  } catch {
    audio = null
  }
}

export function playChime() {
  if (!audio) return
  try {
    if (audio.state === 'suspended') void audio.resume()
    const t0 = audio.currentTime
    const notes: Array<[number, number]> = [
      [659.25, 0], // E5
      [880, 0.18], // A5
      [1318.5, 0.36], // E6
    ]
    for (const [freq, offset] of notes) {
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, t0 + offset)
      gain.gain.linearRampToValueAtTime(0.25, t0 + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + offset + 0.5)
      osc.connect(gain).connect(audio.destination)
      osc.start(t0 + offset)
      osc.stop(t0 + offset + 0.55)
    }
  } catch {
    /* audio unavailable */
  }
}

export function vibrate() {
  try {
    navigator.vibrate?.([200, 100, 200])
  } catch {
    /* unsupported */
  }
}

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return notificationsSupported() ? Notification.permission : 'unsupported'
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

export async function notify(title: string, body: string) {
  if (notificationPermission() !== 'granted') return
  const options: NotificationOptions = {
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-64x64.png',
    tag: 'control-room-timer',
  }
  // Installed apps must go through the service worker; a plain page can use the constructor.
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.showNotification(title, options)
      return
    }
  } catch {
    /* fall through */
  }
  try {
    new Notification(title, options)
  } catch {
    /* unsupported */
  }
}
