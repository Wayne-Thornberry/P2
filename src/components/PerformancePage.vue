<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted, onMounted } from 'vue'
import { Chart, registerables } from 'chart.js'
import { useTransactionStore }         from '../stores/transactionStore'
import { useBudgetStore }              from '../stores/budgetStore'
import { useSettingsStore }            from '../stores/settingsStore'
import { useUpcomingTransactionStore } from '../stores/upcomingTransactionStore'

Chart.register(...registerables)

const emit = defineEmits<{ (e: 'navigate', page: string): void }>()

const txStore      = useTransactionStore()
const budgetStore  = useBudgetStore()
const settings     = useSettingsStore()
const upStore      = useUpcomingTransactionStore()

function fmt(v: number): string { return settings.formatMoney(v) }

const isDark = computed(() => settings.isDark)

// ── Month helpers ─────────────────────────────────────────────
function monthStr(offset: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(settings.locale, { month: 'short', year: '2-digit' })
}

const MONTHS = Array.from({ length: 6 }, (_, i) => monthStr(i - 5))

interface MonthStats {
  ym: string; label: string; income: number; expenses: number; net: number; savingsRate: number
}

const monthStats = computed((): MonthStats[] =>
  MONTHS.map(ym => {
    const txs      = txStore.transactions.filter(t => t.date.startsWith(ym))
    const income   = txs.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0)
    const expenses = txs.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0)
    const net      = Math.round((income - expenses) * 100) / 100
    const savingsRate = income > 0 ? Math.round(((income - expenses) / income) * 100) : 0
    return { ym, label: monthLabel(ym), income, expenses, net, savingsRate }
  })
)

const currentMonthStats = computed(() => monthStats.value[monthStats.value.length - 1])

const rolling3 = computed(() => {
  const last3 = monthStats.value.slice(-3).filter(m => m.income > 0 || m.expenses > 0)
  if (last3.length === 0) return { income: 0, expenses: 0, savingsRate: 0 }
  const income   = Math.round(last3.reduce((s, m) => s + m.income,   0) / last3.length * 100) / 100
  const expenses = Math.round(last3.reduce((s, m) => s + m.expenses, 0) / last3.length * 100) / 100
  const savingsRate = income > 0 ? Math.round(((income - expenses) / income) * 100) : 0
  return { income, expenses, savingsRate }
})

const reserveMonths = computed(() => {
  const avgExp = rolling3.value.expenses
  if (avgExp <= 0) return null
  const balance = txStore.transactions.reduce((s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0)
  return Math.round((balance / avgExp) * 10) / 10
})

const budgetAdherence = computed(() => {
  const items = budgetStore.items
  if (items.length === 0) return null
  const now  = new Date()
  const map  = txStore.getMonthlyActivityMap(now.getFullYear(), now.getMonth() + 1)
  const over = items.filter(item => (map.get(item.id) ?? 0) > (item.assigned ?? 0)).length
  const total = items.length
  return { total, over, onTrack: total - over, pct: Math.round(((total - over) / total) * 100) }
})

const incomeTrend = computed(() => {
  const s = monthStats.value
  if (s.length < 2) return 'neutral' as const
  const t = s[s.length - 1].income, p = s[s.length - 2].income
  if (p === 0) return 'neutral' as const
  const d = ((t - p) / p) * 100
  return d > 3 ? 'up' as const : d < -3 ? 'down' as const : 'neutral' as const
})

const spendTrend = computed(() => {
  const s = monthStats.value
  if (s.length < 2) return 'neutral' as const
  const t = s[s.length - 1].expenses, p = s[s.length - 2].expenses
  if (p === 0) return 'neutral' as const
  const d = ((t - p) / p) * 100
  return d > 5 ? 'up' as const : d < -5 ? 'down' as const : 'neutral' as const
})

// ── Health Score ──────────────────────────────────────────────
const healthScore = computed(() => {
  let s = 0
  const sr = rolling3.value.savingsRate
  if      (sr >= 20) s += 35
  else if (sr >= 10) s += 25
  else if (sr >= 5)  s += 15
  else if (sr >= 0)  s += 8

  const r = reserveMonths.value ?? 0
  if      (r >= 6) s += 30
  else if (r >= 3) s += 22
  else if (r >= 1) s += 12
  else if (r > 0)  s += 4

  const noBudget = budgetAdherence.value === null
  if (!noBudget) {
    const p = budgetAdherence.value!.pct
    if      (p === 100) s += 20
    else if (p >= 75)   s += 15
    else if (p >= 50)   s += 8
    else                s += 2
  }

  const withIncome = monthStats.value.slice(-3).filter(m => m.income > 0).length
  if      (withIncome === 3) s += 15
  else if (withIncome === 2) s += 9
  else if (withIncome === 1) s += 4

  // No budget: scored out of 80, scale to 100 so max is still achievable
  if (noBudget) return Math.min(100, Math.max(0, Math.round(s / 80 * 100)))
  return Math.min(100, Math.max(0, s))
})

const healthGrade = computed(() => {
  const s = healthScore.value
  if (s >= 85) return { letter: 'A', label: 'Excellent',  color: '#10b981' }
  if (s >= 70) return { letter: 'B', label: 'Good',       color: '#22d3ee' }
  if (s >= 55) return { letter: 'C', label: 'Fair',       color: '#f59e0b' }
  if (s >= 40) return { letter: 'D', label: 'Needs Work', color: '#f97316' }
  return             { letter: 'F', label: 'Critical',    color: '#ef4444' }
})

const GAUGE_C = Math.PI * 52
const gaugeDash = computed(() => GAUGE_C * (1 - healthScore.value / 100))

// ── Insights ──────────────────────────────────────────────────
interface Insight {
  id: string; level: 'success' | 'info' | 'warning' | 'danger'
  icon: string; title: string; body: string
  action?: { label: string; page: string }
}

const insights = computed((): Insight[] => {
  const list: Insight[] = []
  const sr  = rolling3.value.savingsRate
  const cur = currentMonthStats.value
  const res = reserveMonths.value

  if (cur.income === 0 && cur.expenses === 0) {
    list.push({ id: 'no-data', level: 'info', icon: 'pi-info-circle',
      title: 'No data yet for this month',
      body: 'Start recording transactions to see your financial health analysis.',
      action: { label: 'Go to Transactions', page: 'transactions' } })
  } else if (cur.savingsRate < 0) {
    list.push({ id: 'neg-save', level: 'danger', icon: 'pi-exclamation-circle',
      title: 'Spending more than you earn',
      body: `You spent ${fmt(cur.expenses - cur.income)} more than you earned this month. Review your expenses urgently.` })
  } else if (cur.savingsRate < 10) {
    list.push({ id: 'low-save', level: 'warning', icon: 'pi-arrow-up',
      title: `Low savings rate — ${cur.savingsRate}%`,
      body: `Financial experts recommend saving at least 20% of income. Try cutting discretionary spending to improve your rate.` })
  } else if (cur.savingsRate >= 20) {
    list.push({ id: 'good-save', level: 'success', icon: 'pi-check-circle',
      title: `Strong savings — ${cur.savingsRate}% saved`,
      body: `You're saving ${fmt(cur.net)} this month. Consider routing some of this to a savings goal for long-term growth.`,
      action: { label: 'View Savings Goals', page: 'savings' } })
  } else {
    list.push({ id: 'ok-save', level: 'info', icon: 'pi-arrow-circle-up',
      title: `Savings rate: ${cur.savingsRate}%`,
      body: `You're on the right track. Aim for 20%+ to build long-term financial resilience.` })
  }

  if (spendTrend.value === 'up' && cur.expenses > 0) {
    const prev = monthStats.value[monthStats.value.length - 2].expenses
    const delta = Math.abs(Math.round(((cur.expenses - prev) / prev) * 100))
    list.push({ id: 'spend-up', level: 'warning', icon: 'pi-chart-line',
      title: `Spending up ${delta}% vs last month`,
      body: `Expenses rose from ${fmt(prev)} to ${fmt(cur.expenses)}. Check your reports to find what changed.`,
      action: { label: 'View Reports', page: 'reports' } })
  } else if (spendTrend.value === 'down' && cur.expenses > 0) {
    const prev = monthStats.value[monthStats.value.length - 2].expenses
    const delta = Math.abs(Math.round(((cur.expenses - prev) / prev) * 100))
    list.push({ id: 'spend-down', level: 'success', icon: 'pi-chart-line',
      title: `Spending down ${delta}% vs last month`,
      body: `You cut expenses from ${fmt(prev)} to ${fmt(cur.expenses)}. This directly improves your savings rate.` })
  }

  if (incomeTrend.value === 'down' && cur.income > 0) {
    const prev = monthStats.value[monthStats.value.length - 2].income
    list.push({ id: 'income-down', level: 'warning', icon: 'pi-arrow-down',
      title: 'Income dipped vs last month',
      body: `Income fell from ${fmt(prev)} to ${fmt(cur.income)}. If expected, consider trimming spending to compensate.` })
  }

  if (res !== null) {
    if (res < 1) {
      list.push({ id: 'res-low', level: 'danger', icon: 'pi-shield',
        title: 'Emergency fund critically low',
        body: `Your balance covers less than 1 month of expenses. Build a reserve of 3–6 months (${fmt(rolling3.value.expenses * 3)}–${fmt(rolling3.value.expenses * 6)}).`,
        action: { label: 'Set a Savings Goal', page: 'savings' } })
    } else if (res < 3) {
      list.push({ id: 'res-build', level: 'warning', icon: 'pi-shield',
        title: `${res} months of reserves — keep building`,
        body: `You have ${res} months covered. The target is 3–6 months (${fmt(rolling3.value.expenses * 3)}).` })
    } else if (res >= 6) {
      list.push({ id: 'res-solid', level: 'success', icon: 'pi-shield',
        title: `${res} months of reserves — solid`,
        body: `Well-funded emergency reserve. Consider investing excess funds for long-term growth.` })
    }
  }

  if (budgetAdherence.value) {
    if (budgetAdherence.value.over === 0) {
      list.push({ id: 'budget-ok', level: 'success', icon: 'pi-wallet',
        title: 'All budget categories on track',
        body: `All ${budgetAdherence.value.total} budget categories are within budget this month.` })
    } else if (budgetAdherence.value.over <= 2) {
      list.push({ id: 'budget-minor', level: 'warning', icon: 'pi-wallet',
        title: `${budgetAdherence.value.over} budget ${budgetAdherence.value.over === 1 ? 'category' : 'categories'} over`,
        body: `${budgetAdherence.value.onTrack} of ${budgetAdherence.value.total} categories are on track. Review the overspent ones.`,
        action: { label: 'View Budget', page: 'budget' } })
    } else {
      list.push({ id: 'budget-bad', level: 'danger', icon: 'pi-wallet',
        title: `${budgetAdherence.value.over} budget categories overspent`,
        body: `${budgetAdherence.value.over} of ${budgetAdherence.value.total} categories are over. Reassign budget or reduce spending.`,
        action: { label: 'Fix Budget', page: 'budget' } })
    }
  } else {
    list.push({ id: 'no-budget', level: 'info', icon: 'pi-wallet',
      title: 'No budget configured',
      body: 'Setting a monthly budget is the most effective way to control spending and reach savings goals.',
      action: { label: 'Set Up Budget', page: 'budget' } })
  }

  const pending = upStore.pending
  if (pending.length > 0) {
    const totalDue = pending.filter(u => u.type === 'out').reduce((s, u) => s + u.amount, 0)
    list.push({ id: 'upcoming', level: totalDue > cur.income * 0.5 ? 'warning' : 'info', icon: 'pi-calendar',
      title: `${pending.length} upcoming transaction${pending.length !== 1 ? 's' : ''} pending`,
      body: `${fmt(totalDue)} in upcoming outgoings planned. Ensure your balance can cover them.`,
      action: { label: 'View Calendar', page: 'calendar' } })
  }

  const monthsWithData = monthStats.value.filter(m => m.income > 0).length
  if (monthsWithData >= 3 && sr !== cur.savingsRate) {
    if (cur.savingsRate > sr) {
      list.push({ id: 'trend-up', level: 'success', icon: 'pi-chart-line',
        title: 'Savings rate is improving',
        body: `3-month average is ${sr}%, but this month you're at ${cur.savingsRate}%. Keep it up.` })
    } else {
      list.push({ id: 'trend-down', level: 'warning', icon: 'pi-chart-line',
        title: 'Savings rate is declining',
        body: `3-month average is ${sr}%, but this month you're at only ${cur.savingsRate}%. This trend needs attention.` })
    }
  }

  return list.slice(0, 6)
})

// ── Charts ────────────────────────────────────────────────────
const trendCanvas = ref<HTMLCanvasElement | null>(null)
const srCanvas    = ref<HTMLCanvasElement | null>(null)
let trendChart: Chart | null = null
let srChart:    Chart | null = null

function buildTrendChart(): void {
  if (!trendCanvas.value) return
  trendChart?.destroy(); trendChart = null
  const dark      = isDark.value
  const grid      = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'
  const tickColor = dark ? '#a1a1aa' : '#71717a'
  trendChart = new Chart(trendCanvas.value, {
    type: 'bar',
    data: {
      labels: monthStats.value.map(m => m.label),
      datasets: [
        { label: 'Income',   type: 'bar',  data: monthStats.value.map(m => m.income),   backgroundColor: dark ? 'rgba(16,185,129,0.5)' : 'rgba(16,185,129,0.55)', borderColor: '#10b981', borderWidth: 1.5, borderRadius: 3, order: 2 },
        { label: 'Expenses', type: 'bar',  data: monthStats.value.map(m => m.expenses), backgroundColor: dark ? 'rgba(239,68,68,0.45)' : 'rgba(239,68,68,0.45)',   borderColor: '#ef4444', borderWidth: 1.5, borderRadius: 3, order: 2 },
        { label: 'Net',      type: 'line', data: monthStats.value.map(m => m.net),      borderColor: dark ? '#818cf8' : '#6366f1', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 3, tension: 0.3, order: 1 } as any,
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: tickColor, font: { size: 11, weight: 'bold' } } },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y ?? 0)}` } },
      },
      scales: {
        x: { grid: { color: grid }, ticks: { color: tickColor, font: { size: 11 } } },
        y: { grid: { color: grid }, ticks: { color: tickColor, font: { size: 11 }, callback: (v) => fmt(Number(v)) } },
      },
    },
  })
}

function buildSrChart(): void {
  if (!srCanvas.value) return
  srChart?.destroy(); srChart = null
  const dark      = isDark.value
  const grid      = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'
  const tickColor = dark ? '#a1a1aa' : '#71717a'
  const color     = healthGrade.value.color
  srChart = new Chart(srCanvas.value, {
    type: 'line',
    data: {
      labels: monthStats.value.map(m => m.label),
      datasets: [{ label: 'Savings Rate %', data: monthStats.value.map(m => m.savingsRate), borderColor: color, backgroundColor: color + '22', borderWidth: 2, pointRadius: 3, fill: true, tension: 0.3 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.y}%` } } },
      scales: {
        x: { grid: { color: grid }, ticks: { color: tickColor, font: { size: 11 } } },
        y: { grid: { color: grid }, ticks: { color: tickColor, font: { size: 11 }, callback: (v) => `${v}%` } },
      },
    },
  })
}

watch([monthStats, isDark], () => { nextTick(() => { buildTrendChart(); buildSrChart() }) }, { deep: true })
onMounted(() => nextTick(() => { buildTrendChart(); buildSrChart() }))
onUnmounted(() => { trendChart?.destroy(); srChart?.destroy() })
// ── Score breakdown ──────────────────────────────────────────────
const scoreBreakdown = computed(() => {
  const sr = rolling3.value.savingsRate
  const srPts = sr >= 20 ? 35 : sr >= 10 ? 25 : sr >= 5 ? 15 : sr >= 0 ? 8 : 0

  const r = reserveMonths.value ?? 0
  const rPts = r >= 6 ? 30 : r >= 3 ? 22 : r >= 1 ? 12 : r > 0 ? 4 : 0

  const ba = budgetAdherence.value
  const noBudget = ba === null
  const baPts = noBudget ? null : ba!.pct === 100 ? 20 : ba!.pct >= 75 ? 15 : ba!.pct >= 50 ? 8 : 2

  const withIncome = monthStats.value.slice(-3).filter(m => m.income > 0).length
  const icPts = withIncome === 3 ? 15 : withIncome === 2 ? 9 : withIncome === 1 ? 4 : 0

  return [
    {
      name: 'Savings Rate',
      max: 35,
      pts: srPts,
      excluded: false,
      value: `${sr}% (3-mo avg)`,
      detail: sr >= 20 ? 'Outstanding rate' : sr >= 10 ? 'Healthy rate' : sr >= 5 ? 'Low but positive' : sr >= 0 ? 'Barely breaking even' : 'Spending more than earning',
      howItWorks: '3-month rolling average. ≥20% = 35 pts · ≥10% = 25 · ≥5% = 15 · ≥0% = 8 · negative = 0',
    },
    {
      name: 'Emergency Reserve',
      max: 30,
      pts: rPts,
      excluded: false,
      value: reserveMonths.value !== null ? `${r} months` : 'No data',
      detail: r >= 6 ? 'Excellent buffer' : r >= 3 ? 'Solid cushion' : r >= 1 ? 'Minimal cover' : r > 0 ? 'Very thin' : 'No reserve',
      howItWorks: 'Balance ÷ avg monthly expenses. ≥6 mo = 30 pts · ≥3 = 22 · ≥1 = 12 · >0 = 4 · zero/negative = 0',
    },
    {
      name: 'Budget Adherence',
      max: 20,
      pts: baPts ?? 0,
      excluded: noBudget,
      value: noBudget ? 'No budget' : `${ba!.onTrack}/${ba!.total} on track`,
      detail: noBudget ? 'Excluded — other factors scaled to 100' : ba!.pct === 100 ? 'All categories under budget' : ba!.pct >= 75 ? 'Mostly on track' : ba!.pct >= 50 ? 'Over in several areas' : 'Many categories overspent',
      howItWorks: '% of budget categories not overspent. 100% = 20 pts · ≥75% = 15 · ≥50% = 8 · below = 2. No budget: factor excluded, remaining 80 pts scaled to 100.',
    },
    {
      name: 'Income Consistency',
      max: 15,
      pts: icPts,
      excluded: false,
      value: `${withIncome}/3 months with income`,
      detail: withIncome === 3 ? 'Consistent income' : withIncome === 2 ? 'Mostly consistent' : withIncome === 1 ? 'Irregular income' : 'No income recorded',
      howItWorks: 'Months with income recorded in the last 3. All 3 = 15 pts · 2 = 9 · 1 = 4 · none = 0',
    },
  ]
})
// ── Budget performance ────────────────────────────────────────
const budgetRows = computed(() => {
  const items = budgetStore.items
  if (items.length === 0) return []
  const now = new Date()
  const map = txStore.getMonthlyActivityMap(now.getFullYear(), now.getMonth() + 1)
  return items.map(item => {
    const activity = map.get(item.id) ?? 0
    const assigned = item.assigned ?? 0
    const variance = activity - assigned
    const pct      = assigned > 0 ? Math.min(200, Math.round((activity / assigned) * 100)) : (activity > 0 ? 100 : 0)
    const status   = activity > assigned ? 'over' : (activity === 0 && assigned > 0) ? 'empty' : 'ok'
    return { id: item.id, name: item.name, assigned, activity, variance, pct, status }
  }).sort((a, b) => b.pct - a.pct)
})

function barColor(pct: number): string {
  return pct >= 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#10b981'
}
</script>

<template>
  <div class="perf-root">

    <div class="perf-header">
      <div>
        <h1 class="perf-title">Financial Performance</h1>
        <p class="perf-subtitle">Your financial health at a glance</p>
      </div>
    </div>

    <!-- Health Score + Score Breakdown (side by side) -->
    <div class="perf-score-row">

      <!-- Score gauge (left) -->
      <div class="perf-score-card">
        <span class="perf-score-heading">Health Score</span>
        <div class="perf-gauge-wrap">
          <svg viewBox="0 0 128 80" class="perf-gauge-svg">
            <path d="M 12 72 A 52 52 0 0 1 116 72" fill="none" stroke-width="10" stroke-linecap="round" :stroke="isDark ? '#3f3f46' : '#e4e4e7'" />
            <path d="M 12 72 A 52 52 0 0 1 116 72" fill="none" stroke-width="10" stroke-linecap="round" :stroke="healthGrade.color" :stroke-dasharray="GAUGE_C" :stroke-dashoffset="gaugeDash" style="transition:stroke-dashoffset 0.6s ease,stroke 0.4s ease" />
            <text x="64" y="58" text-anchor="middle" :fill="healthGrade.color" font-size="22" font-weight="900" font-family="inherit">{{ healthScore }}</text>
            <text x="64" y="73" text-anchor="middle" fill="#a1a1aa" font-size="7.5" font-weight="700" letter-spacing="1" font-family="inherit">/ 100</text>
          </svg>
        </div>
        <div class="perf-grade-row" :style="{ color: healthGrade.color }">
          <span class="perf-grade-letter">{{ healthGrade.letter }}</span>
          <span class="perf-grade-label">{{ healthGrade.label }}</span>
        </div>
        <div class="perf-score-factors">
          <div class="perf-factor">
            <span class="perf-factor-label">Savings Rate</span>
            <span class="perf-factor-val" :class="rolling3.savingsRate >= 20 ? 'color-ok' : rolling3.savingsRate >= 10 ? 'color-warn' : 'color-bad'">{{ rolling3.savingsRate }}%</span>
          </div>
          <div class="perf-factor">
            <span class="perf-factor-label">Reserve</span>
            <span class="perf-factor-val" :class="(reserveMonths ?? 0) >= 3 ? 'color-ok' : (reserveMonths ?? 0) >= 1 ? 'color-warn' : 'color-bad'">
              {{ reserveMonths !== null ? reserveMonths + ' mo' : '—' }}
            </span>
          </div>
          <div class="perf-factor">
            <span class="perf-factor-label">Budget</span>
            <span class="perf-factor-val" :class="!budgetAdherence ? 'color-neutral' : budgetAdherence.over === 0 ? 'color-ok' : budgetAdherence.over <= 2 ? 'color-warn' : 'color-bad'">
              {{ budgetAdherence ? budgetAdherence.pct + '%' : '—' }}
            </span>
          </div>
        </div>
      </div>

      <!-- Score breakdown (right) -->
      <div class="perf-breakdown">
        <div v-for="row in scoreBreakdown" :key="row.name" class="perf-breakdown-row" :class="{ 'perf-breakdown-row--excluded': row.excluded }">
          <div class="perf-breakdown-top">
            <span class="perf-breakdown-name">{{ row.name }}</span>
            <span v-if="row.excluded" class="perf-breakdown-excluded-badge">excluded</span>
            <span v-else class="perf-breakdown-pts" :class="row.pts === row.max ? 'color-ok' : row.pts >= row.max * 0.5 ? 'color-warn' : 'color-bad'">{{ row.pts }}<span class="perf-breakdown-max">/{{ row.max }} pts</span></span>
          </div>
          <div v-if="!row.excluded" class="perf-breakdown-bar-track">
            <div class="perf-breakdown-bar-fill" :style="{ width: (row.pts / row.max * 100) + '%', background: row.pts === row.max ? '#16a34a' : row.pts >= row.max * 0.5 ? '#d97706' : '#dc2626' }" />
          </div>
          <div class="perf-breakdown-meta">
            <span class="perf-breakdown-value">{{ row.value }}</span>
            <span class="perf-breakdown-detail">{{ row.detail }}</span>
          </div>
          <p class="perf-breakdown-how">{{ row.howItWorks }}</p>
        </div>
        <div class="perf-breakdown-total">
          <div class="perf-breakdown-grades">
            <span style="color:#10b981"><strong>A</strong> 85–100</span>
            <span style="color:#22d3ee"><strong>B</strong> 70–84</span>
            <span style="color:#f59e0b"><strong>C</strong> 55–69</span>
            <span style="color:#f97316"><strong>D</strong> 40–54</span>
            <span style="color:#ef4444"><strong>F</strong> 0–39</span>
          </div>
          <span :style="{ color: healthGrade.color }" class="perf-breakdown-total-pts">{{ healthScore }}<span style="font-size:0.75rem;font-weight:500;color:inherit"> / 100</span></span>
        </div>
      </div>
    </div>

    <!-- Metrics -->
    <div class="perf-top-row">

      <!-- Metrics grid -->
      <div class="perf-metrics-grid">
        <div class="perf-metric-card">
          <span class="perf-metric-label">This Month Net</span>
          <span class="perf-metric-value" :class="currentMonthStats.net >= 0 ? 'color-ok' : 'color-bad'">{{ fmt(currentMonthStats.net) }}</span>
          <span class="perf-metric-sub">income minus expenses</span>
        </div>
        <div class="perf-metric-card">
          <span class="perf-metric-label">Savings Rate</span>
          <span class="perf-metric-value" :class="currentMonthStats.savingsRate >= 20 ? 'color-ok' : currentMonthStats.savingsRate >= 10 ? 'color-warn' : 'color-bad'">{{ currentMonthStats.savingsRate }}%</span>
          <span class="perf-metric-sub">3-mo avg: {{ rolling3.savingsRate }}%</span>
        </div>
        <div class="perf-metric-card">
          <span class="perf-metric-label">Monthly Income</span>
          <span class="perf-metric-value">{{ fmt(currentMonthStats.income) }}</span>
          <span class="perf-metric-sub perf-trend-sub">
            <i v-if="incomeTrend === 'up'" class="pi pi-arrow-up color-ok" />
            <i v-else-if="incomeTrend === 'down'" class="pi pi-arrow-down color-bad" />
            <i v-else class="pi pi-minus color-neutral" />
            vs last month
          </span>
        </div>
        <div class="perf-metric-card">
          <span class="perf-metric-label">Monthly Spend</span>
          <span class="perf-metric-value" :class="spendTrend === 'up' ? 'color-warn' : spendTrend === 'down' ? 'color-ok' : ''">{{ fmt(currentMonthStats.expenses) }}</span>
          <span class="perf-metric-sub perf-trend-sub">
            <i v-if="spendTrend === 'up'" class="pi pi-arrow-up color-warn" />
            <i v-else-if="spendTrend === 'down'" class="pi pi-arrow-down color-ok" />
            <i v-else class="pi pi-minus color-neutral" />
            vs last month
          </span>
        </div>
        <div class="perf-metric-card">
          <span class="perf-metric-label">Emergency Reserve</span>
          <span class="perf-metric-value" :class="(reserveMonths ?? 0) >= 3 ? 'color-ok' : (reserveMonths ?? 0) >= 1 ? 'color-warn' : 'color-bad'">
            {{ reserveMonths !== null ? reserveMonths + ' mo' : '—' }}
          </span>
          <span class="perf-metric-sub">of avg monthly expenses</span>
        </div>
        <div class="perf-metric-card">
          <span class="perf-metric-label">Budget Adherence</span>
          <span class="perf-metric-value" :class="!budgetAdherence ? 'color-neutral' : budgetAdherence.over === 0 ? 'color-ok' : budgetAdherence.over <= 2 ? 'color-warn' : 'color-bad'">
            {{ budgetAdherence ? budgetAdherence.pct + '%' : '—' }}
          </span>
          <span class="perf-metric-sub">{{ budgetAdherence ? `${budgetAdherence.onTrack}/${budgetAdherence.total} on track` : 'No budget set' }}</span>
        </div>
      </div>
    </div>

    <!-- Insights -->
    <div class="perf-section">
      <h2 class="perf-section-title"><i class="pi pi-lightbulb" /> Insights &amp; Recommendations</h2>
      <div class="perf-insights-grid">
        <div v-for="ins in insights" :key="ins.id" class="perf-insight" :class="`perf-insight--${ins.level}`">
          <div class="perf-insight-top">
            <i :class="`pi ${ins.icon} perf-insight-icon`" />
            <span class="perf-insight-title">{{ ins.title }}</span>
          </div>
          <p class="perf-insight-body">{{ ins.body }}</p>
          <button v-if="ins.action" class="perf-insight-action" @click="emit('navigate', ins.action.page)">
            {{ ins.action.label }} <i class="pi pi-arrow-right" />
          </button>
        </div>
      </div>
    </div>

    <!-- 6-Month Chart -->
    <div class="perf-section">
      <h2 class="perf-section-title"><i class="pi pi-chart-bar" /> 6-Month Cash Flow</h2>
      <div class="perf-chart-wrap">
        <canvas ref="trendCanvas" />
      </div>
    </div>

    <!-- Savings Rate Trend -->
    <div class="perf-section">
      <h2 class="perf-section-title"><i class="pi pi-chart-line" /> Savings Rate Trend</h2>
      <div class="perf-chart-wrap perf-chart-wrap--sm">
        <canvas ref="srCanvas" />
      </div>
    </div>

    <!-- Budget Performance -->
    <div v-if="budgetRows.length > 0" class="perf-section">
      <h2 class="perf-section-title"><i class="pi pi-wallet" /> Budget Performance — This Month</h2>
      <div class="perf-budget-table">
        <div class="perf-budget-row perf-budget-row--header">
          <span class="perf-bud-name">Category</span>
          <span class="perf-bud-bar"></span>
          <span class="perf-bud-num">Assigned</span>
          <span class="perf-bud-num">Spent</span>
          <span class="perf-bud-num">Left</span>
        </div>
        <div v-for="row in budgetRows" :key="row.id" class="perf-budget-row" :class="row.status === 'over' ? 'perf-budget-row--over' : row.status === 'empty' ? 'perf-budget-row--empty' : ''">
          <span class="perf-bud-name">{{ row.name }}</span>
          <span class="perf-bud-bar">
            <span class="perf-bar-track"><span class="perf-bar-fill" :style="{ width: Math.min(100, row.pct) + '%', background: barColor(row.pct) }" /></span>
            <span class="perf-bar-pct" :style="{ color: barColor(row.pct) }">{{ row.pct }}%</span>
          </span>
          <span class="perf-bud-num perf-muted">{{ fmt(row.assigned) }}</span>
          <span class="perf-bud-num">{{ fmt(row.activity) }}</span>
          <span class="perf-bud-num" :class="row.variance > 0 ? 'color-bad' : row.variance < 0 ? 'color-ok' : ''">
            {{ row.variance > 0 ? '-' : '+' }}{{ fmt(Math.abs(row.variance)) }}
          </span>
        </div>
      </div>
    </div>

  </div>
</template>
