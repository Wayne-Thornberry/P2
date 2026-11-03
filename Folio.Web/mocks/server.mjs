// A fake API for the whole site, so the front end can be worked on with no SQL Server,
// no .NET and no database. Everything lives in memory and is thrown away on exit.
//
//   npm run mock            (from Folio.Web)
//   .\start.ps1 -Mock
//
// It answers the same paths the real API does, with the same shapes, including the
// `{ "error": "..." }` body a refusal carries. One handler per module, so a module
// still owns its own fake data -- it just does not own a process.

import http from 'node:http'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.MOCK_PORT ?? 5490)
const PASSWORD = process.env.MOCK_PASSWORD ?? 'mock'

const account = { id: 1, username: 'wayne' }
const tokens = new Set()

const modules = [
  {
    name: 'folio',
    title: 'Folio',
    description: 'The budget: accounts, transactions, envelopes, goals, reports and the calculator.',
  },
]

// ── the folio module's data ────────────────────────────────────────────────────────────
// One object per collection, keyed by country, exactly as the real API keeps them.
// Nothing is saved between runs: this is for looking at the site, not for keeping a budget.

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

const workspace = new Map()
const settings = new Map()

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

function bearer(request) {
  const header = request.headers.authorization ?? ''
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null
}

const signedIn = (request) => {
  const token = bearer(request)
  return token !== null && tokens.has(token)
}

/** The folio module's endpoints. Returns true when it answered. */
async function folioModule(request, response, route, url) {
  if (route === 'GET /api/folio/settings') {
    const saved = settings.get(account.id)

    if (!saved) {
      response.writeHead(204).end()
      return true
    }

    json(response, 200, saved)
    return true
  }

  if (route === 'PUT /api/folio/settings') {
    const body = await readJson(request)

    if (!body) {
      json(response, 400, { error: 'Those settings could not be read.' })
      return true
    }

    settings.set(account.id, body)
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

  if (route === 'POST /api/core/auth/login') {
    const body = await readJson(request)

    if (!body) return json(response, 400, { error: 'A username and a password are needed.' })

    const username = String(body.username ?? '').trim()
    const password = String(body.password ?? '')

    if (username.length === 0 || password.length === 0) {
      return json(response, 400, { error: 'A username and a password are needed.' })
    }

    if (username !== account.username || password !== PASSWORD) {
      return json(response, 401, { error: 'That username and password do not match an account.' })
    }

    const token = randomUUID()
    tokens.add(token)

    return json(response, 200, {
      token,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      username: account.username,
    })
  }

  if (route === 'POST /api/core/auth/logout') {
    const token = bearer(request)
    if (token) tokens.delete(token)
    response.writeHead(204).end()
    return
  }

  if (route === 'GET /api/core/auth/me') {
    return signedIn(request) ? json(response, 200, account) : json(response, 401, { error: 'Not signed in.' })
  }

  if (!signedIn(request)) return json(response, 401, { error: 'Not signed in.' })

  if (route === 'GET /api/core/modules') return json(response, 200, modules)

  for (const handler of moduleHandlers) {
    if (await handler(request, response, route, url)) return
  }

  json(response, 404, { error: `Nothing answers ${route} in the mock.` })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock API on http://127.0.0.1:${PORT} (user '${account.username}', password '${PASSWORD}')`)
})
