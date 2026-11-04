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

/**
 * The health score, worked out the way the API works it out.
 *
 * A mock that answered this with a fixed number would let the site look right while the
 * thing it shows is wrong, so the rules are repeated here in full: the six completed
 * months, the three-month savings rate, the reserve, the adherence, and the bands that
 * turn them into a score. Change one side and the other wants changing.
 */
function billableMonthKey(dateStr, startDay) {
  if (startDay <= 1) return dateStr.slice(0, 7)

  const [y, m, d] = dateStr.split('-').map(Number)

  if (d >= startDay) return `${y}-${String(m).padStart(2, '0')}`
  if (m === 1) return `${y - 1}-12`

  return `${y}-${String(m - 1).padStart(2, '0')}`
}

function shiftMonth(key, by) {
  const [y, m] = key.split('-').map(Number)
  const moved = new Date(y, m - 1 + by, 1)

  return `${moved.getFullYear()}-${String(moved.getMonth() + 1).padStart(2, '0')}`
}

function gradeOf(score) {
  if (score >= 85) return { letter: 'A', label: 'Excellent', color: '#10b981' }
  if (score >= 70) return { letter: 'B', label: 'Good', color: '#22d3ee' }
  if (score >= 55) return { letter: 'C', label: 'Fair', color: '#f59e0b' }
  if (score >= 40) return { letter: 'D', label: 'Needs Work', color: '#f97316' }

  return { letter: 'F', label: 'Critical', color: '#ef4444' }
}

function healthScore(savingsRate, reserveMonths, adherence, incomeConsistency) {
  let score = 0

  if (savingsRate >= 20) score += 35
  else if (savingsRate >= 10) score += 25
  else if (savingsRate >= 5) score += 15
  else if (savingsRate >= 0) score += 8

  const reserve = reserveMonths ?? 0
  if (reserve >= 6) score += 30
  else if (reserve >= 3) score += 22
  else if (reserve >= 1) score += 12
  else if (reserve > 0) score += 4

  if (adherence !== null) {
    if (adherence.pct === 100) score += 20
    else if (adherence.pct >= 75) score += 15
    else if (adherence.pct >= 50) score += 8
    else score += 2
  }

  if (incomeConsistency === 3) score += 15
  else if (incomeConsistency === 2) score += 9
  else if (incomeConsistency === 1) score += 4

  const finished = adherence === null ? Math.round((score / 80) * 100) : score

  return Math.min(100, Math.max(0, finished))
}

function healthReport(country, month) {
  const startDay = Number(settings.billableMonthStart ?? 1) || 1
  const blobs = countryWorkspace(country)
  const transactions = blobs.folio_transactions?.transactions ?? []
  const entries = blobs.folio_budget?.monthlyEntries ?? {}

  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const current = billableMonthKey(todayStr, startDay)
  const viewed = month ?? current

  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(current, i - 6))

  const totals = months.map((key) => {
    const inMonth = transactions.filter((t) => billableMonthKey(t.date, startDay) === key)

    return {
      income: inMonth.filter((t) => t.type === 'in').reduce((sum, t) => sum + t.amount, 0),
      expenses: inMonth.filter((t) => t.type === 'out').reduce((sum, t) => sum + t.amount, 0),
    }
  })

  const recent = totals.slice(-3).filter((m) => m.income > 0 || m.expenses > 0)
  const average = (key) => recent.reduce((sum, m) => sum + m[key], 0) / recent.length

  const rolling3 = recent.length === 0
    ? { income: 0, expenses: 0, savingsRate: 0 }
    : {
        income: average('income'),
        expenses: average('expenses'),
        savingsRate: 0,
      }

  if (recent.length > 0 && rolling3.income > 0) {
    rolling3.savingsRate = Math.round(((rolling3.income - rolling3.expenses) / rolling3.income) * 100)
  }

  const net = transactions.reduce((sum, t) => sum + (t.type === 'in' ? t.amount : -t.amount), 0)
  const reserveMonths = rolling3.expenses <= 0 ? null : Math.round((net / rolling3.expenses) * 10) / 10

  let lines = []
  for (let back = 0; back < 24; back++) {
    const [y, m] = shiftMonth(viewed, -back).split('-').map(Number)
    const monthEntries = entries[y]?.[m]

    if (monthEntries?.length) {
      lines = monthEntries
      break
    }
  }

  let budgetAdherence = null

  if (lines.length > 0) {
    const lastMonth = shiftMonth(current, -1)
    const spent = new Map()

    for (const t of transactions) {
      if (t.itemId === null || t.itemId === undefined) continue
      if (billableMonthKey(t.date, startDay) !== lastMonth) continue

      spent.set(t.itemId, (spent.get(t.itemId) ?? 0) + (t.type === 'out' ? t.amount : -t.amount))
    }

    const over = lines.filter((line) => (spent.get(line.itemId) ?? 0) > (line.assigned ?? 0)).length
    const total = lines.length

    budgetAdherence = { total, over, onTrack: total - over, pct: Math.round(((total - over) / total) * 100) }
  }

  const incomeConsistency = totals.slice(-3).filter((m) => m.income > 0).length
  const score = healthScore(rolling3.savingsRate, reserveMonths, budgetAdherence, incomeConsistency)

  return { score, grade: gradeOf(score), rolling3, reserveMonths, budgetAdherence, incomeConsistency }
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

  if (route === 'GET /api/folio/health') {
    if (!country) {
      json(response, 400, { error: 'A country is needed: ?country=ireland.' })
      return true
    }

    json(response, 200, healthReport(country, url.searchParams.get('month') ?? undefined))
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

  for (const handler of moduleHandlers) {
    if (await handler(request, response, route, url)) return
  }

  json(response, 404, { error: `Nothing answers ${route} in the mock.` })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock API on http://127.0.0.1:${PORT}, serving the example budget for 'ireland'`)
})
