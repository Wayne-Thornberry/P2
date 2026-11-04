// ── useDashboard ───────────────────────────────────────────────
// The Dashboard's numbers, as the API works them out.
//
// What is left on the page is layout and formatting: the totals, the balances, the
// spending lines and the budget's progress are one answer from one request, so two cards
// cannot disagree about what a month came to. It asks again when a save lands, which is
// when the answer can have changed.

import { computed, ref, watch } from 'vue'
import { api } from '../../../shared'
import { useMonthStore } from '../stores/monthStore'
import { useSettingsStore } from '../stores/settingsStore'
import { saved } from '../workspace'

export interface MonthTotals {
  income:      number
  expenses:    number
  net:         number
  savingsRate: number
  incomeCount:  number
  expenseCount: number
}

export interface AccountBalance {
  id:      string
  name:    string
  balance: number
}

export interface SpendingLine {
  name:  string
  total: number
}

export interface BudgetRow {
  id:        number
  name:      string
  assigned:  number
  activity:  number
  available: number
  pct:       number
}

export interface BudgetStatus {
  totalAssigned: number
  totalActivity: number
  overCount:     number
  onTrack:       number
  overallPct:    number
  topRows:       BudgetRow[]
}

export interface TransactionLine {
  id:        number
  name:      string
  date:      string
  accountId: string | null
  amount:    number
  type:      string
}

/** What the API answers for one month of the dashboard. */
export interface DashboardReport {
  totals:      MonthTotals
  accounts:    AccountBalance[]
  topSpending: SpendingLine[]
  budget:      BudgetStatus | null
  recent:      TransactionLine[]
}

const report = ref<DashboardReport | null>(null)

let inFlight: Promise<void> | null = null

async function load(month: string, budgetMonth: string): Promise<void> {
  if (inFlight) return inFlight

  const country = useSettingsStore().country
  if (!country) return

  const query = `country=${encodeURIComponent(country)}&month=${month}&budgetMonth=${budgetMonth}`

  inFlight = api
    .get<DashboardReport>(`/api/folio/dashboard?${query}`)
    .then((answer) => {
      report.value = answer
    })
    .catch((error: unknown) => {
      // A dashboard that could not be fetched keeps the last one on screen: a card that
      // reads zero is a claim about the budget, and this is not one.
      console.warn('[folio] the dashboard could not be read.', error)
    })
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

export function useDashboard(month: () => string) {
  const settings   = useSettingsStore()
  const monthStore = useMonthStore()

  const budgeted = () => `${monthStore.activeYear}-${String(monthStore.activeMonth).padStart(2, '0')}`

  watch(
    [month, budgeted, () => settings.country, saved],
    () => void load(month(), budgeted()),
    { immediate: true },
  )

  return {
    totals:      computed((): MonthTotals => report.value?.totals ?? { income: 0, expenses: 0, net: 0, savingsRate: 0, incomeCount: 0, expenseCount: 0 }),
    accounts:    computed((): AccountBalance[] => report.value?.accounts ?? []),
    totalFunds:  computed((): number => (report.value?.accounts ?? []).reduce((sum, account) => sum + account.balance, 0)),
    topSpending: computed((): SpendingLine[] => report.value?.topSpending ?? []),
    budget:      computed((): BudgetStatus | null => report.value?.budget ?? null),
    recent:      computed((): TransactionLine[] => report.value?.recent ?? []),
  }
}
