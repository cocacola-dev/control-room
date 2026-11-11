import { useEffect } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { AppShell } from '@/components/layout/AppShell'
import { TimerEngine } from '@/components/TimerEngine'
import { TodayPage } from '@/pages/Today'
import { InboxPage } from '@/pages/Inbox'
import { FocusPage } from '@/pages/Focus'
import { LogPage } from '@/pages/Log'
import { ProjectsPage } from '@/pages/Projects'
import { InsightsPage } from '@/pages/Insights'
import { SettingsPage } from '@/pages/Settings'

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <TodayPage /> },
      { path: 'inbox', element: <InboxPage /> },
      { path: 'focus', element: <FocusPage /> },
      { path: 'log', element: <LogPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'insights', element: <InsightsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export default function App() {
  useEffect(() => {
    // Ask the browser to protect our local database from automatic eviction.
    // Browsers grant this silently for installed apps; otherwise it's a harmless no-op.
    navigator.storage?.persist?.().catch(() => undefined)
  }, [])

  return (
    <TooltipProvider>
      <TimerEngine />
      <RouterProvider router={router} />
      <Toaster position="top-center" />
    </TooltipProvider>
  )
}
