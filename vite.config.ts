import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, type Plugin } from 'vite'
import pkg from './package.json' with { type: 'json' }

/**
 * Content Security Policy, injected only into production builds.
 * Dev mode needs inline scripts/websockets for hot reload, so we keep it out of dev.
 * The sync server (server/server.mjs) reads this policy out of the built index.html and sends it
 * as a response header too, adding `frame-ancestors 'none'` (no other page may embed the app).
 * That one rule only works as a header, so it is not listed here.
 *
 * - script-src 'self'  : only our own bundled JS can run. Blocks injected scripts (XSS).
 * - connect-src 'self' : the app can only talk to its own origin. Sync goes to that same origin,
 *                        so this rule did not have to be loosened for it.
 * - style-src 'unsafe-inline' is needed for component libraries that set inline styles;
 *   styles cannot execute code, so this is low risk.
 */
function csp(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
  return {
    name: 'control-room-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      )
    },
  }
}

const SYNC_SERVER = 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    csp(),
    VitePWA({
      registerType: 'autoUpdate',
      // We register the service worker ourselves in main.tsx so no inline script is injected.
      injectRegister: null,
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'logo.svg'],
      manifest: {
        id: '/',
        name: 'Control Room',
        short_name: 'Control Room',
        description: 'Your life as data: ideas, todos, focus time and insights. Local-first and private.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0a0a0a',
        theme_color: '#0a0a0a',
        categories: ['productivity', 'lifestyle'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache everything the build produces so the app opens fully offline.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
        // Single-page app: unknown routes fall back to index.html.
        navigateFallback: '/index.html',
        // The sync API is never answered from the cache.
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: { enabled: false },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
  // While developing, /api is passed on to the sync server if it is running (npm run serve).
  server: { proxy: { '/api': SYNC_SERVER } },
  preview: { proxy: { '/api': SYNC_SERVER } },
})
