// Global test setup — mocks browser APIs not available in happy-dom

import { afterAll, vi } from 'vitest'
import { flushSaves } from '../workspace'

// matchMedia mock (used by settingsStore to detect 12h clock preference)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// A store writes through `queueStoreSave`, which waits half a second before it sends. The
// tests share one module instance (`isolate: false`), so a save a test leaves pending is
// still on its timer when the file ends: it lands in whatever runs next, or after the
// worker has gone, and the console output it produces then fails the run. Waiting for the
// queue here keeps every file's own saves inside that file; the stub answers them so the
// end of a file is not a page of connection errors.
afterAll(async () => {
  vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }))
  await flushSaves()
  vi.unstubAllGlobals()
})
