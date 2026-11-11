import { NavLink, Outlet } from 'react-router'
import { BarChart3, CalendarDays, FolderKanban, History, Inbox, Settings, Timer, type LucideIcon } from 'lucide-react'
import { SyncBadge } from '@/components/SyncBadge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface NavEntry {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  /** Shown in the 5-slot bottom bar on phones. Projects lives behind Inbox there; Settings behind the gear. */
  mobile: boolean
}

const NAV: NavEntry[] = [
  { to: '/', label: 'Today', icon: CalendarDays, end: true, mobile: true },
  { to: '/inbox', label: 'Inbox', icon: Inbox, mobile: true },
  { to: '/focus', label: 'Focus', icon: Timer, mobile: true },
  { to: '/log', label: 'Log', icon: History, mobile: true },
  { to: '/projects', label: 'Projects', icon: FolderKanban, mobile: false },
  { to: '/insights', label: 'Insights', icon: BarChart3, mobile: true },
  { to: '/settings', label: 'Settings', icon: Settings, mobile: false },
]

export function AppShell() {
  return (
    <div className="flex min-h-full">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-14 items-center gap-2.5 px-4">
          <img src="/logo.svg" alt="" className="size-6 rounded-md" />
          <span className="font-semibold tracking-tight">Control Room</span>
        </div>
        <nav className="flex flex-col gap-0.5 px-2" aria-label="Main">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
                  isActive && 'bg-sidebar-accent text-foreground',
                )
              }
            >
              <n.icon className="size-4" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col items-start px-4 py-3 text-xs text-muted-foreground">
          <SyncBadge />
          Local-first · v{__APP_VERSION__}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone top bar */}
        <header className="pt-safe sticky top-0 z-30 border-b bg-background/90 backdrop-blur md:hidden">
          <div className="flex h-12 items-center justify-between px-4">
            <div className="flex items-center gap-2">
              <img src="/logo.svg" alt="" className="size-5 rounded" />
              <span className="text-sm font-semibold tracking-tight">Control Room</span>
            </div>
            <div className="flex items-center gap-1">
              <SyncBadge compact />
              <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground">
                <NavLink to="/settings" aria-label="Settings" className="aria-[current=page]:text-foreground">
                  <Settings />
                </NavLink>
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full min-w-0 max-w-3xl flex-1 px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>

      {/* Phone bottom tabs */}
      <nav
        className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 backdrop-blur md:hidden"
        aria-label="Main"
      >
        <ul className="grid grid-cols-5">
          {NAV.filter((n) => n.mobile).map((n) => (
            <li key={n.to}>
              <NavLink
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center gap-1 py-2 text-[11px] font-medium text-muted-foreground',
                    isActive && 'text-foreground',
                  )
                }
              >
                <n.icon className="size-5" />
                {n.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
