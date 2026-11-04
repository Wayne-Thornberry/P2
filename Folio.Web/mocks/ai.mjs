// The two AI features, faked.
//
// The real API asks DeepSeek and gets a report or a set of assignments back. Nothing here
// asks anything: the numbers are worked out from the same in-memory budget the rest of the
// mock serves, and the words are canned. The point is that the answer has the same shape,
// so the page can be built and used with no key, no network and no bill.

/** Whether the fake box offers the AI. It always does, so both buttons can be tried. */
export function aiStatus() {
  return { available: true, model: 'mock-deepseek' }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function monthKey(date) {
  return typeof date === 'string' ? date.slice(0, 7) : ''
}

function round(value) {
  return Math.round(value * 100) / 100
}

function share(part, whole) {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10
}

/** The report, from the workspace the mock is serving. */
export function analysisReport(workspace, requested) {
  const transactions = workspace.folio_transactions?.transactions ?? []
  const items = workspace.folio_budget?.globalItems ?? []
  const accounts = workspace.folio_accounts?.accounts ?? []
  const wanted = Array.isArray(requested?.accounts) ? requested.accounts : []

  const names = new Map(items.map((item) => [item.id, item.name]))
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]))

  const rows = transactions.filter((row) => wanted.length === 0 || wanted.includes(row.accountId))
  const spending = rows.filter((row) => row.type === 'out')
  const income = rows.filter((row) => row.type === 'in')

  const totalIn = round(income.reduce((sum, row) => sum + row.amount, 0))
  const totalOut = round(spending.reduce((sum, row) => sum + row.amount, 0))

  const months = [...new Set(rows.map((row) => monthKey(row.date)))]
    .filter(Boolean)
    .sort()
    .slice(-12)

  const byMonth = months.map((month) => ({
    month,
    in: round(income.filter((row) => monthKey(row.date) === month).reduce((sum, row) => sum + row.amount, 0)),
    out: round(spending.filter((row) => monthKey(row.date) === month).reduce((sum, row) => sum + row.amount, 0)),
    count: rows.filter((row) => monthKey(row.date) === month).length,
  }))

  const categories = [...new Set(spending.map((row) => row.itemId))]
    .map((itemId) => {
      const of = spending.filter((row) => row.itemId === itemId)

      return {
        itemId: itemId ?? null,
        name: itemId != null && names.has(itemId) ? names.get(itemId) : 'Uncategorised',
        spent: round(of.reduce((sum, row) => sum + row.amount, 0)),
        count: of.length,
        share: share(of.reduce((sum, row) => sum + row.amount, 0), totalOut),
        assigned: 0,
        category: null,
      }
    })
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 15)

  const merchants = [...new Set(spending.map((row) => row.name))]
    .map((name) => {
      const of = spending.filter((row) => row.name === name)

      return {
        name,
        spent: round(of.reduce((sum, row) => sum + row.amount, 0)),
        count: of.length,
        average: round(of.reduce((sum, row) => sum + row.amount, 0) / of.length),
        months: new Set(of.map((row) => monthKey(row.date))).size,
        last: of.map((row) => row.date).sort().at(-1) ?? '',
      }
    })
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 12)

  const byAccount = [...new Set(spending.map((row) => row.accountId))]
    .map((accountId) => {
      const of = spending.filter((row) => row.accountId === accountId)

      return {
        id: accountId ?? null,
        name: accountId != null && accountNames.has(accountId) ? accountNames.get(accountId) : 'Unassigned',
        in: round(income.filter((row) => row.accountId === accountId).reduce((sum, row) => sum + row.amount, 0)),
        out: round(of.reduce((sum, row) => sum + row.amount, 0)),
        count: of.length,
        share: share(of.reduce((sum, row) => sum + row.amount, 0), totalOut),
      }
    })
    .sort((a, b) => b.out - a.out)

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const weekdays = days.map((day) => {
    const of = spending.filter((row) => days[new Date(row.date).getDay()] === day)

    return {
      day,
      spent: round(of.reduce((sum, row) => sum + row.amount, 0)),
      count: of.length,
      share: share(of.reduce((sum, row) => sum + row.amount, 0), totalOut),
    }
  })

  const largest = [...spending]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)
    .map((row) => ({
      date: row.date,
      name: row.name,
      amount: round(row.amount),
      account: row.accountId != null && accountNames.has(row.accountId) ? accountNames.get(row.accountId) : 'Unassigned',
      item: row.itemId != null && names.has(row.itemId) ? names.get(row.itemId) : 'Uncategorised',
    }))

  const recurring = merchants
    .filter((merchant) => merchant.months >= 3)
    .slice(0, 10)
    .map((merchant) => ({
      name: merchant.name,
      amount: merchant.average,
      months: merchant.months,
      count: merchant.count,
      last: merchant.last,
    }))

  const top = categories[0]
  const busiest = [...byMonth].sort((a, b) => b.out - a.out)[0]

  return {
    generatedAt: new Date().toISOString(),
    model: 'mock-deepseek',
    period: {
      from: months.length ? `${months[0]}-01` : new Date().toISOString().slice(0, 10),
      to: new Date().toISOString().slice(0, 10),
      months: months.length || 1,
    },
    accounts: byAccount,
    facts: {
      currency: 'EUR',
      totals: {
        in: totalIn,
        out: totalOut,
        net: round(totalIn - totalOut),
        savingsRate: share(totalIn - totalOut, totalIn),
        averageOutPerMonth: byMonth.length ? round(totalOut / byMonth.length) : 0,
        transactions: rows.length,
        averageTransaction: spending.length ? round(totalOut / spending.length) : 0,
        uncategorised: spending.filter((row) => row.itemId == null).length,
      },
      months: byMonth,
      categories,
      merchants,
      accounts: byAccount,
      weekdays,
      largest,
      recurring,
      budget: {
        assigned: 0,
        spent: 0,
        overBudgetItems: 0,
        overspending: [],
        uncategorisedTransactions: spending.filter((row) => row.itemId == null).length,
        uncategorisedAmount: round(spending.filter((row) => row.itemId == null).reduce((sum, row) => sum + row.amount, 0)),
      },
      flaggedCount: spending.filter((row) => row.flagged).length,
      flaggedAmount: round(spending.filter((row) => row.flagged).reduce((sum, row) => sum + row.amount, 0)),
    },
    report: {
      headline: top
        ? `${top.name} is the biggest line at €${top.spent.toFixed(2)}, ${top.share}% of everything spent.`
        : 'There is not enough spending here to analyse yet.',
      summary: busiest
        ? `Over ${byMonth.length} months €${totalOut.toFixed(2)} went out against €${totalIn.toFixed(2)} coming in, a net of €${round(totalIn - totalOut).toFixed(2)}. ${MONTHS[Number(busiest.month.slice(5)) - 1]} was the heaviest at €${busiest.out.toFixed(2)}.`
        : 'Add some transactions and the report will have something to work with.',
      findings: top
        ? [
            {
              title: `${top.name} leads the spending`,
              detail: `${top.count} transactions came to €${top.spent.toFixed(2)}, ${top.share}% of the total.`,
              severity: top.share > 30 ? 'high' : 'medium',
            },
            {
              title: 'Money in against money out',
              detail: `€${totalIn.toFixed(2)} in and €${totalOut.toFixed(2)} out leaves ${share(totalIn - totalOut, totalIn)}% saved.`,
              severity: totalIn >= totalOut ? 'low' : 'high',
            },
          ]
        : [],
      patterns: [
        'This is the mock API: the figures are real, the words are canned.',
        busiest ? `Spending peaked in ${busiest.month} at €${busiest.out.toFixed(2)}.` : 'No month stands out yet.',
      ],
      risks: top && top.share > 25 ? [`${top.name} is a quarter of the budget on its own.`] : [],
      actions: ['Point the API at a DeepSeek key to get a real reading of these numbers.'],
    },
  }
}

/** The rules the fake categoriser knows; everything else is left for a person. */
const RULES = [
  [/tesco|aldi|lidl|dunnes|supervalu|grocer|spar|market/i, 'Groceries'],
  [/rent|landlord|mortgage/i, 'Rent'],
  [/electric|gas bill|water|broadband|internet|mobile|phone/i, 'Utilities'],
  [/fuel|petrol|diesel|circle k|applegreen|parking|leap|bus|train/i, 'Transport'],
  [/restaurant|cafe|coffee|takeaway|deliveroo|just eat|pub|bar/i, 'Eating Out'],
  [/netflix|spotify|disney|prime video|subscription|icloud|youtube/i, 'Subscriptions'],
  [/salary|payroll|wage/i, 'Salary'],
]

/** The assignments, each of which the page may then apply. */
export function categorise(body, items) {
  const existing = Array.isArray(body?.items) && body.items.length > 0
    ? body.items
    : (items ?? []).map((item) => ({ id: item.id, name: item.name }))

  const byName = new Map(existing.map((item) => [item.name.toLowerCase(), item]))

  const asked = Array.isArray(body?.transactions) ? body.transactions : []
  const assignments = []
  const newItems = []
  const unmatched = []

  for (const transaction of asked) {
    if (!transaction || typeof transaction.id !== 'number') continue

    const haystack = `${transaction.name ?? ''} ${transaction.notes ?? ''}`
    const rule = RULES.find(([pattern]) => pattern.test(haystack))

    if (!rule) {
      unmatched.push(transaction.id)
      continue
    }

    const wanted = rule[1]
    const known = byName.get(wanted.toLowerCase())

    if (known) {
      assignments.push({
        transactionId: transaction.id,
        itemId: known.id,
        itemName: known.name,
        isNew: false,
        confidence: 0.9,
        why: `matches ${wanted.toLowerCase()}`,
      })
      continue
    }

    if (newItems.length >= 8) {
      unmatched.push(transaction.id)
      continue
    }

    if (!newItems.some((name) => name.toLowerCase() === wanted.toLowerCase())) newItems.push(wanted)

    assignments.push({
      transactionId: transaction.id,
      itemId: null,
      itemName: wanted,
      isNew: true,
      confidence: 0.75,
      why: `no existing item fits; ${wanted.toLowerCase()} is the habit`,
    })
  }

  return { assignments, newItems, unmatched, considered: asked.length, items: existing }
}
