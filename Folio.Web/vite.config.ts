import http from 'node:http'
import { readFileSync } from 'node:fs'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

/** The app's version, which the About page shows. Read rather than imported: a JSON import needs attributes. */
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/**
 * The site is the root of everything: Folio at /folio, and / redirects to it.
 *
 * One origin, one dev server, one build. A module is a folder under src/modules, and its
 * page is loaded on arrival, so it still ships as its own chunk.
 */
const PORT = 5420

/** Where the API listens while developing. */
const API_PORT = Number(process.env.Folio_API_PORT ?? 5421)

/** The fake API, which is what a local run uses unless start.ps1 -Api is given. */
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 5490)

/**
 * The mock is the default: a local run has no database, so `/api` goes to the fake API
 * unless start.ps1 -Api says otherwise (Folio_MOCK=0).
 */
const useMock = process.env.Folio_MOCK !== '0'
const apiTarget = `http://127.0.0.1:${useMock ? MOCK_PORT : API_PORT}`

// One socket to the API, reused, rather than a new one per request.
const keepAlive = new http.Agent({ keepAlive: true })

export default defineConfig({
  plugins: [vue(), tailwindcss()],

  // The app is served from the root of its IIS site, and the router owns every path
  // under it, so assets are addressed from /.
  base: '/',

  define: {
    __APP_VERSION__: JSON.stringify(version),
  },

  test: {
    // The shared client keeps the session in localStorage and reads the page's own
    // origin, and the stores read localStorage, so the tests need a browser-shaped
    // environment.
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['src/modules/folio/__tests__/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.{test,spec}.ts', 'mocks/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      include: ['src/modules/folio/utils/**', 'src/modules/folio/stores/**', 'src/shared/**'],
      reporter: ['text', 'lcov'],
    },

    // The app is one lazy chunk of several hundred components, and this tree lives on a
    // network share: loading it on first navigation can take seconds when the suite is
    // running other files beside it.
    testTimeout: 20000,

    // Threads rather than forked processes, and only a couple of them: this repository
    // lives on a network share, where starting a worker costs the best part of a minute
    // and a worker per test file is slower than the tests themselves.
    pool: 'threads',
    maxWorkers: 2,
    isolate: false,
  },

  server: {
    // IPv4 loopback by name: the dev server proxies to 127.0.0.1, and a server bound to
    // "localhost" can end up on ::1 only, which the proxy then cannot reach.
    host: '127.0.0.1',
    port: PORT,
    // Fail rather than quietly move: the API is addressed by port.
    strictPort: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        agent: keepAlive,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            console.error(`[api proxy] ${err.message} - is the API running on ${apiTarget}? (start.ps1)`)
            if ('writeHead' in res && !res.headersSent && !res.writableEnded) {
              res.writeHead(502, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'The API is not answering.' }))
            }
          })
        },
      },
    },
  },
})
