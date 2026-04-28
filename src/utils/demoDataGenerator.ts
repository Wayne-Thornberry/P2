// ── Demo Data Generator ────────────────────────────────────────
// Populates all stores with realistic seed data for one of three personas.
// Call generateDemoData(config) from within a Vue component / setup context
// so that all Pinia stores are available.

import { useBudgetStore }      from '../stores/budgetStore'
import { useTransactionStore } from '../stores/transactionStore'
import { useAccountStore }     from '../stores/accountStore'
import { useTemplateStore }    from '../stores/templateStore'
import { useSavingsGoalStore } from '../stores/savingsGoalStore'
import { useLoanStore }        from '../stores/loanStore'
import type { SavingsAccountRecord } from '../stores/loanStore'

// ── Types ───────────────────────────────────────────────────────

export type DemoPersona = 'saver' | 'balanced' | 'indebted'

export interface DemoConfig {
  persona:              DemoPersona
  startYear:            number
  startMonth:           number
  endYear:              number
  endMonth:             number
  monthlyIncome:        number
  includeSavingsGoals:  boolean
  includeFinance:       boolean
}

export interface DemoResult {
  accountsCreated:       number
  budgetMonths:          number
  transactionsAdded:     number
  goalsCreated:          number
  loansCreated:          number
  financeSavingsCreated: number
}

// ── Static persona data ─────────────────────────────────────────

interface PersonaItem {
  name:     string
  category: string
  amounts:  Record<DemoPersona, number>
}

/** Budget items shared across all personas — amounts differ per persona. */
const ITEMS: PersonaItem[] = [
  // Housing
  { name: 'Rent / Mortgage',  category: 'Housing',       amounts: { saver:  950, balanced: 1150, indebted: 1400 } },
  { name: 'Utilities',        category: 'Housing',       amounts: { saver:   80, balanced:  110, indebted:  150 } },
  { name: 'Internet & Phone', category: 'Housing',       amounts: { saver:   85, balanced:   95, indebted:  120 } },
  // Food
  { name: 'Groceries',        category: 'Food',          amounts: { saver:  350, balanced:  400, indebted:  500 } },
  { name: 'Dining Out',       category: 'Food',          amounts: { saver:   70, balanced:  150, indebted:  280 } },
  // Transport
  { name: 'Fuel',             category: 'Transport',     amounts: { saver:   90, balanced:  110, indebted:  150 } },
  { name: 'Car Insurance',    category: 'Transport',     amounts: { saver:   95, balanced:  110, indebted:  130 } },
  // Health
  { name: 'Gym Membership',   category: 'Health',        amounts: { saver:   40, balanced:   40, indebted:   50 } },
  { name: 'Healthcare',       category: 'Health',        amounts: { saver:   30, balanced:   45, indebted:   80 } },
  // Entertainment
  { name: 'Streaming',        category: 'Entertainment', amounts: { saver:   20, balanced:   30, indebted:   55 } },
  { name: 'Going Out',        category: 'Entertainment', amounts: { saver:   50, balanced:   90, indebted:  180 } },
  // Personal
  { name: 'Clothing',         category: 'Personal',      amounts: { saver:   60, balanced:  100, indebted:  200 } },
  { name: 'Personal Care',    category: 'Personal',      amounts: { saver:   35, balanced:   50, indebted:   80 } },
]

/** Items that are direct-debit / fixed (linked to checking vs credit card). */
const FIXED_ITEM_NAMES = new Set([
  'Rent / Mortgage', 'Utilities', 'Internet & Phone', 'Car Insurance', 'Gym Membership', 'Streaming',
])

/** How much of the budgeted amount each persona actually spends. */
const SPEND_FACTOR: Record<DemoPersona, number> = {
  saver:    0.74,
  balanced: 0.97,
  indebted: 1.28,
}

interface AccountDef { name: string; type: 'asset' | 'liability' }

const ACCOUNT_DEFS: Record<DemoPersona, AccountDef[]> = {
  saver: [
    { name: 'Main Checking',      type: 'asset'     },
    { name: 'High-Yield Savings', type: 'asset'     },
    { name: 'Investment Account', type: 'asset'     },
    { name: 'Credit Card',        type: 'liability' },
  ],
  balanced: [
    { name: 'Checking Account', type: 'asset'     },
    { name: 'Savings Account',  type: 'asset'     },
    { name: 'Credit Card',      type: 'liability' },
  ],
  indebted: [
    { name: 'Current Account',       type: 'asset'     },
    { name: 'Credit Card Visa',      type: 'liability' },
    { name: 'Credit Card Mastercard',type: 'liability' },
    { name: 'Overdraft Account',     type: 'liability' },
  ],
}

// ── Savings goals ────────────────────────────────────────────────

interface GoalDef {
  name:           string
  target:         number
  openingBalance: number  // placed one month before period start
  monthlyContrib: number  // per month during period
}

const SAVINGS_GOAL_DEFS: Record<DemoPersona, GoalDef[]> = {
  saver: [
    { name: 'Emergency Fund', target: 15000, openingBalance: 12000, monthlyContrib: 200 },
    { name: 'House Deposit',  target: 50000, openingBalance: 12500, monthlyContrib: 500 },
    { name: 'Holiday Fund',   target:  3000, openingBalance:  2250, monthlyContrib: 100 },
  ],
  balanced: [
    { name: 'Emergency Fund', target: 10000, openingBalance: 4500, monthlyContrib: 100 },
    { name: 'Holiday Fund',   target:  2000, openingBalance:  600, monthlyContrib:  80 },
  ],
  indebted: [
    { name: 'Emergency Fund', target: 5000, openingBalance: 400, monthlyContrib: 30 },
  ],
}

// ── Loans ────────────────────────────────────────────────────────

interface LoanDef {
  name:       string
  principal:  number
  apr:        number
  termMonths: number
  monthsAgo:  number  // start date = period start minus this many months
}

const LOAN_DEFS: Record<DemoPersona, LoanDef[]> = {
  saver: [
    { name: 'Car Loan', principal: 15000, apr: 5.9, termMonths: 60, monthsAgo: 36 },
  ],
  balanced: [
    { name: 'Car Loan', principal: 18000, apr: 7.2, termMonths: 48, monthsAgo: 24 },
  ],
  indebted: [
    { name: 'Personal Loan',    principal: 12000, apr: 18.5, termMonths: 60, monthsAgo: 12 },
    { name: 'Credit Card Debt', principal:  4500, apr: 24.9, termMonths: 24, monthsAgo:  6 },
    { name: 'Car Finance',      principal: 20000, apr:  9.9, termMonths: 72, monthsAgo: 48 },
  ],
}

// ── Finance savings accounts ─────────────────────────────────────

interface FinSavDef {
  name:              string
  apr:               number
  compoundFreq:      SavingsAccountRecord['compoundFreq']
  balanceMultiplier: number  // × monthly income = opening balance
  monthsAgo:         number
}

const FINANCE_SAVINGS_DEFS: Record<DemoPersona, FinSavDef[]> = {
  saver: [
    { name: 'High-Yield Savings', apr: 4.5, compoundFreq: 'monthly',  balanceMultiplier: 18, monthsAgo: 24 },
  ],
  balanced: [
    { name: 'Regular Savings', apr: 2.5, compoundFreq: 'monthly',  balanceMultiplier: 6, monthsAgo: 12 },
  ],
  indebted: [],
}

// ── Helpers ──────────────────────────────────────────────────────

function _randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function _randAmount(base: number, noiseFraction = 0.1): number {
  const noise = (Math.random() * 2 - 1) * noiseFraction
  return Math.round(Math.max(0.01, base * (1 + noise)) * 100) / 100
}

function _pad(n: number): string { return String(n).padStart(2, '0') }

function _monthsBefore(year: number, month: number, count: number): { year: number; month: number } {
  const d = new Date(year, month - 1, 1)
  d.setMonth(d.getMonth() - count)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

function _dateStr(year: number, month: number, day: number): string {
  return `${year}-${_pad(month)}-${_pad(day)}`
}

/** Iterates from (startYear, startMonth) to (endYear, endMonth) inclusive. */
function* _iterMonths(sy: number, sm: number, ey: number, em: number) {
  let y = sy, m = sm
  while (y < ey || (y === ey && m <= em)) {
    yield { year: y, month: m }
    m++
    if (m > 12) { m = 1; y++ }
  }
}

// ── Main generator ────────────────────────────────────────────────

export function generateDemoData(config: DemoConfig): DemoResult {
  const budgetStore  = useBudgetStore()
  const txStore      = useTransactionStore()
  const accStore     = useAccountStore()
  const templateStore = useTemplateStore()
  const goalStore    = useSavingsGoalStore()
  const loanStore    = useLoanStore()

  const { persona, startYear, startMonth, endYear, endMonth, monthlyIncome } = config

  // ── 1. Accounts ──────────────────────────────────────────────
  const accountDefs = ACCOUNT_DEFS[persona]
  const createdIds: string[] = []
  for (const def of accountDefs) {
    const id = accStore.addAccount(def.name, def.type)
    createdIds.push(id)
  }
  const checkingId  = createdIds[0] ?? null
  const creditIdx   = accountDefs.findIndex(d => d.type === 'liability')
  const creditId    = creditIdx >= 0 ? createdIds[creditIdx] : null

  // ── 2. Template + global budget items ───────────────────────
  const itemIdMap = new Map<string, number>()  // name → globalItemId
  for (const item of ITEMS) {
    const gid = budgetStore.getOrCreateGlobalItem(item.name)
    itemIdMap.set(item.name, gid)
  }

  // Seed template from the persona's assigned amounts
  const templateItems = ITEMS.map(item => ({
    id:       itemIdMap.get(item.name)!,
    name:     item.name,
    category: item.category,
    assigned: item.amounts[persona],
  }))
  templateStore.$import(templateItems)

  // ── 3. Monthly budget entries ────────────────────────────────
  let budgetMonths = 0
  for (const { year, month } of _iterMonths(startYear, startMonth, endYear, endMonth)) {
    budgetStore.setMonthEntries(year, month, ITEMS.map(item => ({
      itemId:   itemIdMap.get(item.name)!,
      assigned: item.amounts[persona],
      category: item.category,
    })))
    budgetMonths++
  }

  // ── 4. Transactions ──────────────────────────────────────────
  const sf = SPEND_FACTOR[persona]
  let txAdded = 0

  for (const { year, month } of _iterMonths(startYear, startMonth, endYear, endMonth)) {
    const daysInMonth = new Date(year, month, 0).getDate()
    const mStr        = _pad(month)

    // Two salary paychecks per month
    const paycheck = Math.round(monthlyIncome / 2 * 100) / 100
    for (const payDay of [1, 15]) {
      const day = Math.min(payDay, daysInMonth)
      txStore.addTransaction({
        name:      'Salary',
        date:      `${year}-${mStr}-${_pad(day)}`,
        type:      'in',
        amount:    paycheck,
        itemId:    null,
        accountId: checkingId,
      })
      txAdded++
    }

    // Expense transactions for each budget item
    for (const item of ITEMS) {
      const itemId     = itemIdMap.get(item.name)!
      const baseTotal  = item.amounts[persona] * sf
      const isFixed    = FIXED_ITEM_NAMES.has(item.name)
      const txCount    = isFixed ? 1 : _randInt(1, item.amounts[persona] > 150 ? 2 : 3)
      const accountId  = isFixed ? checkingId : (creditId ?? checkingId)

      for (let t = 0; t < txCount; t++) {
        const day    = _randInt(isFixed ? 1 : 1, daysInMonth)
        const amount = _randAmount(baseTotal / txCount, 0.12)
        txStore.addTransaction({
          name:  item.name,
          date:  `${year}-${mStr}-${_pad(day)}`,
          type:  'out',
          amount,
          itemId,
          accountId,
        })
        txAdded++
      }
    }
  }

  // ── 5. Savings goals ─────────────────────────────────────────
  let goalsCreated = 0
  if (config.includeSavingsGoals) {
    const prevMonth = _monthsBefore(startYear, startMonth, 1)

    for (const gDef of SAVINGS_GOAL_DEFS[persona]) {
      const goal = goalStore.addGoal(gDef.name, gDef.target)

      // One opening contribution the month before the period starts
      if (gDef.openingBalance > 0) {
        goalStore.addContribution(
          goal.id,
          gDef.openingBalance,
          _dateStr(prevMonth.year, prevMonth.month, 28),
          'Opening balance',
        )
      }

      // Regular monthly contributions throughout the period
      if (gDef.monthlyContrib > 0) {
        for (const { year, month } of _iterMonths(startYear, startMonth, endYear, endMonth)) {
          goalStore.addContribution(
            goal.id,
            _randAmount(gDef.monthlyContrib, 0.05),
            _dateStr(year, month, 5),
          )
        }
      }
      goalsCreated++
    }
  }

  // ── 6. Finance: loans + savings accounts ─────────────────────
  let loansCreated = 0
  let financeSavingsCreated = 0

  if (config.includeFinance) {
    for (const lDef of LOAN_DEFS[persona]) {
      const sd = _monthsBefore(startYear, startMonth, lDef.monthsAgo)
      loanStore.addLoan(
        lDef.name,
        lDef.principal,
        lDef.apr,
        lDef.termMonths,
        _dateStr(sd.year, sd.month, 1),
      )
      loansCreated++
    }

    for (const sDef of FINANCE_SAVINGS_DEFS[persona]) {
      const sd = _monthsBefore(startYear, startMonth, sDef.monthsAgo)
      const openingBalance = Math.round(sDef.balanceMultiplier * monthlyIncome * 100) / 100
      loanStore.addSavingsAccount(
        sDef.name,
        sDef.apr,
        sDef.compoundFreq,
        openingBalance,
        _dateStr(sd.year, sd.month, 1),
      )
      financeSavingsCreated++
    }
  }

  return {
    accountsCreated:       createdIds.length,
    budgetMonths,
    transactionsAdded:     txAdded,
    goalsCreated,
    loansCreated,
    financeSavingsCreated,
  }
}
