// The mock's demo budget.
//
// The rule lives in the API (Modules/Folio/DemoData.cs); this is the same rule again, in
// the shape the mock keeps, so the Settings page's "generate demo data" works with no
// database, no .NET and no SQL Server. Keep the two in step: same personas, same accounts,
// same budget lines, same three ways of spending.
//
// The amounts are random in both, so the numbers will not match the API's to the penny --
// what has to match is the shape of a demo budget, which is what the site reads.

const ITEMS = [
  { name: 'Rent / Mortgage',  category: 'Housing',       saver:  950, balanced: 1150, indebted: 1400 },
  { name: 'Utilities',        category: 'Housing',       saver:   80, balanced:  110, indebted:  150 },
  { name: 'Internet & Phone', category: 'Housing',       saver:   85, balanced:   95, indebted:  120 },
  { name: 'Groceries',        category: 'Food',          saver:  350, balanced:  400, indebted:  500 },
  { name: 'Dining Out',       category: 'Food',          saver:   70, balanced:  150, indebted:  280 },
  { name: 'Fuel',             category: 'Transport',     saver:   90, balanced:  110, indebted:  150 },
  { name: 'Car Insurance',    category: 'Transport',     saver:   95, balanced:  110, indebted:  130 },
  { name: 'Gym Membership',   category: 'Health',        saver:   40, balanced:   40, indebted:   50 },
  { name: 'Healthcare',       category: 'Health',        saver:   30, balanced:   45, indebted:   80 },
  { name: 'Streaming',        category: 'Entertainment', saver:   20, balanced:   30, indebted:   55 },
  { name: 'Going Out',        category: 'Entertainment', saver:   50, balanced:   90, indebted:  180 },
  { name: 'Clothing',         category: 'Personal',      saver:   60, balanced:  100, indebted:  200 },
  { name: 'Personal Care',    category: 'Personal',      saver:   35, balanced:   50, indebted:   80 },
]

const FIXED = new Set([
  'Rent / Mortgage', 'Utilities', 'Internet & Phone', 'Car Insurance', 'Gym Membership', 'Streaming',
])

const SPEND_FACTOR = { saver: 0.74, balanced: 0.97, indebted: 1.28 }

const ACCOUNTS = {
  saver: [
    ['Main Checking', 'asset'],
    ['High-Yield Savings', 'asset'],
    ['Investment Account', 'asset'],
    ['Credit Card', 'liability'],
  ],
  balanced: [
    ['Checking Account', 'asset'],
    ['Savings Account', 'asset'],
    ['Credit Card', 'liability'],
  ],
  indebted: [
    ['Current Account', 'asset'],
    ['Credit Card Visa', 'liability'],
    ['Credit Card Mastercard', 'liability'],
    ['Overdraft Account', 'liability'],
  ],
}

const GOALS = {
  saver: [
    ['Emergency Fund', 15000, 12000, 200],
    ['House Deposit', 50000, 12500, 500],
    ['Holiday Fund', 3000, 2250, 100],
  ],
  balanced: [
    ['Emergency Fund', 10000, 4500, 100],
    ['Holiday Fund', 2000, 600, 80],
  ],
  indebted: [
    ['Emergency Fund', 5000, 400, 30],
  ],
}

const LOANS = {
  saver: [['Car Loan', 15000, 5.9, 60, 36]],
  balanced: [['Car Loan', 18000, 7.2, 48, 24]],
  indebted: [
    ['Personal Loan', 12000, 18.5, 60, 12],
    ['Credit Card Debt', 4500, 24.9, 24, 6],
    ['Car Finance', 20000, 9.9, 72, 48],
  ],
}

const SAVINGS = {
  saver: [['High-Yield Savings', 4.5, 18, 24]],
  balanced: [['Regular Savings', 2.5, 6, 12]],
  indebted: [],
}

const GOAL_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#ec4899']
const LOAN_COLORS = ['#ef4444', '#f97316', '#6366f1', '#8b5cf6', '#ec4899', '#14b8a6', '#10b981', '#f59e0b']
const SAVINGS_COLORS = ['#10b981', '#14b8a6', '#6366f1', '#8b5cf6', '#f59e0b', '#f97316', '#ec4899', '#ef4444']

const FIRST_ACCOUNT_ID = 10
const FIRST_TRANSACTION_ID = 500
const FIRST_ITEM_ID = 2000
const MAX_MONTHS = 120

const pad = (value) => String(value).padStart(2, '0')
const date = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`
const cents = (value) => Math.round(value * 100) / 100

function monthsBetween(startYear, startMonth, endYear, endMonth) {
  const months = []
  const count = (endYear - startYear) * 12 + endMonth - startMonth + 1

  let year = startYear
  let month = startMonth

  for (let taken = 0; taken < count; taken++) {
    months.push({ year, month })
    if (++month > 12) {
      month = 1
      year++
    }
  }

  return months
}

function monthsBefore(year, month, count) {
  const from = new Date(year, month - 1, 1)
  from.setMonth(from.getMonth() - count)
  return { year: from.getFullYear(), month: from.getMonth() + 1 }
}

function noisy(amount, fraction) {
  const noise = (Math.random() * 2 - 1) * fraction
  return cents(Math.max(0.01, amount * (1 + noise)))
}

/** Why this request cannot be answered, or null when it can. */
export function demoRefusal(request) {
  const persona = (request.persona ?? '').trim().toLowerCase()

  if (persona && !['saver', 'balanced', 'indebted'].includes(persona))
    return 'A persona is one of: saver, balanced, indebted.'

  const income = Number(request.monthlyIncome)
  if (!(income >= 100 && income <= 999999)) return 'A monthly income is between 100 and 999999.'

  const { startYear, startMonth, endYear, endMonth } = request
  const year = (value) => Number.isInteger(value) && value >= 2000 && value <= 2100
  const month = (value) => Number.isInteger(value) && value >= 1 && value <= 12

  if (!year(startYear) || !year(endYear)) return 'A year is four digits, between 2000 and 2100.'
  if (!month(startMonth) || !month(endMonth)) return 'A month is 1 to 12.'

  const count = (endYear - startYear) * 12 + endMonth - startMonth + 1
  if (count < 1 || count > MAX_MONTHS) return `The period is one to ${MAX_MONTHS} months, starting before it ends.`

  return null
}

/** The collections a demo budget is made of, and what was made. */
export function demoWorkspace(request) {
  const persona = ['saver', 'balanced', 'indebted'].includes(request.persona) ? request.persona : 'balanced'
  const income = Number(request.monthlyIncome)
  const now = new Date().toISOString()
  const months = monthsBetween(request.startYear, request.startMonth, request.endYear, request.endMonth)

  const accounts = ACCOUNTS[persona].map(([name, type], index) => ({
    id: `acc-${FIRST_ACCOUNT_ID + index}`,
    name,
    type,
  }))

  const checkingId = accounts[0].id
  const credit = accounts.find((account) => account.type === 'liability')
  const creditId = credit ? credit.id : null

  const itemIds = new Map(ITEMS.map((item, index) => [item.name, FIRST_ITEM_ID + index]))
  const globalItems = ITEMS.map((item) => ({ id: itemIds.get(item.name), name: item.name }))
  const entryFor = (item) => ({
    itemId: itemIds.get(item.name),
    assigned: item[persona],
    category: item.category,
  })

  const monthlyEntries = {}
  for (const { year, month } of months) {
    monthlyEntries[year] ??= {}
    monthlyEntries[year][month] = ITEMS.map(entryFor)
  }

  const transactions = []
  let nextTransactionId = FIRST_TRANSACTION_ID
  const factor = SPEND_FACTOR[persona]

  for (const { year, month } of months) {
    const daysInMonth = new Date(year, month, 0).getDate()
    const paycheck = cents(income / 2)

    for (const payDay of [1, 15]) {
      transactions.push({
        id: nextTransactionId++,
        name: 'Salary',
        date: date(year, month, Math.min(payDay, daysInMonth)),
        createdAt: now,
        amount: paycheck,
        type: 'in',
        itemId: null,
        accountId: checkingId,
      })
    }

    for (const item of ITEMS) {
      const budgeted = item[persona]
      const fixedBill = FIXED.has(item.name)
      const count = fixedBill ? 1 : 1 + Math.floor(Math.random() * (budgeted > 150 ? 2 : 3))
      const accountId = fixedBill ? checkingId : creditId ?? checkingId

      for (let paid = 0; paid < count; paid++) {
        transactions.push({
          id: nextTransactionId++,
          name: item.name,
          date: date(year, month, 1 + Math.floor(Math.random() * daysInMonth)),
          createdAt: now,
          amount: noisy((budgeted * factor) / count, 0.12),
          type: 'out',
          itemId: itemIds.get(item.name),
          accountId,
        })
      }
    }
  }

  const goals = []
  let nextGoalId = 1
  let nextContribId = 1

  if (request.includeSavingsGoals) {
    const opening = monthsBefore(request.startYear, request.startMonth, 1)

    for (const [name, target, openingBalance, monthlyContrib] of GOALS[persona]) {
      const id = nextGoalId++
      const contributions = []

      if (openingBalance > 0) {
        contributions.push({
          id: nextContribId++,
          date: date(opening.year, opening.month, 28),
          amount: openingBalance,
          note: 'Opening balance',
        })
      }

      if (monthlyContrib > 0) {
        for (const { year, month } of months) {
          contributions.push({
            id: nextContribId++,
            date: date(year, month, 5),
            amount: noisy(monthlyContrib, 0.05),
          })
        }
      }

      contributions.sort((left, right) => right.date.localeCompare(left.date))

      goals.push({
        id,
        name,
        targetAmount: target,
        color: GOAL_COLORS[id % GOAL_COLORS.length],
        contributions,
        createdAt: now,
        archived: false,
      })
    }
  }

  const loans = []
  const savings = []
  let nextLoanId = 1
  let nextSavId = 1

  if (request.includeFinance) {
    for (const [name, principal, apr, termMonths, monthsAgo] of LOANS[persona]) {
      const start = monthsBefore(request.startYear, request.startMonth, monthsAgo)
      const id = nextLoanId++

      loans.push({
        id,
        name,
        principal,
        apr,
        termMonths,
        startDate: date(start.year, start.month, 1),
        color: LOAN_COLORS[id % LOAN_COLORS.length],
        createdAt: now,
        archived: false,
      })
    }

    for (const [name, apr, balanceMultiplier, monthsAgo] of SAVINGS[persona]) {
      const start = monthsBefore(request.startYear, request.startMonth, monthsAgo)
      const id = nextSavId++

      savings.push({
        id,
        name,
        apr,
        compoundFreq: 'monthly',
        startBalance: cents(balanceMultiplier * income),
        startDate: date(start.year, start.month, 1),
        color: SAVINGS_COLORS[id % SAVINGS_COLORS.length],
        createdAt: now,
        archived: false,
      })
    }
  }

  return {
    collections: {
      folio_accounts: { accounts, nextId: FIRST_ACCOUNT_ID + accounts.length },
      folio_transactions: { transactions, nextId: nextTransactionId },
      folio_budget: { globalItems, monthlyEntries, nextId: FIRST_ITEM_ID + ITEMS.length },
      folio_template: { entries: ITEMS.map(entryFor) },
      folio_savings_goals: { goals, nextGoalId, nextContribId },
      folio_finance: { loans, savings, nextLoanId, nextSavId },
    },
    result: {
      accountsCreated: accounts.length,
      budgetMonths: months.length,
      transactionsAdded: transactions.length,
      goalsCreated: goals.length,
      loansCreated: loans.length,
      financeSavingsCreated: savings.length,
    },
  }
}
