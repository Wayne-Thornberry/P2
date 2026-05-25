// ── useHealthScore ─────────────────────────────────────────────
// Single source of truth for the financial health score shown on
// both the Performance page and the Dashboard widget.
// Uses a 3-month rolling window of completed months only — the
// current (incomplete) month is excluded from all metrics.

import { computed } from 'vue'
import { useTransactionStore } from '../stores/transactionStore'
import { useBudgetStore }      from '../stores/budgetStore'
import { useSettingsStore }    from '../stores/settingsStore'
import { billableMonthKey, currentBillableMonth, yearMonthKey } from '../utils/date'

/**
 * Generate the YYYY-MM key for a billable month at a given offset from the current one.
 * offset=0 → current billable month (excluded), offset=-1 → previous billable month, etc.
 */
function billableMonthStr(offset: number, startDay: number): string {
  const cur = currentBillableMonth(startDay)
  let y = cur.year
  let m = cur.month + offset
  while (m <= 0) { y--; m += 12 }
  while (m > 12)  { y++; m -= 12 }
  return yearMonthKey(y, m)
}

export interface HealthGrade {
  letter: string
  label:  string
  color:  string
}

export interface BudgetAdherence {
  total:   number
  over:    number
  onTrack: number
  pct:     number   // % on-track, 0–100
}

export function useHealthScore() {
  const txStore     = useTransactionStore()
  const budgetStore = useBudgetStore()
  const settings    = useSettingsStore()
  const startDay    = () => settings.billableMonthStart

  // ── Last 6 completed months (excludes current incomplete month) ──
  const MONTHS = computed(() => Array.from({ length: 6 }, (_, i) => billableMonthStr(i - 6, startDay())))

  const monthStats = computed(() =>
    MONTHS.value.map(ym => {
      const sd = startDay()
      const txs      = txStore.transactions.filter(t => billableMonthKey(t.date, sd) === ym)
      const income   = txs.filter(t => t.type === 'in').reduce((s, t)  => s + t.amount, 0)
      const expenses = txs.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0)
      return { ym, income, expenses }
    })
  )

  // 3-month rolling average (% savings rate as integer e.g. 34)
  const rolling3 = computed(() => {
    const last3 = monthStats.value.slice(-3).filter(m => m.income > 0 || m.expenses > 0)
    if (last3.length === 0) return { income: 0, expenses: 0, savingsRate: 0 }
    const income   = last3.reduce((s, m) => s + m.income,   0) / last3.length
    const expenses = last3.reduce((s, m) => s + m.expenses, 0) / last3.length
    const savingsRate = income > 0 ? Math.round(((income - expenses) / income) * 100) : 0
    return { income, expenses, savingsRate }
  })

  // Reserve months = net transaction balance / avg monthly expenses
  const reserveMonths = computed((): number | null => {
    const avgExp = rolling3.value.expenses
    if (avgExp <= 0) return null
    const balance = txStore.transactions.reduce(
      (s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0,
    )
    return Math.round((balance / avgExp) * 10) / 10
  })

  // Budget adherence — % of active items NOT overspent last completed billable month
  const budgetAdherence = computed((): BudgetAdherence | null => {
    const items = budgetStore.items
    if (items.length === 0) return null
    const cur = currentBillableMonth(startDay())
    let y = cur.year
    let m = cur.month - 1
    if (m <= 0) { y--; m += 12 }
    const map  = txStore.getMonthlyActivityMap(y, m)
    const over = items.filter(item => (map.get(item.id) ?? 0) > (item.assigned ?? 0)).length
    const total = items.length
    return { total, over, onTrack: total - over, pct: Math.round(((total - over) / total) * 100) }
  })

  // Income consistency — how many of the last 3 months had any income
  const incomeConsistency = computed((): number =>
    monthStats.value.slice(-3).filter(m => m.income > 0).length
  )

  // ── Score (max 100) ───────────────────────────────────────────
  const score = computed((): number => {
    let s = 0

    // Savings rate (35 pts) — based on 3-month rolling average
    const sr = rolling3.value.savingsRate
    if      (sr >= 20) s += 35
    else if (sr >= 10) s += 25
    else if (sr >= 5)  s += 15
    else if (sr >= 0)  s += 8

    // Emergency reserve (30 pts)
    const r = reserveMonths.value ?? 0
    if      (r >= 6) s += 30
    else if (r >= 3) s += 22
    else if (r >= 1) s += 12
    else if (r > 0)  s += 4

    // Budget adherence (20 pts) — excluded and scaled if no budget
    const noBudget = budgetAdherence.value === null
    if (!noBudget) {
      const p = budgetAdherence.value!.pct
      if      (p === 100) s += 20
      else if (p >= 75)   s += 15
      else if (p >= 50)   s += 8
      else                s += 2
    }

    // Income consistency (15 pts) — last 3 months
    const withIncome = incomeConsistency.value
    if      (withIncome === 3) s += 15
    else if (withIncome === 2) s += 9
    else if (withIncome === 1) s += 4

    // No budget: scored out of 80, scale to 100
    if (noBudget) return Math.min(100, Math.max(0, Math.round(s / 80 * 100)))
    return Math.min(100, Math.max(0, s))
  })

  const grade = computed((): HealthGrade => {
    const s = score.value
    if (s >= 85) return { letter: 'A', label: 'Excellent',  color: '#10b981' }
    if (s >= 70) return { letter: 'B', label: 'Good',       color: '#22d3ee' }
    if (s >= 55) return { letter: 'C', label: 'Fair',       color: '#f59e0b' }
    if (s >= 40) return { letter: 'D', label: 'Needs Work', color: '#f97316' }
    return             { letter: 'F', label: 'Critical',    color: '#ef4444' }
  })

  return { score, grade, rolling3, reserveMonths, budgetAdherence, incomeConsistency }
}
