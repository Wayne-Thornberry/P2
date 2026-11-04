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
import { demoRefusal, demoWorkspace } from './demo.mjs'
import { readStatement, statementRefusal } from './statement.mjs'

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

/**
 * The dashboard's numbers, worked out the way the API works them out.
 *
 * Same reason as the health score: a mock that answered with a plausible-looking constant
 * would let the page look right while the thing it shows is wrong. Every rule the API
 * applies is repeated here -- which accounts the budget ignores, how a spending line is
 * grouped, how a budget line's percentage is capped.
 */
const roundCents = (value) => Math.round(value * 100) / 100

function ignoredAccounts(accounts) {
  return new Set(
    accounts
      .filter((account) => account.archived === true || (account.excludeFromBudget ?? account.type === 'liability'))
      .map((account) => account.id),
  )
}

function dashboardReport(country, month, budgetMonth) {
  const blobs = countryWorkspace(country)
  const transactions = blobs.folio_transactions?.transactions ?? []
  const accounts = blobs.folio_accounts?.accounts ?? []
  const budget = blobs.folio_budget ?? {}
  const startDay = Number(settings.billableMonthStart ?? 1) || 1

  const today = new Date()
  const currentKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const shown = month ?? currentKey
  const budgeted = budgetMonth ?? currentKey

  const ignored = ignoredAccounts(accounts)
  const inMonth = transactions.filter((t) => t.date.slice(0, 7) === shown)
  const spent = inMonth.filter((t) => !t.accountId || !ignored.has(t.accountId))

  const income = spent.filter((t) => t.type === 'in').reduce((sum, t) => sum + t.amount, 0)
  const expenses = spent.filter((t) => t.type === 'out').reduce((sum, t) => sum + t.amount, 0)
  const net = income - expenses

  const totals = {
    income: roundCents(income),
    expenses: roundCents(expenses),
    net: roundCents(net),
    savingsRate: income > 0 ? Math.round(((income - expenses) / income) * 100) : 0,
    incomeCount: spent.filter((t) => t.type === 'in').length,
    expenseCount: spent.filter((t) => t.type === 'out').length,
  }

  const balances = new Map()
  let unassigned = 0
  let anyUnassigned = false

  for (const t of transactions) {
    const delta = t.type === 'in' ? t.amount : -t.amount

    if (t.accountId) balances.set(t.accountId, (balances.get(t.accountId) ?? 0) + delta)
    else {
      unassigned += delta
      anyUnassigned = true
    }
  }

  const accountRows = accounts.map((account) => ({
    id: account.id,
    name: account.name,
    balance: roundCents(balances.get(account.id) ?? 0),
  }))

  if (anyUnassigned) accountRows.push({ id: '__unassigned__', name: 'Unassigned', balance: roundCents(unassigned) })

  const byName = new Map()
  for (const t of spent) {
    if (t.type !== 'out') continue
    byName.set(t.name, (byName.get(t.name) ?? 0) + t.amount)
  }

  const topSpending = [...byName.entries()]
    .map(([name, total]) => ({ name, total: roundCents(total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)

  let lines = []
  for (let back = 0; back < 24; back++) {
    const [y, m] = shiftMonth(budgeted, -back).split('-').map(Number)
    const entries = budget.monthlyEntries?.[y]?.[m]

    if (entries?.length) {
      lines = entries
      break
    }
  }

  let budgetStatus = null

  if (lines.length > 0) {
    const names = new Map((budget.globalItems ?? []).map((item) => [item.id, item.name]))
    const activity = new Map()

    for (const t of transactions) {
      if (t.itemId === null || t.itemId === undefined) continue
      if (billableMonthKey(t.date, startDay) !== budgeted) continue

      activity.set(t.itemId, (activity.get(t.itemId) ?? 0) + (t.type === 'out' ? t.amount : -t.amount))
    }

    const rows = lines.map((line) => {
      const used = activity.get(line.itemId) ?? 0
      const assigned = line.assigned ?? 0

      return {
        id: line.itemId,
        name: names.get(line.itemId) ?? '',
        assigned: roundCents(assigned),
        activity: roundCents(used),
        available: roundCents(assigned - used),
        pct: assigned > 0 ? Math.min(100, Math.round((used / assigned) * 100)) : used > 0 ? 100 : 0,
      }
    })

    const totalAssigned = roundCents(rows.reduce((sum, row) => sum + row.assigned, 0))
    const totalActivity = roundCents(rows.reduce((sum, row) => sum + row.activity, 0))

    budgetStatus = {
      totalAssigned,
      totalActivity,
      overCount: rows.filter((row) => row.available < 0).length,
      onTrack: rows.filter((row) => row.available >= 0).length,
      overallPct: totalAssigned > 0 ? Math.min(100, Math.round((totalActivity / totalAssigned) * 100)) : 0,
      topRows: rows.slice().sort((a, b) => b.pct - a.pct || a.id - b.id).slice(0, 5),
    }
  }

  const recent = transactions
    .slice()
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, 8)
    .map((t) => ({ id: t.id, name: t.name, date: t.date, accountId: t.accountId ?? null, amount: t.amount, type: t.type }))

  return { totals, accounts: accountRows, topSpending, budget: budgetStatus, recent }
}

/**
 * The loans and savings accounts, worked out the way the API works them out.
 *
 * Same arithmetic, same order of rounding: the schedule runs on the exact payment and only
 * shows it rounded, and money is rounded to cents with Math.round, which is what the API
 * does too.
 */
const roundToCents = (value) => Math.round(value * 100) / 100

function exactPayment(loan) {
  const rate = loan.apr / 100 / 12
  const months = loan.termMonths

  if (months <= 0) return 0
  if (rate <= 0) return loan.principal / months

  const growth = Math.pow(1 + rate, months)

  return (loan.principal * rate * growth) / (growth - 1)
}

function amortization(loan) {
  const payment = exactPayment(loan)
  const rate = loan.apr / 100 / 12
  const start = new Date(`${loan.startDate}T00:00:00`)

  let balance = loan.principal
  const rows = []

  for (let month = 1; month <= loan.termMonths; month++) {
    const at = new Date(start)
    at.setMonth(at.getMonth() + month)

    const opening = balance
    const interest = balance * rate
    const principal = Math.min(payment - interest, balance)
    balance = Math.max(0, balance - principal)

    rows.push({
      month,
      date: `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`,
      openingBalance: roundToCents(opening),
      payment: roundToCents(payment),
      interestPaid: roundToCents(interest),
      principalPaid: roundToCents(principal),
      closingBalance: roundToCents(balance),
    })
  }

  return rows
}

function savingsProjection(saving, months) {
  const periodsPerYear = { monthly: 12, quarterly: 4, annually: 1 }[saving.compoundFreq] ?? 12
  const ratePerPeriod = saving.apr / 100 / periodsPerYear
  const periodsPerMonth = periodsPerYear / 12
  const start = new Date(`${saving.startDate}T00:00:00`)

  return Array.from({ length: Math.max(0, months) + 1 }, (_, i) => {
    const at = new Date(start)
    at.setMonth(at.getMonth() + i)

    return {
      date: `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`,
      balance: roundToCents(saving.startBalance * Math.pow(1 + ratePerPeriod, i * periodsPerMonth)),
    }
  })
}

function financeSummary(country) {
  const blobs = countryWorkspace(country)
  const loans = (blobs.folio_finance?.loans ?? []).filter((loan) => !loan.archived)
  const savings = (blobs.folio_finance?.savings ?? []).filter((saving) => !saving.archived)
  const transactions = blobs.folio_transactions?.transactions ?? []
  const today = new Date()
  const nowKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  const loanRows = loans.map((loan) => {
    const rows = amortization(loan)
    const next = rows.find((row) => row.date >= nowKey)
    const remaining = next?.openingBalance ?? loan.principal

    return {
      id: loan.id,
      name: loan.name,
      color: loan.color,
      apr: loan.apr,
      principal: loan.principal,
      remaining,
      pctPaid: loan.principal > 0 ? Math.round(((loan.principal - remaining) / loan.principal) * 100) : 100,
      monthlyPayment: roundToCents(exactPayment(loan)),
      payoffMonth: rows.length > 0 ? rows[rows.length - 1].date : '',
    }
  })

  const savingsRows = savings.map((saving) => {
    const elapsed = Math.max(
      0,
      (today.getFullYear() - new Date(`${saving.startDate}T00:00:00`).getFullYear()) * 12 +
        (today.getMonth() - new Date(`${saving.startDate}T00:00:00`).getMonth()),
    )

    const projectedNow = saving.linkedAccountId
      ? roundToCents(
          transactions
            .filter((t) => t.accountId === saving.linkedAccountId)
            .reduce((sum, t) => sum + (t.type === 'in' ? t.amount : -t.amount), 0),
        )
      : savingsProjection(saving, elapsed).slice(-1)[0].balance

    return {
      id: saving.id,
      name: saving.name,
      color: saving.color,
      apr: saving.apr,
      startBalance: saving.startBalance,
      projectedNow,
      interestEarned: roundToCents(projectedNow - saving.startBalance),
      compoundFreq: saving.compoundFreq,
    }
  })

  const monthlyPayments = roundToCents(loanRows.reduce((sum, row) => sum + row.monthlyPayment, 0))
  const loanRemaining = roundToCents(loanRows.reduce((sum, row) => sum + row.remaining, 0))
  const projectedSavings = roundToCents(savingsRows.reduce((sum, row) => sum + row.projectedNow, 0))

  return {
    loans: loanRows,
    savings: savingsRows,
    totals: {
      monthlyPayments,
      loanRemaining,
      projectedSavings,
      netPosition: roundToCents(projectedSavings - loanRemaining),
    },
  }
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

  if (route === 'GET /api/folio/dashboard') {    if (!country) {
      json(response, 400, { error: 'A country is needed: ?country=ireland.' })
      return true
    }

    json(
      response,
      200,
      dashboardReport(
        country,
        url.searchParams.get('month') ?? undefined,
        url.searchParams.get('budgetMonth') ?? undefined,
      ),
    )
    return true
  }

  if (route === 'GET /api/folio/finance/summary') {
    if (!country) {
      json(response, 400, { error: 'A country is needed: ?country=ireland.' })
      return true
    }

    json(response, 200, financeSummary(country))
    return true
  }

  if (route === 'POST /api/folio/demo') {
    if (!country) {
      json(response, 400, { error: 'A country is needed: ?country=ireland.' })
      return true
    }

    const body = await readJson(request)
    if (!body) {
      json(response, 400, { error: 'That request could not be read.' })
      return true
    }

    const refusal = demoRefusal(body)
    if (refusal) {
      json(response, 400, { error: refusal })
      return true
    }

    const { collections, result } = demoWorkspace(body)

    // Replaces the six budget collections and leaves the planner and the import history
    // alone, as the API does.
    workspace.set(country, { ...countryWorkspace(country), ...collections })

    json(response, 200, result)
    return true
  }

  if (route === 'POST /api/folio/import/statement') {
    const body = await readJson(request)
    if (!body) {
      json(response, 400, { error: 'That statement could not be read.' })
      return true
    }

    const refusal = statementRefusal(body)
    if (refusal) {
      json(response, 400, { error: refusal })
      return true
    }

    json(response, 200, readStatement(body))
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
