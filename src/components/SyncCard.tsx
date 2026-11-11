import { useEffect, useState, type FormEvent } from 'react'
import { formatDistance } from 'date-fns'
import { Check, Copy, KeyRound, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useNow } from '@/hooks/useNow'
import {
  joinSync,
  probeServer,
  setUpSync,
  syncNow,
  turnOffSync,
  useSyncInfo,
  useSyncStatus,
  type ServerProbe,
  type SyncInfo,
  type SyncStatus,
} from '@/sync/sync'

const readable = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.')

export function SyncCard() {
  const info = useSyncInfo()
  // The new key lives here, in memory, only until its dialog is closed.
  const [newKey, setNewKey] = useState<string | null>(null)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="size-4" /> Sync between devices
        </CardTitle>
        <CardDescription>
          Records are encrypted on this device before they leave it. The server stores scrambled data and never
          receives the key.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {info === undefined ? null : info ? <SyncOn info={info} /> : <SyncOff onCreated={setNewKey} />}
      </CardContent>
      <NewKeyDialog syncKey={newKey} onDone={() => setNewKey(null)} />
    </Card>
  )
}

/* ---------- Not set up on this device ---------- */

function SyncOff({ onCreated }: { onCreated: (key: string) => void }) {
  const [probe, setProbe] = useState<ServerProbe | 'checking'>('checking')
  const [busy, setBusy] = useState(false)
  const [enterKey, setEnterKey] = useState(false)

  useEffect(() => {
    let cancelled = false
    void probeServer().then((result) => {
      if (!cancelled) setProbe(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function retry() {
    setProbe('checking')
    setProbe(await probeServer())
  }

  async function create() {
    setBusy(true)
    try {
      onCreated(await setUpSync())
    } catch (err) {
      toast.error('Could not set up sync', { description: readable(err) })
      setProbe(await probeServer())
    } finally {
      setBusy(false)
    }
  }

  if (probe === 'checking') return <p className="text-muted-foreground">Looking for the sync server…</p>

  if (probe === 'insecure') {
    return (
      <p className="text-muted-foreground">
        Sync needs a secure address, because browsers only allow encryption there. Open Control Room from your
        server's https address, or from localhost on the computer that runs it.
      </p>
    )
  }

  if (probe === 'none') {
    return (
      <div className="grid gap-2">
        <p>Off. This copy of the app is not connected to a sync server.</p>
        <p className="text-muted-foreground">
          Sync uses the small server that comes with Control Room, running on a computer you own and reachable only
          over your private network. Setup is described step by step in the README, under "Set up sync".
        </p>
      </div>
    )
  }

  if (probe === 'offline' || probe === 'update-needed') {
    return (
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p className="min-w-0 text-muted-foreground">
          {probe === 'offline'
            ? 'The sync server did not answer. Check that it is running and that this device is on your private network.'
            : 'The sync server is newer than this app. Reload the page to update.'}
        </p>
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => void retry()}>
          Try again
        </Button>
      </div>
    )
  }

  if (probe === 'in-use' || enterKey) {
    return (
      <div className="grid gap-3">
        <p>
          {probe === 'in-use'
            ? 'Sync is already set up on your server. Enter your sync key to connect this device.'
            : 'Enter a sync key to use it for this server.'}
        </p>
        <JoinForm />
        {probe === 'in-use' ? (
          <p className="text-muted-foreground">
            Lost the key? It cannot be recovered. The README explains how to start sync over with a new one.
          </p>
        ) : (
          <Button size="sm" variant="link" className="justify-self-start px-0" onClick={() => setEnterKey(false)}>
            Create a new key instead
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <p>
        Off. Turning it on creates a secret sync key on this device. Data already here is sent to your server
        encrypted, and your other devices join with the same key.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void create()} disabled={busy}>
          <KeyRound /> Set up sync
        </Button>
        <Button size="sm" variant="link" onClick={() => setEnterKey(true)} disabled={busy}>
          I already have a key
        </Button>
      </div>
    </div>
  )
}

function JoinForm() {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await joinSync(value)
      toast.success('Connected', { description: 'This device now syncs with your others.' })
    } catch (err) {
      setError(readable(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-1.5">
      <Label htmlFor="sync-key">Sync key</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="sync-key"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="XXXXX-XXXXX-XXXXX-…"
          className="font-mono"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby="sync-key-help"
        />
        <Button type="submit" disabled={busy || value.trim() === ''}>
          Connect
        </Button>
      </div>
      <p id="sync-key-help" role={error ? 'alert' : undefined} className={error ? 'text-destructive' : 'text-muted-foreground'}>
        {error ?? 'The key you saved when you set up sync on your first device. Dashes and capitals do not matter.'}
      </p>
    </form>
  )
}

/* ---------- Set up on this device ---------- */

function describe(status: SyncStatus, info: SyncInfo, now: Date): { headline: string; text: string } {
  switch (status.phase) {
    case 'syncing':
      return { headline: 'Syncing…', text: 'Sending and fetching changes.' }
    case 'offline':
      return {
        headline: 'On, waiting for the server',
        text: 'It cannot be reached right now. Changes are saved on this device and are sent once it is back in reach.',
      }
    case 'rejected':
      return {
        headline: "This device's key is no longer accepted",
        text: 'Sync was probably started over with a new key. Turn sync off here, then join with the current key.',
      }
    case 'update-needed':
      return {
        headline: 'Update needed',
        text: 'Another device uses a newer version of Control Room. Reload this app to update it and sync continues.',
      }
    case 'error':
      return { headline: 'Sync hit a problem', text: `${status.detail ?? 'Unknown error.'} It retries by itself.` }
    default: {
      if (!info.lastSyncAt) return { headline: 'On', text: 'Connected. The first sync is starting.' }
      // The clock on screen ticks every half minute, so a sync that just finished can look like the future.
      const at = Math.min(Date.parse(info.lastSyncAt), now.getTime())
      return { headline: 'On', text: `Up to date. Last synced ${formatDistance(at, now, { addSuffix: true })}.` }
    }
  }
}

function SyncOn({ info }: { info: SyncInfo }) {
  const status = useSyncStatus()
  const now = useNow(30_000)
  const [confirmOff, setConfirmOff] = useState(false)
  const { headline, text } = describe(status, info, now)
  const syncing = status.phase === 'syncing'
  const skipped = info.unreadable + info.unsendable

  return (
    <>
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div aria-live="polite" className="min-w-0">
          <div className="font-medium">{headline}</div>
          <div className="text-muted-foreground">{text}</div>
        </div>
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => void syncNow()} disabled={syncing}>
          <RefreshCw className={syncing ? 'animate-spin' : undefined} /> Sync now
        </Button>
      </div>
      {skipped > 0 && (
        <p className="text-muted-foreground">
          {info.unreadable > 0 &&
            `${info.unreadable} ${info.unreadable === 1 ? 'record' : 'records'} from the server could not be read and ${info.unreadable === 1 ? 'was' : 'were'} skipped. `}
          {info.unsendable > 0 &&
            `${info.unsendable} ${info.unsendable === 1 ? 'record' : 'records'} on this device could not be sent. `}
          Everything else is unaffected.
        </p>
      )}
      <Separator />
      <div>
        <div className="font-medium">Add another device</div>
        <div className="text-muted-foreground">
          Open Control Room on that device from your server's address, go to Settings, and enter your sync key.
        </div>
      </div>
      <Separator />
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="font-medium">Turn off on this device</div>
          <div className="text-muted-foreground">Your data stays here. This device stops sending and receiving changes.</div>
        </div>
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => setConfirmOff(true)}>
          Turn off
        </Button>
      </div>
      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title="Turn off sync on this device?"
        description="Nothing is deleted, here or on the server. This device forgets the sync key, so you will need to enter it again to turn sync back on."
        confirmLabel="Turn off"
        onConfirm={async () => {
          await turnOffSync()
          toast('Sync is off on this device')
        }}
      />
    </>
  )
}

/* ---------- The one time the key is shown ---------- */

function NewKeyDialog({ syncKey, onDone }: { syncKey: string | null; onDone: () => void }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!syncKey) return
    try {
      await navigator.clipboard.writeText(syncKey)
      setCopied(true)
    } catch {
      toast('Could not copy', { description: 'Select the key and copy it by hand.' })
    }
  }

  return (
    <Dialog open={syncKey !== null}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Save your sync key</DialogTitle>
          <DialogDescription>
            Sync is on. This key is what lets your other devices join and read your data. It is shown only this once.
          </DialogDescription>
        </DialogHeader>
        <code className="block rounded-lg border bg-muted px-3 py-2 font-mono text-sm leading-relaxed select-all">{syncKey}</code>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Store it in a password manager.</li>
          <li>Enter it in Settings on each device you want to connect.</li>
          <li>If it is lost, new devices cannot join. You would start sync over with a new key.</li>
          <li>Treat it like a password: with this key and access to your server, your data can be read.</li>
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => void copy()}>
            {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy key'}
          </Button>
          <Button
            onClick={() => {
              setCopied(false)
              onDone()
            }}
          >
            I have saved it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
