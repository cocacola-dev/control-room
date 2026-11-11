import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { toast } from 'sonner'
import './index.css'
import App from './App'
import { initTheme } from '@/lib/theme'
import { initInstallCapture } from '@/lib/install'
import { startSync } from '@/sync/sync'

initTheme()
initInstallCapture()
// Does nothing until sync is turned on in Settings.
startSync()

// Service worker: caches the whole app so it opens offline on every device.
// Registered here (not via an injected inline script) so the strict CSP in production holds.
registerSW({
  immediate: true,
  onOfflineReady() {
    toast.success('Ready to work offline', { description: 'The app is now installed in this browser.' })
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
