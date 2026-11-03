// A fake API for the whole site, so the front end can be worked on with no SQL Server,
// no .NET and no database. Everything lives in memory and is thrown away on exit.
//
//   .\start.ps1            (the default: mock API, no database)
//   npm run mock           (the mock alone, if you are running vite yourself)
//
// It answers the same paths the real API does, with the same shapes, including the
// `{ "error": "..." }` body a refusal carries. One handler per module, so a module
// still owns its own fake data -- it just does not own a process.
//
// There is no sign-in here either, because there is none in the real API: the box is
// private and the site is open on it.

import http from 'node:http'
import { seedSettings, seedWorkspace } from './seed.mjs'

const PORT = Number(process.env.MOCK_PORT ?? 5490)

const modules = [
  {
    name: 'folio',
    title: 'Folio',
    description: 'The budget: accounts, transactions, envelopes, goals, reports and the calculator.',
  },
]

// ── the folio module's data ────────────────────────────────────────────────────────────
// Seed with a complete example budget so the app opens on something real rather than the
// first-run screen. Writes land in these same objects, so the site is fully interactive;
// they vanish when the process stops, which is the point of a mock.

const COLLECTIONS = {
  folio_accounts: 'accounts',
  folio_transactions: 'transactions',
  folio_upcoming: 'upcoming',
  folio_budget: 'budget',
  folio_template: 'template',
  folio_savings_goals: 'savings-goals',
  folio_finance: 'finance',
  folio_planner: 'planner',
  folio_import_history: 'import-history',
}

const workspace = new Map([['ireland', seedWorkspace('ireland')]])
const settings = seedSettings()

function countryWorkspace(country) {
  if (!workspace.has(country)) workspace.set(country, {})
  return workspace.get(country)
}

function json(response, status, body) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

function readJson(request) {
  return new Promise((resolve) => {
    let raw = ''

    request.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 20_000_000) request.destroy()
    })

    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve(null)
      }
    })
  })
}

/** The folio module's endpoints. Returns true when it answered. */
async function folioModule(request, response, route, url) {
  if (route === 'GET /api/folio/settings') {
    json(response, 200, settings)
    return true
  }

  if (route === 'PUT /api/folio/settings') {
    const body = await readJson(request)

    if (!body) {
      json(response, 400, { error: 'Those settings could not be read.' })
      return true
    }

    Object.assign(settings, body)
    response.writeHead(204).end()
    return true
  }

  const country = url.searchParams.get('country') ?? ''

  if (route === 'GET /api/folio/workspace') {
    if (!country) {
      json(response, 400, { error: 'A country is needed: ?country=ireland.' })
      return true
    }

    json(response, 200, countryWorkspace(country))
    return true
  }

  if (route === 'DELETE /api/folio/workspace') {
    if (!country) {
      json(response, 400, { error: 'A country is needed: ?country=ireland.' })
      return true
    }

    workspace.set(country, {})
    response.writeHead(204).end()
    return true
  }

  if (route === 'GET /api/folio/countries') {
    json(response, 200, [...workspace.keys()])
    return true
  }

  const saving = route.match(/^PUT \/api\/folio\/([\w-]+)$/)
  if (saving) {
    if (!country) {
      json(response, 400, { error: 'A country is needed: ?country=ireland.' })
      return true
    }

    const key = Object.keys(COLLECTIONS).find((candidate) => COLLECTIONS[candidate] === saving[1])
    if (!key) {
      json(response, 404, { error: `Nothing answers ${route} in the mock.` })
      return true
    }

    const body = await readJson(request)
    if (!body) {
      json(response, 400, { error: 'That collection could not be read.' })
      return true
    }

    countryWorkspace(country)[key] = body
    response.writeHead(204).end()
    return true
  }

  return false
}

/** The modules' handlers, tried in turn. */
const moduleHandlers = [folioModule]

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const route = `${request.method} ${url.pathname.replace(/\/+$/, '') || '/'}`

  if (route === 'GET /api/health') return json(response, 200, { status: 'ok', database: 'ok' })

  if (route === 'GET /api/core/modules') return json(response, 200, modules)

  for (const handler of moduleHandlers) {
    if (await handler(request, response, route, url)) return
  }

  json(response, 404, { error: `Nothing answers ${route} in the mock.` })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock API on http://127.0.0.1:${PORT}, serving the example budget for 'ireland'`)
})
