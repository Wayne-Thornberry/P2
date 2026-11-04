// The data the mock API starts with.
//
// It is shaped exactly as the real API answers -- the same collection names, the same
// field names, the same id counters -- so the site cannot tell the difference and the
// stores hydrate from it unchanged. Everything here is invented; nothing is read from a
// database, because the mock is what a run serves when it is asked for `-Mock`.
//
// The dates are relative to today, so the budget is always for the current month and the
// last two, and the app never opens on an empty period.

const pad = (value) => String(value).padStart(2, '0')

const ymd = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`

/** The year and month `offset` months before this one. */
function monthAt(offset) {
  const now = new Date()
  const date = new Date(now.getFullYear(), now.getMonth() - offset, 1)
  return { year: date.getFullYear(), month: date.getMonth() + 1 }
}

/** A timestamp on a given day, so `createdAt` looks like something a person did. */
function momentAt(year, month, day, hour = 9, minute = 30) {
  return new Date(year, month - 1, day, hour, minute).toISOString()
}

// ── the budget's categories, ids and all ─────────────────────────────────────────────
// The same fixed 3000-range ids the app's own template uses, so a transaction's itemId
// stays meaningful whichever month it lands in.
const BUDGET = [
  { id: 3001, name: 'Salary', category: 'Income', assigned: 0 },
  { id: 3002, name: 'Other Income', category: 'Income', assigned: 0 },
  { id: 3101, name: 'Rent', category: 'Housing', assigned: 1450 },
  { id: 3102, name: 'Utilities', category: 'Housing', assigned: 180 },
  { id: 3201, name: 'Groceries', category: 'Food', assigned: 480 },
  { id: 3202, name: 'Eating Out', category: 'Food', assigned: 160 },
  { id: 3301, name: 'Transport', category: 'Transport', assigned: 120 },
  { id: 3701, name: 'Savings', category: 'Savings', assigned: 400 },
]

const ACCOUNTS = [
  { id: 'acc-1', name: 'Everyday Current', type: 'asset', bankId: 'boi' },
  { id: 'acc-2', name: 'Rainy Day Savings', type: 'savings' },
  { id: 'acc-3', name: 'Credit Card', type: 'liability' },
  { id: 'acc-4', name: 'Cash', type: 'asset' },
]

// [day, name, amount, type, itemId, accountId] — one month of ordinary life.
const MONTHLY = [
  [26, 'Transfer to savings', 400, 'out', 3701, 'acc-2'],
  [25, 'Salary', 3200, 'in', 3001, 'acc-1'],
  [24, 'Tesco', 73.28, 'out', 3201, 'acc-1'],
  [21, 'Coffee', 4.2, 'out', 3202, 'acc-4'],
  [19, 'Dublin Bus', 2.6, 'out', 3301, 'acc-4'],
  [18, 'SuperValu', 91.05, 'out', 3201, 'acc-1'],
  [15, 'Bunsen', 34.9, 'out', 3202, 'acc-3'],
  [13, 'Pharmacy', 12.75, 'out', null, 'acc-1'],
  [11, 'Lidl', 62.37, 'out', 3201, 'acc-1'],
  [9, 'Leap card top-up', 30, 'out', 3301, 'acc-1'],
  [7, 'The Fumbally', 18.5, 'out', 3202, 'acc-3'],
  [5, 'Virgin Media', 55, 'out', 3102, 'acc-1'],
  [4, 'Tesco', 84.12, 'out', 3201, 'acc-1'],
  [3, 'Electric Ireland', 96.4, 'out', 3102, 'acc-1'],
  [1, 'Rent', 1450, 'out', 3101, 'acc-1'],
]

/**
 * The transactions for one month, newest first, as the log displays them.
 *
 * `idStart` is passed in rather than counted here, so the ids run in one sequence across
 * the months and match the `nextId` handed to the client.
 */
function monthTransactions(offset, idStart) {
  const { year, month } = monthAt(offset)

  return MONTHLY.map(([day, name, amount, type, itemId, accountId], index) => ({
    id: idStart + index,
    name,
    date: ymd(year, month, day),
    createdAt: momentAt(year, month, day, 9 + (index % 9), (index * 7) % 60),
    amount,
    type,
    ...(itemId === null ? {} : { itemId }),
    accountId,
  }))
}

/** Three months of transactions, newest first, ids from 500. */
function transactions() {
  // A month has to be generated as a block, so the block ids are handed out in order and
  // then reversed for display.
  const blocks = [2, 1, 0].map((offset, blockIndex) => monthTransactions(offset, 500 + blockIndex * MONTHLY.length))
  return blocks.flat().reverse()
}

/** The envelope amounts for each of the three months. */
function monthlyEntries() {
  const entries = {}

  for (const offset of [2, 1, 0]) {
    const { year, month } = monthAt(offset)
    entries[year] ??= {}
    entries[year][month] = BUDGET.map((item) => ({
      itemId: item.id,
      assigned: item.assigned,
      category: item.category,
    }))
  }

  return entries
}

/** A day in a month `months` after this one. */
function ahead(months, day) {
  const { year, month } = monthAt(-months)
  return ymd(year, month, day)
}

const now = monthAt(0)

export function seedSettings() {
  return {
    theme: 'dark',
    locale: 'en-IE',
    currency: 'EUR',
    dateStyle: 'medium',
    timeStyle: '24h',
    country: 'ireland',
    billableMonthStart: 1,
  }
}

/** Everything the site keeps for one country, keyed as the API keys it. */
export function seedWorkspace(country) {
  if (country !== 'ireland') return {}

  return {
    folio_accounts: { accounts: ACCOUNTS, nextId: 5 },

    folio_transactions: { transactions: transactions(), nextId: 500 + MONTHLY.length * 3 },

    folio_upcoming: {
      items: [
        {
          id: 1,
          title: 'Rent',
          amount: 1450,
          type: 'out',
          date: ahead(1, 1),
          done: false,
          createdAt: momentAt(now.year, now.month, 1, 8, 0),
          recurring: 'monthly',
        },
        {
          id: 2,
          title: 'Car insurance',
          amount: 620,
          type: 'out',
          date: ahead(4, 15),
          notes: 'Renews once a year',
          done: false,
          createdAt: momentAt(now.year, now.month, 2, 8, 0),
          recurring: 'yearly',
        },
      ],
      nextId: 3,
    },

    folio_budget: {
      globalItems: BUDGET.map((item) => ({ id: item.id, name: item.name })),
      monthlyEntries: monthlyEntries(),
      nextId: 3702,
    },

    folio_template: {
      entries: BUDGET.map((item) => ({
        itemId: item.id,
        assigned: item.assigned,
        category: item.category,
      })),
    },

    folio_savings_goals: {
      goals: [
        {
          id: 1,
          name: 'Holiday fund',
          targetAmount: 2500,
          deadline: `${now.year + 1}-06-30`,
          color: '#6366f1',
          linkedAccountId: 'acc-2',
          contributions: [
            { id: 1, date: ymd(monthAt(2).year, monthAt(2).month, 26), amount: 400, note: 'Monthly transfer' },
            { id: 2, date: ymd(monthAt(1).year, monthAt(1).month, 26), amount: 400, note: 'Monthly transfer' },
            { id: 3, date: ymd(now.year, now.month, 26), amount: 400, note: 'Monthly transfer' },
          ],
          createdAt: momentAt(monthAt(2).year, monthAt(2).month, 1),
          archived: false,
        },
        {
          id: 2,
          name: 'New laptop',
          targetAmount: 1800,
          color: '#10b981',
          contributions: [
            { id: 4, date: ymd(monthAt(1).year, monthAt(1).month, 12), amount: 150, note: 'Sold the old one' },
          ],
          createdAt: momentAt(monthAt(1).year, monthAt(1).month, 12),
          archived: false,
        },
      ],
      nextGoalId: 3,
      nextContribId: 5,
    },

    folio_finance: {
      loans: [
        {
          id: 1,
          name: 'Car loan',
          principal: 12000,
          apr: 5.4,
          termMonths: 48,
          startDate: `${now.year - 1}-03-01`,
          color: '#f59e0b',
          createdAt: momentAt(now.year - 1, 3, 1),
          archived: false,
        },
      ],
      savings: [
        {
          id: 1,
          name: 'Rainy Day Savings',
          apr: 3.1,
          compoundFreq: 'monthly',
          startBalance: 4200,
          startDate: `${now.year - 2}-01-15`,
          linkedAccountId: 'acc-2',
          color: '#14b8a6',
          createdAt: momentAt(now.year - 2, 1, 15),
          archived: false,
        },
      ],
      nextLoanId: 2,
      nextSavId: 2,
    },

    folio_planner: {
      income: 3200,
      items: [
        { id: 1, name: 'Rent', amount: 1450 },
        { id: 2, name: 'Groceries', amount: 480 },
        { id: 3, name: 'Car loan', amount: 260 },
      ],
      simulations: [
        {
          id: 1,
          name: 'If I moved flat',
          month: `${now.year}-${pad(now.month)}`,
          items: [
            { id: 1, name: 'Income', amount: 3200, kind: 'income', source: 'custom' },
            { id: 2, name: 'Rent', amount: 1650, kind: 'expense', source: 'custom' },
            { id: 3, name: 'Groceries', amount: 480, kind: 'expense', source: 'planner', plannerItemId: 2 },
          ],
        },
      ],
      idealSimulationId: 1,
      nextId: 4,
      nextSimId: 2,
      nextSimItemId: 4,
    },

    folio_import_history: {
      imports: [
        {
          id: 1,
          date: momentAt(now.year, now.month, 24, 18, 5),
          bankName: 'Bank of Ireland',
          adapterId: 'boi',
          fileName: 'boi-statement.csv',
          rowCount: 37,
        },
      ],
      nextId: 2,
    },
  }
}
