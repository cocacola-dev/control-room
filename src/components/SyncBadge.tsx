import { NavLink } from 'react-router'
import { CloudCheck, CloudOff, RefreshCw, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSyncInfo, useSyncStatus, type SyncPhase } from '@/sync/sync'

const VIEW: Record<SyncPhase, { icon: LucideIcon; label: string; attention?: boolean }> = {
  idle: { icon: CloudCheck, label: 'Sync on' },
  syncing: { icon: RefreshCw, label: 'Syncing…' },
  offline: { icon: CloudOff, label: 'Sync waiting for server' },
  rejected: { icon: CloudOff, label: 'Sync needs attention', attention: true },
  'update-needed': { icon: CloudOff, label: 'Sync needs an update', attention: true },
  error: { icon: CloudOff, label: 'Sync hit a problem', attention: true },
}

/** A small sync state marker that leads to Settings. Renders nothing while sync is off. */
export function SyncBadge({ compact = false }: { compact?: boolean }) {
  const info = useSyncInfo()
  const { phase } = useSyncStatus()
  if (!info) return null
  const { icon: Icon, label, attention } = VIEW[phase]

  return (
    <NavLink
      to="/settings"
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md text-muted-foreground hover:text-foreground',
        compact ? 'size-7 justify-center' : 'mb-1.5 text-xs',
        attention && 'text-destructive hover:text-destructive',
      )}
    >
      <Icon className={cn(compact ? 'size-4' : 'size-3.5', phase === 'syncing' && 'animate-spin')} />
      {!compact && label}
    </NavLink>
  )
}
