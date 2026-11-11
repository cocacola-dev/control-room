import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Bell, Download, HardDrive, Share, Smartphone, Timer, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { SyncCard } from '@/components/SyncCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { buildExport, downloadJson, exportFilename, importExport, parseExport } from '@/db/export'
import { wipeAllData } from '@/db/repo'
import { notificationPermission, requestNotificationPermission } from '@/lib/alerts'
import { isIOS, isStandalone, promptInstall, useCanPromptInstall } from '@/lib/install'
import { timerSettings, useTimerSettings, type TimerSettings } from '@/lib/settings'
import { useTheme, type Theme } from '@/lib/theme'

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-4">
        <AppearanceCard />
        <TimerCard />
        <InstallCard />
        <SyncCard />
        <DataCard />
        <DangerCard />
        <AboutCard />
      </div>
    </>
  )
}

function AppearanceCard() {
  const { theme, setTheme } = useTheme()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <Label htmlFor="theme">Theme</Label>
        <Select value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <SelectTrigger id="theme" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  )
}

type NumericKey = 'focusMinutes' | 'shortBreakMinutes' | 'longBreakMinutes' | 'longBreakEvery'

function NumberField({ id, label, min, max, value }: { id: NumericKey; label: string; min: number; max: number; value: number }) {
  function commit(raw: string): boolean {
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n) || n < min || n > max) return false
    timerSettings.set({ [id]: n } as Partial<TimerSettings>)
    return true
  }
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        defaultValue={value}
        onChange={(e) => commit(e.target.value)}
        onBlur={(e) => {
          if (!commit(e.target.value)) e.target.value = String(timerSettings.get()[id])
        }}
      />
    </div>
  )
}

function TimerCard() {
  const s = useTimerSettings()
  const [perm, setPerm] = useState(notificationPermission)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Timer className="size-4" /> Focus timer
        </CardTitle>
        <CardDescription>Lengths in minutes. A long break is suggested after the set number of focus blocks.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 text-sm">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumberField id="focusMinutes" label="Focus" min={1} max={180} value={s.focusMinutes} />
          <NumberField id="shortBreakMinutes" label="Short break" min={1} max={60} value={s.shortBreakMinutes} />
          <NumberField id="longBreakMinutes" label="Long break" min={1} max={120} value={s.longBreakMinutes} />
          <NumberField id="longBreakEvery" label="Long break every" min={1} max={12} value={s.longBreakEvery} />
        </div>
        <Separator />
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="font-medium">Chime when a block ends</span>
            <span className="block text-muted-foreground">A short generated tone. No audio files, nothing downloaded.</span>
          </span>
          <Switch checked={s.sound} onCheckedChange={(v) => timerSettings.set({ sound: v })} />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="font-medium">Keep screen awake during focus</span>
            <span className="block text-muted-foreground">
              Useful on a phone: the block always ends on time with its alert. Uses more battery.
            </span>
          </span>
          <Switch checked={s.keepAwake} onCheckedChange={(v) => timerSettings.set({ keepAwake: v })} />
        </label>
        <Separator />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-medium">System notifications</div>
            <div className="text-muted-foreground">
              {perm === 'granted'
                ? 'On. You will be notified when a block ends, even from another app.'
                : perm === 'denied'
                  ? 'Blocked in this browser. Allow notifications for this site in your browser settings.'
                  : perm === 'unsupported'
                    ? 'Not available here. On iPhone, notifications work once the app is added to the Home Screen.'
                    : 'Off. The chime and tab title still work.'}
            </div>
          </div>
          {perm === 'default' && (
            <Button size="sm" variant="outline" onClick={async () => setPerm(await requestNotificationPermission())}>
              <Bell /> Enable
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function InstallCard() {
  const canPrompt = useCanPromptInstall()
  const standalone = isStandalone()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="size-4" /> Install on this device
        </CardTitle>
        <CardDescription>
          Installed, Control Room opens in its own window, works offline and keeps its data safe from browser cleanups.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        {standalone ? (
          <p className="text-muted-foreground">Installed. You are running Control Room as an app.</p>
        ) : canPrompt ? (
          <Button
            size="sm"
            onClick={async () => {
              const r = await promptInstall()
              if (r === 'accepted') toast.success('Installed')
            }}
          >
            <Download /> Install app
          </Button>
        ) : isIOS() ? (
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Open this page in Safari.</li>
            <li>
              Tap the Share button <Share className="inline size-3.5 align-text-bottom" aria-label="Share" />.
            </li>
            <li>Choose "Add to Home Screen".</li>
          </ol>
        ) : (
          <p className="text-muted-foreground">
            Use your browser's install option: the icon at the right of the address bar in Chrome or Edge, or
            File → Add to Dock in Safari.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function DataCard() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [usage, setUsage] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  function refreshStorage() {
    readStorageStatus().then((st) => {
      setPersisted(st.persisted)
      setUsage(st.usage)
    })
  }
  useEffect(() => {
    let cancelled = false
    readStorageStatus().then((st) => {
      if (cancelled) return
      setPersisted(st.persisted)
      setUsage(st.usage)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function onExport() {
    setBusy(true)
    try {
      const data = await buildExport()
      downloadJson(data, exportFilename())
      toast.success('Backup downloaded', {
        description: `${data.items.length} items, ${data.projects.length} projects, ${data.sessions.length} sessions`,
      })
    } finally {
      setBusy(false)
    }
  }

  async function onImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const parsed = parseExport(JSON.parse(await file.text()))
      const s = await importExport(parsed)
      const merged = s.projects + s.items + s.sessions
      toast.success(`Imported ${merged} ${merged === 1 ? 'record' : 'records'}`, {
        description: s.skipped > 0 ? `${s.skipped} already up to date` : undefined,
      })
      refreshStorage()
    } catch (err) {
      toast.error('Import failed', { description: err instanceof Error ? err.message : 'Unreadable file' })
    } finally {
      setBusy(false)
    }
  }

  async function protect() {
    const ok = (await navigator.storage?.persist?.()) ?? false
    setPersisted(ok)
    if (ok) toast.success('Storage protected')
    else toast('Not granted yet', { description: 'Browsers grant this after you install the app or use it for a while.' })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="size-4" /> Your data
        </CardTitle>
        <CardDescription>
          Everything is stored on this device. Nothing leaves it unless you turn on sync, and then only encrypted, to
          your own server. A backup file is still worth exporting now and then.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void onExport()} disabled={busy}>
            <Download /> Export backup
          </Button>
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload /> Import backup
          </Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void onImport(e)} />
        </div>
        <p className="text-muted-foreground">
          Importing merges: for every record the newer version wins, so restoring an old backup never erases recent work.
        </p>
        <Separator />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-medium">Storage protection</div>
            <div className="text-muted-foreground">
              {persisted === null
                ? 'Not available in this browser.'
                : persisted
                  ? 'On. The browser will not evict this data to free space.'
                  : 'Off. The browser may clear this data if the device runs low on space.'}
              {usage !== null && ` Using ${formatBytes(usage)}.`}
            </div>
          </div>
          {persisted === false && (
            <Button size="sm" variant="outline" onClick={() => void protect()}>
              Protect
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function DangerCard() {
  const [open, setOpen] = useState(false)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Danger zone</CardTitle>
        <CardDescription>
          Permanently erase every project, item and session on this device. This also turns sync off here. Other
          devices and the server keep their copies.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button size="sm" variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 /> Delete all data
        </Button>
      </CardContent>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete all data on this device?"
        description="This cannot be undone. Export a backup first if there is any chance you want it back."
        confirmLabel="Delete everything"
        destructive
        onConfirm={async () => {
          await wipeAllData()
          toast('All data deleted')
        }}
      />
    </Card>
  )
}

function AboutCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>About</CardTitle>
        <CardDescription>Control Room v{__APP_VERSION__} · Phase 4 of 6</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li className="text-foreground">Foundation: install anywhere, local database, capture</li>
          <li className="text-foreground">Core tracking: Focus timer, sessions, daily log</li>
          <li className="text-foreground">Insights: charts, comparisons, time per project, streak</li>
          <li className="text-foreground">Encrypted sync between your devices over a private network</li>
          <li>Learning reminders, habits, journaling</li>
          <li>Native desktop polish</li>
        </ol>
      </CardContent>
    </Card>
  )
}

async function readStorageStatus(): Promise<{ persisted: boolean | null; usage: number | null }> {
  try {
    const persisted = (await navigator.storage?.persisted?.()) ?? null
    const est = await navigator.storage?.estimate?.()
    return { persisted, usage: est?.usage ?? null }
  } catch {
    return { persisted: null, usage: null }
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
