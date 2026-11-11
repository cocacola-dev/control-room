/**
 * Test setup, loaded before every test file (see the "test" script in package.json).
 *
 * 1. Gives Node an in-memory IndexedDB, so the real database code runs outside a browser.
 * 2. Teaches Node the two import habits of the app's source: the "@/…" alias for src/, and
 *    imports written without a file extension. Node strips the TypeScript types by itself.
 */
import 'fake-indexeddb/auto'
import { existsSync, statSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const isFile = (p) => existsSync(p) && statSync(p).isFile()

registerHooks({
  resolve(specifier, context, nextResolve) {
    let target = null
    if (specifier.startsWith('@/')) target = path.join(SRC, specifier.slice(2))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && !context.parentURL.includes('/node_modules/')) {
      target = fileURLToPath(new URL(specifier, context.parentURL))
    }
    if (target) {
      for (const ext of ['', '.ts', '.tsx']) {
        if (isFile(target + ext)) return nextResolve(pathToFileURL(target + ext).href, context)
      }
    }
    return nextResolve(specifier, context)
  },
})
