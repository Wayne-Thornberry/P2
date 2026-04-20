<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { Chart, registerables } from 'chart.js'
import { useTransactionStore } from '../stores/transactionStore'
import { useAccountStore } from '../stores/accountStore'
import { useBudgetStore } from '../stores/budgetStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useLoanStore } from '../stores/loanStore'

Chart.register(...registerables)

const txStore      = useTransactionStore()
const accountStore = useAccountStore()
const budgetStore  = useBudgetStore()
const settings     = useSettingsStore()
const loanStore    = useLoanStore()

function formatMoney(v: number): string { return settings.formatMoney(v) }

// ── Theme ──────────────────────────────────────────────────────
const isDark  = computed(() => ['dark', 'midnight', 'forest', 'purple'].includes(settings.theme))
const textClr = computed(() => isDark.value ? '#a1a1aa' : '#52525b')
const gridClr = computed(() => isDark.value ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)')

const PALETTE = [
  'rgb(99,102,241)',  'rgb(34,197,94)',  'rgb(249,115,22)', 'rgb(239,68,68)',
  'rgb(168,85,247)', 'rgb(20,184,166)', 'rgb(245,158,11)', 'rgb(236,72,153)',
]

// ── Navigation emit ───────────────────────────────────────────
const emit = defineEmits<{
  viewTransactions: [opts: { month?: string; accountId?: string; name?: string; type?: 'in' | 'out' }]
}>()

function goTx(opts: { month?: string; accountId?: string; name?: string; type?: 'in' | 'out' }): void {
  emit('viewTransactions', opts)
}

// ── Tabs ───────────────────────────────────────────────────────
type Tab = 'overall' | 'breakdown' | 'items' | 'finance'
const activeTab = ref<Tab>('overall')

type BreakdownSubTab = 'year' | 'accounts' | 'month' | 'range'
const breakdownSubTab = ref<BreakdownSubTab>('year')
const tabs: { id: Tab; label: string }[] = [
  { id: 'overall',   label: 'Overview'   },
  { id: 'breakdown', label: 'Breakdown'  },
  { id: 'items',     label: 'Items'      },
  { id: 'finance',   label: 'Finance'    },
]

// ── Shared month selector ──────────────────────────────────────
const _now    = new Date()
const _nowKey = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}`

const selectedMonthKey = ref(_nowKey)

// ── Year selectors ─────────────────────────────────────────────
const _currentYear = _now.getFullYear()
const yearViewYear = ref(_currentYear)

const availableYears = computed(() => {
  const years = new Set<number>()
  years.add(_currentYear)
  for (const t of txStore.transactions) years.add(parseInt(t.date.substring(0, 4)))
  return [...years].sort().reverse()
})

const availableMonthKeys = computed(() => {
  const keys = new Set<string>()
  keys.add(_nowKey)
  for (const t of txStore.transactions) keys.add(t.date.substring(0, 7))
  return [...keys].sort().reverse()
})

const breakdownMonthKeys = computed(() =>
  availableMonthKeys.value.filter(k => k.startsWith(String(yearViewYear.value)))
)

function monthKeyToLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(settings.locale, { month: 'long', year: 'numeric' })
}

function monthKeyShort(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(settings.locale, { month: 'short' })
}

function barColor(pct: number): string {
  if (pct >= 100) return 'rgb(239,68,68)'
  if (pct >= 80)  return 'rgb(245,158,11)'
  return 'rgb(34,197,94)'
}

// ──────────────────────────────────────────────────────────────
// YEARS TAB DATA (all-time, year-over-year)
// ──────────────────────────────────────────────────────────────
const totalIn  = computed(() => txStore.transactions.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0))
const totalOut = computed(() => txStore.transactions.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0))
const net      = computed(() => totalIn.value - totalOut.value)

const yearlyFlow = computed(() =>
  availableYears.value.slice().reverse().map(y => {
    const txs  = txStore.transactions.filter(t => t.date.startsWith(String(y)))
    const yIn  = txs.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0)
    const yOut = txs.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0)
    return { year: y, label: String(y), in: yIn, out: yOut }
  })
)

const yearlyNet = computed(() =>
  yearlyFlow.value.map(y => ({ label: y.label, year: y.year, net: Math.round((y.in - y.out) * 100) / 100 }))
)

const yearSummary = computed(() =>
  yearlyFlow.value.slice().reverse().map(y => ({
    year:        y.year,
    in:          y.in,
    out:         y.out,
    net:         Math.round((y.in - y.out) * 100) / 100,
    count:       txStore.transactions.filter(t => t.date.startsWith(String(y.year))).length,
    savingsRate: y.in > 0 ? Math.round(((y.in - y.out) / y.in) * 100) : 0,
  }))
)

// ──────────────────────────────────────────────────────────────
// YEAR VIEW TAB DATA (month-by-month for a selected year)
// ──────────────────────────────────────────────────────────────
const yearViewMonthlyFlow = computed(() => {
  const y = yearViewYear.value
  return Array.from({ length: 12 }, (_, i) => {
    const key  = `${y}-${String(i + 1).padStart(2, '0')}`
    const txs  = txStore.transactions.filter(t => t.date.startsWith(key))
    const mIn  = txs.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0)
    const mOut = txs.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0)
    const label = new Date(y, i, 1).toLocaleDateString(settings.locale, { month: 'short' })
    return { key, label, in: mIn, out: mOut }
  })
})

const yearViewTotalIn  = computed(() => yearViewMonthlyFlow.value.reduce((s, m) => s + m.in,  0))
const yearViewTotalOut = computed(() => yearViewMonthlyFlow.value.reduce((s, m) => s + m.out, 0))
const yearViewNet      = computed(() => Math.round((yearViewTotalIn.value - yearViewTotalOut.value) * 100) / 100)
const yearViewTxCount  = computed(() => txStore.transactions.filter(t => t.date.startsWith(String(yearViewYear.value))).length)

const yearViewMonthSummary = computed(() =>
  yearViewMonthlyFlow.value.map((m, i) => ({
    key:         m.key,
    label:       new Date(yearViewYear.value, i, 1).toLocaleDateString(settings.locale, { month: 'long' }),
    in:          m.in,
    out:         m.out,
    net:         Math.round((m.in - m.out) * 100) / 100,
    count:       txStore.transactions.filter(t => t.date.startsWith(m.key)).length,
    savingsRate: m.in > 0 ? Math.round(((m.in - m.out) / m.in) * 100) : 0,
  }))
)

// ── Year-level top transactions (by aggregated name) ──────────
function topByName(txs: typeof txStore.transactions, type: 'in' | 'out', n = 10) {
  const map = new Map<string, number>()
  for (const t of txs) {
    if (t.type !== type) continue
    map.set(t.name, (map.get(t.name) ?? 0) + t.amount)
  }
  return [...map.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, n)
}

const yearTopIn  = computed(() => topByName(txStore.transactions.filter(t => t.date.startsWith(String(yearViewYear.value))), 'in'))
const yearTopOut = computed(() => topByName(txStore.transactions.filter(t => t.date.startsWith(String(yearViewYear.value))), 'out'))

// ── Year transaction heatmap ───────────────────────────────────
const yearHeatmapData = computed(() => {
  const year   = yearViewYear.value
  const txsByDay = new Map<string, number>()
  for (const t of txStore.transactions) {
    if (!t.date.startsWith(String(year))) continue
    if (t.name === 'Opening Balance') continue
    txsByDay.set(t.date, (txsByDay.get(t.date) ?? 0) + 1)
  }

  const jan1     = new Date(year, 0, 1)
  const startDow = jan1.getDay()
  const dec31    = new Date(year, 11, 31)
  const endDow   = dec31.getDay()

  const gridStart = new Date(jan1); gridStart.setDate(gridStart.getDate() - startDow)
  const gridEnd   = new Date(dec31); gridEnd.setDate(gridEnd.getDate() + (6 - endDow))

  const days: { date: string | null; count: number; inYear: boolean }[] = []
  const d = new Date(gridStart)
  while (d <= gridEnd) {
    const dateStr = d.toISOString().slice(0, 10)
    const inYear  = d.getFullYear() === year
    days.push({ date: inYear ? dateStr : null, count: inYear ? (txsByDay.get(dateStr) ?? 0) : 0, inYear })
    d.setDate(d.getDate() + 1)
  }

  const weeks: typeof days[] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))

  const maxCount = Math.max(1, ...days.filter(dy => dy.inYear).map(dy => dy.count))

  const monthLabels: { week: number; label: string }[] = []
  let lastMonth = -1
  for (let w = 0; w < weeks.length; w++) {
    for (const day of weeks[w]) {
      if (!day.date) continue
      const m = parseInt(day.date.slice(5, 7), 10) - 1
      if (m !== lastMonth) {
        monthLabels.push({ week: w, label: new Date(year, m, 1).toLocaleString(settings.locale, { month: 'short' }) })
        lastMonth = m
        break
      }
    }
  }

  return { weeks, maxCount, monthLabels }
})

function heatmapCellColor(count: number, inYear: boolean): string {
  if (!inYear) return 'transparent'
  if (count === 0) return isDark.value ? '#27272a' : '#e4e4e7'
  const max = yearHeatmapData.value.maxCount
  const pct = count / max
  if (pct <= 0.25) return isDark.value ? '#14532d' : '#bbf7d0'
  if (pct <= 0.5)  return isDark.value ? '#166534' : '#4ade80'
  if (pct <= 0.75) return isDark.value ? '#15803d' : '#22c55e'
  return isDark.value ? '#16a34a' : '#16a34a'
}

// ──────────────────────────────────────────────────────────────
// MONTHLY TAB DATA
// ──────────────────────────────────────────────────────────────
const selYear  = computed(() => parseInt(selectedMonthKey.value.split('-')[0], 10))
const selMonth = computed(() => parseInt(selectedMonthKey.value.split('-')[1], 10))

const monthlyTxs = computed(() =>
  txStore.transactions.filter(t => t.date.startsWith(selectedMonthKey.value))
)

const monthIn  = computed(() => monthlyTxs.value.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0))
const monthOut = computed(() => monthlyTxs.value.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0))
const monthNet = computed(() => monthIn.value - monthOut.value)

const dailySpending = computed(() => {
  const cnt  = new Date(selYear.value, selMonth.value, 0).getDate()
  const days = Array.from({ length: cnt }, (_, i) => ({ day: i + 1, out: 0, in: 0 }))
  for (const t of monthlyTxs.value) {
    const idx = parseInt(t.date.split('-')[2], 10) - 1
    if (days[idx]) { if (t.type === 'out') days[idx].out += t.amount; else days[idx].in += t.amount }
  }
  return days
})

const monthTopSpending = computed(() => {
  const map = new Map<string, number>()
  for (const t of monthlyTxs.value) {
    if (t.type !== 'out') continue
    map.set(t.name, (map.get(t.name) ?? 0) + t.amount)
  }
  return [...map.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 8)
})

const monthTopIncome = computed(() => {
  const map = new Map<string, number>()
  for (const t of monthlyTxs.value) {
    if (t.type !== 'in') continue
    map.set(t.name, (map.get(t.name) ?? 0) + t.amount)
  }
  return [...map.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 8)
})

const monthItems = computed(() => {
  const entries = budgetStore.monthlyEntries[selYear.value]?.[selMonth.value] ?? []
  const defs    = new Map(budgetStore.globalItems.map(i => [i.id, i]))
  return entries
    .filter(e => defs.has(e.itemId))
    .map(e => {
      const def       = defs.get(e.itemId)!
      const activity  = txStore.getItemActivity(e.itemId, selYear.value, selMonth.value)
      const available = Math.round((e.assigned - activity) * 100) / 100
      const pct       = e.assigned > 0
        ? Math.min(100, Math.round((activity / e.assigned) * 100))
        : (activity > 0 ? 100 : 0)
      return { id: e.itemId, name: def.name, category: e.category, assigned: e.assigned, activity, available, pct }
    })
})

// ──────────────────────────────────────────────────────────────
// ACCOUNTS TAB DATA
// ──────────────────────────────────────────────────────────────
const accountStats = computed(() =>
  accountStore.accounts.map(acc => {
    const allTxs  = txStore.transactions.filter(t => t.accountId === acc.id)
    const yearTxs = allTxs.filter(t => t.date.startsWith(String(yearViewYear.value)))
    const accIn   = yearTxs.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0)
    const accOut  = yearTxs.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0)
    // Balance is always all-time (cumulative)
    const balance = allTxs.reduce((s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0)
    return { id: acc.id, name: acc.name, totalIn: accIn, totalOut: accOut, balance, count: yearTxs.length }
  }).sort((a, b) => b.balance - a.balance)
)

const trendMonths = computed(() => {
  const y = yearViewYear.value
  return Array.from({ length: 12 }, (_, i) => ({
    key:   `${y}-${String(i + 1).padStart(2, '0')}`,
    label: new Date(y, i, 1).toLocaleDateString(settings.locale, { month: 'short' }),
  }))
})

const accountTrend = computed(() => {
  const yearStr = String(yearViewYear.value)
  // Only include accounts that have at least one transaction in the selected year
  const activeAccounts = accountStore.accounts.filter(acc =>
    txStore.transactions.some(t => t.accountId === acc.id && t.date.startsWith(yearStr))
  )
  return activeAccounts.map((acc, i) => {
    // Single chronological pass: compute cumulative balance at each month boundary
    const accTxs = txStore.transactions
      .filter(t => t.accountId === acc.id)
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))

    const months = trendMonths.value
    const balances: number[] = []
    let running = 0
    let txIdx   = 0
    for (const { key } of months) {
      while (txIdx < accTxs.length && accTxs[txIdx].date.substring(0, 7) <= key) {
        const t = accTxs[txIdx++]
        running = Math.round((running + (t.type === 'in' ? t.amount : -t.amount)) * 100) / 100
      }
      balances.push(running)
    }
    return { name: acc.name, color: PALETTE[i % PALETTE.length], balances }
  })
})

// ──────────────────────────────────────────────────────────────
// ITEMS TAB DATA  (all-time, all global items — no month filter)
// ──────────────────────────────────────────────────────────────
const itemsData = computed(() =>
  budgetStore.globalItems
    .map(item => {
      const activity  = txStore.getItemActivity(item.id)
      return { ...item, assigned: 0, activity, available: -activity, pct: activity > 0 ? 100 : 0 }
    })
    .filter(item => item.activity !== 0)
    .sort((a, b) => b.activity - a.activity)
)

const itemsTotalSpent    = computed(() => itemsData.value.reduce((s, i) => s + i.activity, 0))
const itemsUnassigned    = computed(() => txStore.getUnassignedActivity())

// ── Date range filter ─────────────────────────────────────────
const _todayStr    = _now.toISOString().slice(0, 10)
const _thirtyAgo   = new Date(_now); _thirtyAgo.setDate(_thirtyAgo.getDate() - 30)
const _thirtyAgoStr = _thirtyAgo.toISOString().slice(0, 10)
const rangeFrom = ref(_thirtyAgoStr)
const rangeTo   = ref(_todayStr)

const rangeTxs = computed(() =>
  txStore.transactions.filter(t => t.date >= rangeFrom.value && t.date <= rangeTo.value)
)
const rangeIn  = computed(() => rangeTxs.value.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0))
const rangeOut = computed(() => rangeTxs.value.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0))
const rangeNet = computed(() => rangeIn.value - rangeOut.value)

const rangeTopOut = computed(() => {
  const map = new Map<string, number>()
  for (const t of rangeTxs.value) {
    if (t.type !== 'out') continue
    map.set(t.name, (map.get(t.name) ?? 0) + t.amount)
  }
  return [...map.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 10)
})
const rangeTopIn = computed(() => {
  const map = new Map<string, number>()
  for (const t of rangeTxs.value) {
    if (t.type !== 'in') continue
    map.set(t.name, (map.get(t.name) ?? 0) + t.amount)
  }
  return [...map.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 10)
})

const rangeBuckets = computed(() => {
  const from = rangeFrom.value
  const to   = rangeTo.value
  if (!from || !to || from > to) return []
  const dayCount = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1
  if (dayCount <= 62) {
    const buckets: { label: string; key: string; in: number; out: number }[] = []
    const d   = new Date(from + 'T00:00:00')
    const end = new Date(to   + 'T00:00:00')
    while (d <= end) {
      const key = d.toISOString().slice(0, 10)
      const txs = rangeTxs.value.filter(t => t.date === key)
      buckets.push({
        label: `${d.getDate()}/${d.getMonth() + 1}`,
        key,
        in:  txs.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0),
        out: txs.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0),
      })
      d.setDate(d.getDate() + 1)
    }
    return buckets
  } else {
    const map = new Map<string, { in: number; out: number }>()
    for (const t of rangeTxs.value) {
      const key   = t.date.slice(0, 7)
      const entry = map.get(key) ?? { in: 0, out: 0 }
      if (t.type === 'in') entry.in += t.amount; else entry.out += t.amount
      map.set(key, entry)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, v]) => ({
      label: monthKeyShort(key), key, in: v.in, out: v.out,
    }))
  }
})

// ── Canvas refs ────────────────────────────────────────────────
const flowCanvas       = ref<HTMLCanvasElement | null>(null)
const netCanvas        = ref<HTMLCanvasElement | null>(null)
const donutCanvas      = ref<HTMLCanvasElement | null>(null)
const dailyCanvas      = ref<HTMLCanvasElement | null>(null)
const monthSpendCanvas = ref<HTMLCanvasElement | null>(null)
const acctTrendCanvas  = ref<HTMLCanvasElement | null>(null)
const acctBarCanvas    = ref<HTMLCanvasElement | null>(null)
const yearFlowCanvas   = ref<HTMLCanvasElement | null>(null)
const yearNetCanvas    = ref<HTMLCanvasElement | null>(null)
const rangeChartCanvas = ref<HTMLCanvasElement | null>(null)
const itemsDonutCanvas = ref<HTMLCanvasElement | null>(null)
// Finance tab canvas refs (one per loan/savings — keyed by id at render time)
const finLoanCanvases  = ref<Map<number, HTMLCanvasElement>>(new Map())
const finSavCanvases   = ref<Map<number, HTMLCanvasElement>>(new Map())

function registerFinCanvas(type: 'loan' | 'sav', id: number, el: HTMLCanvasElement | null): void {
  if (el) (type === 'loan' ? finLoanCanvases : finSavCanvases).value.set(id, el)
}

// ── Chart management ───────────────────────────────────────────
const charts: Chart[] = []
function destroyAll(): void { while (charts.length) charts.pop()!.destroy() }

function buildOverall(): void {
  if (!flowCanvas.value || !netCanvas.value || !donutCanvas.value) return
  const tc    = textClr.value
  const gc    = gridClr.value
  const dark  = isDark.value
  const money = (v: number | string) => formatMoney(Number(v))

  // Year-over-year grouped bar
  const flow = yearlyFlow.value
  charts.push(new Chart(flowCanvas.value, {
    type: 'bar',
    data: {
      labels:   flow.map(y => y.label),
      datasets: [
        { label: 'In',  data: flow.map(y => y.in),  backgroundColor: 'rgba(34,197,94,0.7)',   borderColor: 'rgb(34,197,94)',   borderWidth: 1, borderRadius: 4 },
        { label: 'Out', data: flow.map(y => y.out), backgroundColor: 'rgba(239,68,68,0.65)', borderColor: 'rgb(239,68,68)', borderWidth: 1, borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      onClick: (_e: unknown, elements: { index: number }[]) => {
        if (!elements.length) return
        const year = yearlyFlow.value[elements[0].index]?.year
        if (year) goTx({ month: String(year) })
      },
      onHover: (_e: unknown, elements: { index: number }[]) => {
        if (flowCanvas.value) flowCanvas.value.style.cursor = elements.length ? 'pointer' : 'default'
      },
      plugins: { legend: { labels: { color: tc } }, tooltip: { callbacks: { label: ctx => ` ${formatMoney(ctx.parsed.y ?? 0)}` } } },
      scales: {
        x: { ticks: { color: tc }, grid: { color: gc } },
        y: { beginAtZero: true, ticks: { color: tc, callback: money }, grid: { color: gc } },
      },
    },
  }))

  // Net per year bar (green positive, red negative)
  const netData = yearlyNet.value
  charts.push(new Chart(netCanvas.value, {
    type: 'bar',
    data: {
      labels:   netData.map(y => y.label),
      datasets: [{
        label: 'Net',
        data:  netData.map(y => y.net),
        backgroundColor: netData.map(y => y.net >= 0 ? 'rgba(34,197,94,0.75)' : 'rgba(239,68,68,0.7)'),
        borderColor:     netData.map(y => y.net >= 0 ? 'rgb(34,197,94)'       : 'rgb(239,68,68)'),
        borderWidth: 1, borderRadius: 4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      onClick: (_e: unknown, elements: { index: number }[]) => {
        if (!elements.length) return
        const year = netData[elements[0].index]?.year
        if (year) goTx({ month: String(year) })
      },
      onHover: (_e: unknown, elements: { index: number }[]) => {
        if (netCanvas.value) netCanvas.value.style.cursor = elements.length ? 'pointer' : 'default'
      },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${formatMoney(ctx.parsed.y ?? 0)}` } } },
      scales: {
        x: { ticks: { color: tc }, grid: { color: gc } },
        y: { ticks: { color: tc, callback: money }, grid: { color: gc } },
      },
    },
  }))

  // All-time in vs out donut
  charts.push(new Chart(donutCanvas.value, {
    type: 'doughnut',
    data: {
      labels:   ['All-Time In', 'All-Time Out'],
      datasets: [{ data: [totalIn.value, totalOut.value], backgroundColor: ['rgba(34,197,94,0.8)', 'rgba(239,68,68,0.75)'], borderColor: dark ? '#3f3f46' : '#f4f4f5', borderWidth: 3 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      plugins: {
        legend: { position: 'bottom', labels: { color: tc, padding: 16 } },
        tooltip: { callbacks: { label: ctx => ` ${formatMoney(ctx.parsed)}` } },
      },
    },
  }))
}

function buildMonthly(): void {
  if (!dailyCanvas.value || !monthSpendCanvas.value) return
  const tc    = textClr.value
  const gc    = gridClr.value
  const money = (v: number | string) => formatMoney(Number(v))

  const days = dailySpending.value
  charts.push(new Chart(dailyCanvas.value, {
    type: 'bar',
    data: {
      labels:   days.map(d => String(d.day)),
      datasets: [
        { label: 'Out', data: days.map(d => d.out), backgroundColor: 'rgba(239,68,68,0.65)', borderColor: 'rgb(239,68,68)', borderWidth: 1, borderRadius: 2 },
        { label: 'In',  data: days.map(d => d.in),  backgroundColor: 'rgba(34,197,94,0.7)',  borderColor: 'rgb(34,197,94)',  borderWidth: 1, borderRadius: 2 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      onClick: (_e: unknown, elements: { index: number }[]) => {
        if (!elements.length) return
        goTx({ month: selectedMonthKey.value })
      },
      onHover: (_e: unknown, elements: { index: number }[]) => {
        if (dailyCanvas.value) dailyCanvas.value.style.cursor = elements.length ? 'pointer' : 'default'
      },
      plugins: { legend: { labels: { color: tc } }, tooltip: { callbacks: { label: ctx => ` ${formatMoney(ctx.parsed.y ?? 0)}` } } },
      scales: {
        x: { ticks: { color: tc, font: { size: 10 } }, grid: { color: gc } },
        y: { beginAtZero: true, ticks: { color: tc, callback: money }, grid: { color: gc } },
      },
    },
  }))

  const spending = monthTopSpending.value
  if (spending.length > 0) {
    charts.push(new Chart(monthSpendCanvas.value, {
      type: 'bar',
      data: {
        labels:   spending.map(i => i.name),
        datasets: [{ label: 'Spent', data: spending.map(i => i.total), backgroundColor: 'rgba(249,115,22,0.75)', borderColor: 'rgb(249,115,22)', borderWidth: 1, borderRadius: 3 }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        onClick: (_e: unknown, elements: { index: number }[]) => {
          if (!elements.length) return
          const name = monthTopSpending.value[elements[0].index]?.name
          if (name) goTx({ month: selectedMonthKey.value, name })
        },
        onHover: (_e: unknown, elements: { index: number }[]) => {
          if (monthSpendCanvas.value) monthSpendCanvas.value.style.cursor = elements.length ? 'pointer' : 'default'
        },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${formatMoney(ctx.parsed.x ?? 0)}` } } },
        scales: {
          x: { beginAtZero: true, ticks: { color: tc, callback: money }, grid: { color: gc } },
          y: { ticks: { color: tc }, grid: { color: gc } },
        },
      },
    }))
  }
}

function buildAccounts(): void {
  if (!acctTrendCanvas.value || !acctBarCanvas.value) return
  const tc    = textClr.value
  const gc    = gridClr.value
  const money = (v: number | string) => formatMoney(Number(v))

  const trend  = accountTrend.value
  const labels = trendMonths.value.map(m => m.label)
  charts.push(new Chart(acctTrendCanvas.value, {
    type: 'line',
    data: {
      labels,
      datasets: trend.map(acc => ({
        label:           acc.name,
        data:            acc.balances,
        borderColor:     acc.color,
        backgroundColor: acc.color.replace('rgb(', 'rgba(').replace(')', ', 0.08)'),
        borderWidth:     2,
        pointRadius:     3,
        tension:         0.3,
        fill:            false,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      plugins: {
        legend: { position: 'bottom', labels: { color: tc, boxWidth: 12, padding: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatMoney(ctx.parsed.y ?? 0)}` } },
      },
      scales: {
        x: { ticks: { color: tc }, grid: { color: gc } },
        y: { ticks: { color: tc, callback: money }, grid: { color: gc } },
      },
    },
  }))

  const accts = accountStats.value
  charts.push(new Chart(acctBarCanvas.value, {
    type: 'bar',
    data: {
      labels:   accts.map(a => a.name),
      datasets: [
        { label: 'Total In',  data: accts.map(a => a.totalIn),  backgroundColor: 'rgba(34,197,94,0.7)',   borderColor: 'rgb(34,197,94)',   borderWidth: 1, borderRadius: 3 },
        { label: 'Total Out', data: accts.map(a => a.totalOut), backgroundColor: 'rgba(239,68,68,0.65)', borderColor: 'rgb(239,68,68)', borderWidth: 1, borderRadius: 3 },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      onClick: (_e: unknown, elements: { index: number }[]) => {
        if (!elements.length) return
        const accountId = accountStats.value[elements[0].index]?.id
        if (accountId) goTx({ accountId })
      },
      onHover: (_e: unknown, elements: { index: number }[]) => {
        if (acctBarCanvas.value) acctBarCanvas.value.style.cursor = elements.length ? 'pointer' : 'default'
      },
      plugins: {
        legend: { position: 'bottom', labels: { color: tc } },
        tooltip: { callbacks: { label: ctx => ` ${formatMoney(ctx.parsed.x ?? 0)}` } },
      },
      scales: {
        x: { beginAtZero: true, ticks: { color: tc, callback: money }, grid: { color: gc } },
        y: { ticks: { color: tc }, grid: { color: gc } },
      },
    },
  }))
}

function buildYear(): void {
  if (!yearFlowCanvas.value || !yearNetCanvas.value) return
  const tc    = textClr.value
  const gc    = gridClr.value
  const money = (v: number | string) => formatMoney(Number(v))

  const flow = yearViewMonthlyFlow.value
  charts.push(new Chart(yearFlowCanvas.value, {
    type: 'bar',
    data: {
      labels:   flow.map(m => m.label),
      datasets: [
        { label: 'In',  data: flow.map(m => m.in),  backgroundColor: 'rgba(34,197,94,0.7)',   borderColor: 'rgb(34,197,94)',   borderWidth: 1, borderRadius: 4 },
        { label: 'Out', data: flow.map(m => m.out), backgroundColor: 'rgba(239,68,68,0.65)', borderColor: 'rgb(239,68,68)', borderWidth: 1, borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      onClick: (_e: unknown, elements: { index: number }[]) => {
        if (!elements.length) return
        const key = yearViewMonthlyFlow.value[elements[0].index]?.key
        if (key) goTx({ month: key })
      },
      onHover: (_e: unknown, elements: { index: number }[]) => {
        if (yearFlowCanvas.value) yearFlowCanvas.value.style.cursor = elements.length ? 'pointer' : 'default'
      },
      plugins: { legend: { labels: { color: tc } }, tooltip: { callbacks: { label: ctx => ` ${formatMoney(ctx.parsed.y ?? 0)}` } } },
      scales: {
        x: { ticks: { color: tc }, grid: { color: gc } },
        y: { beginAtZero: true, ticks: { color: tc, callback: money }, grid: { color: gc } },
      },
    },
  }))

  const netData = flow.map(m => ({ ...m, net: Math.round((m.in - m.out) * 100) / 100 }))
  charts.push(new Chart(yearNetCanvas.value, {
    type: 'bar',
    data: {
      labels:   netData.map(m => m.label),
      datasets: [{
        label: 'Net',
        data:  netData.map(m => m.net),
        backgroundColor: netData.map(m => m.net >= 0 ? 'rgba(34,197,94,0.75)' : 'rgba(239,68,68,0.7)'),
        borderColor:     netData.map(m => m.net >= 0 ? 'rgb(34,197,94)'       : 'rgb(239,68,68)'),
        borderWidth: 1, borderRadius: 4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      onClick: (_e: unknown, elements: { index: number }[]) => {
        if (!elements.length) return
        const key = yearViewMonthlyFlow.value[elements[0].index]?.key
        if (key) goTx({ month: key })
      },
      onHover: (_e: unknown, elements: { index: number }[]) => {
        if (yearNetCanvas.value) yearNetCanvas.value.style.cursor = elements.length ? 'pointer' : 'default'
      },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${formatMoney(ctx.parsed.y ?? 0)}` } } },
      scales: {
        x: { ticks: { color: tc }, grid: { color: gc } },
        y: { ticks: { color: tc, callback: money }, grid: { color: gc } },
      },
    },
  }))
}

function buildItems(): void {
  if (!itemsDonutCanvas.value || itemsData.value.length === 0) return
  const tc   = textClr.value
  const dark = isDark.value
  const top  = itemsData.value.slice(0, 8)
  charts.push(new Chart(itemsDonutCanvas.value, {
    type: 'doughnut',
    data: {
      labels:   top.map(i => i.name),
      datasets: [{
        data:            top.map(i => i.activity),
        backgroundColor: PALETTE.slice(0, top.length).map(c => c.replace('rgb(', 'rgba(').replace(')', ', 0.8)')),
        borderColor:     dark ? '#27272a' : '#f4f4f5',
        borderWidth: 3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      plugins: {
        legend: { position: 'right', labels: { color: tc, boxWidth: 12, padding: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${formatMoney(ctx.parsed)}` } },
      },
    },
  }))
}

function buildRange(): void {
  if (!rangeChartCanvas.value || rangeBuckets.value.length === 0) return
  const tc    = textClr.value
  const gc    = gridClr.value
  const money = (v: number | string) => formatMoney(Number(v))
  const data  = rangeBuckets.value
  charts.push(new Chart(rangeChartCanvas.value, {
    type: 'bar',
    data: {
      labels:   data.map(b => b.label),
      datasets: [
        { label: 'In',  data: data.map(b => b.in),  backgroundColor: 'rgba(34,197,94,0.7)',   borderColor: 'rgb(34,197,94)',  borderWidth: 1, borderRadius: 4 },
        { label: 'Out', data: data.map(b => b.out), backgroundColor: 'rgba(239,68,68,0.65)', borderColor: 'rgb(239,68,68)', borderWidth: 1, borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
      plugins: { legend: { labels: { color: tc } }, tooltip: { callbacks: { label: ctx => ` ${formatMoney(ctx.parsed.y ?? 0)}` } } },
      scales: {
        x: { ticks: { color: tc, maxRotation: 45, autoSkip: true, maxTicksLimit: 20 }, grid: { color: gc } },
        y: { beginAtZero: true, ticks: { color: tc, callback: money }, grid: { color: gc } },
      },
    },
  }))
}

function buildBreakdown(): void {
  if (breakdownSubTab.value === 'year')          { buildYear() }
  else if (breakdownSubTab.value === 'accounts') { buildAccounts() }
  else if (breakdownSubTab.value === 'range')    { buildRange() }
  else                                           { buildMonthly() }
}

// ── Finance charts ─────────────────────────────────────────────
function buildFinance(): void {
  const tc = textClr.value
  const gc = gridClr.value
  const money = (v: number | string) => formatMoney(Number(v))

  for (const loan of loanStore.loans.filter(l => !l.archived)) {
    const canvas = finLoanCanvases.value.get(loan.id)
    if (!canvas) continue
    const rows   = loanStore.calcAmortization(loan)
    const labels = rows.map(r => r.date)
    const balances = rows.map(r => r.closingBalance)
    let cumInt = 0
    const cumInterest = rows.map(r => { cumInt += r.interestPaid; return Math.round(cumInt * 100) / 100 })

    let actualPoints: (number | null)[] | null = null
    if (loan.linkedAccountId) {
      const byMonth = loanStore.buildMonthlyRunningBalance(loan.linkedAccountId)
      const startYM = loan.startDate.slice(0, 7)
      let lastVal: number | null = null
      actualPoints = labels.map(label => {
        if (label < startYM) return null
        if (byMonth.has(label)) lastVal = byMonth.get(label)!
        return lastVal
      })
    }

    const datasets: object[] = [
      {
        label: 'Scheduled balance',
        data: balances,
        borderColor: loan.color,
        backgroundColor: loan.color + '22',
        fill: true, borderWidth: 2, pointRadius: 0, tension: 0.4,
      },
      {
        label: 'Cumulative interest',
        data: cumInterest,
        borderColor: '#ef444488',
        backgroundColor: 'transparent',
        borderWidth: 1.5, borderDash: [5, 3], pointRadius: 0, tension: 0.4,
      },
    ]
    if (actualPoints) {
      datasets.push({
        label: 'Actual balance',
        data: actualPoints,
        borderColor: '#f59e0b',
        backgroundColor: 'transparent',
        borderWidth: 2, borderDash: [4, 4], pointRadius: 3, tension: 0.3, spanGaps: true,
      })
    }
    charts.push(new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: tc, font: { size: 10 }, boxWidth: 12 } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y)}` } },
        },
        scales: {
          x: { ticks: { color: tc, font: { size: 9 }, maxTicksLimit: 10 }, grid: { color: gc } },
          y: { ticks: { color: tc, font: { size: 9 }, callback: money }, grid: { color: gc } },
        },
      },
    }))
  }

  for (const sav of loanStore.savings.filter(s => !s.archived)) {
    const canvas = finSavCanvases.value.get(sav.id)
    if (!canvas) continue
    const start = new Date(sav.startDate + 'T00:00:00')
    const now   = new Date()
    const elapsed = Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth())
    const projMonths = Math.max(60, elapsed + 12)
    const projection = loanStore.calcSavingsProjection(sav, projMonths)
    const labels    = projection.map(p => p.date)
    const projected = projection.map(p => p.balance)
    const interest  = projected.map(b => Math.round((b - sav.startBalance) * 100) / 100)

    let actualPoints: (number | null)[] | null = null
    if (sav.linkedAccountId) {
      const byMonth = loanStore.buildMonthlyRunningBalance(sav.linkedAccountId)
      const startYM = sav.startDate.slice(0, 7)
      let lastVal: number | null = null
      actualPoints = labels.map(label => {
        if (label < startYM) return null
        if (byMonth.has(label)) lastVal = byMonth.get(label)!
        return lastVal
      })
    }

    const datasets: object[] = [
      {
        label: 'Projected balance',
        data: projected,
        borderColor: sav.color,
        backgroundColor: sav.color + '22',
        fill: true, borderWidth: 2, pointRadius: 0, tension: 0.4,
      },
      {
        label: 'Interest earned',
        data: interest,
        borderColor: '#10b98188',
        backgroundColor: 'transparent',
        borderWidth: 1.5, borderDash: [5, 3], pointRadius: 0, tension: 0.4,
      },
    ]
    if (actualPoints) {
      datasets.push({
        label: 'Actual balance',
        data: actualPoints,
        borderColor: '#f59e0b',
        backgroundColor: 'transparent',
        borderWidth: 2, borderDash: [4, 4], pointRadius: 3, tension: 0.3, spanGaps: true,
      })
    }
    charts.push(new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: tc, font: { size: 10 }, boxWidth: 12 } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y)}` } },
        },
        scales: {
          x: { ticks: { color: tc, font: { size: 9 }, maxTicksLimit: 10 }, grid: { color: gc } },
          y: { ticks: { color: tc, font: { size: 9 }, callback: money }, grid: { color: gc } },
        },
      },
    }))
  }
}

function buildTab(tab: Tab): void {
  destroyAll()
  if (tab === 'overall')   buildOverall()
  if (tab === 'breakdown') buildBreakdown()
  if (tab === 'items')     nextTick(() => buildItems())
  if (tab === 'finance')   nextTick(() => { finLoanCanvases.value.clear(); finSavCanvases.value.clear(); nextTick(() => buildFinance()) })
}

onMounted(() => nextTick(() => buildTab(activeTab.value)))
onUnmounted(destroyAll)

watch(activeTab, tab => nextTick(() => buildTab(tab)))

watch([yearlyFlow, yearlyNet, totalIn, totalOut, isDark], () => {
  if (activeTab.value === 'overall') { destroyAll(); buildOverall() }
})
watch([yearViewMonthlyFlow, accountTrend, accountStats, dailySpending, monthTopSpending, isDark], () => {
  if (activeTab.value === 'breakdown') { destroyAll(); nextTick(() => buildBreakdown()) }
})

watch([rangeBuckets, isDark], () => {
  if (activeTab.value === 'breakdown' && breakdownSubTab.value === 'range') {
    destroyAll(); nextTick(() => buildRange())
  }
})

watch([itemsData, isDark], () => {
  if (activeTab.value === 'items') { destroyAll(); nextTick(() => buildItems()) }
})

watch([() => loanStore.loans, () => loanStore.savings, isDark], () => {
  if (activeTab.value === 'finance') { destroyAll(); finLoanCanvases.value.clear(); finSavCanvases.value.clear(); nextTick(() => nextTick(() => buildFinance())) }
}, { deep: true })

watch(breakdownSubTab, () => {
  if (activeTab.value === 'breakdown') { destroyAll(); nextTick(() => buildBreakdown()) }
})

// When year changes, sync the selected month to the first available month in that year
watch(yearViewYear, y => {
  const keys = availableMonthKeys.value.filter(k => k.startsWith(String(y)))
  selectedMonthKey.value = keys.length > 0
    ? keys[0]
    : `${y}-${String(_now.getMonth() + 1).padStart(2, '0')}`
})
</script>

<template>
  <div class="reports-page">

    <div class="rpt-tabs">
      <button
        v-for="t in tabs"
        :key="t.id"
        class="rpt-tab"
        :class="{ active: activeTab === t.id }"
        @click="activeTab = t.id"
      >{{ t.label }}</button>
    </div>

    <!-- YEARS -->
    <template v-if="activeTab === 'overall'">
      <div class="reports-stats">
        <div class="reports-stat-card">
          <span class="reports-stat-label">All-Time In</span>
          <span class="reports-stat-value money-positive">{{ formatMoney(totalIn) }}</span>
        </div>
        <div class="reports-stat-card">
          <span class="reports-stat-label">All-Time Out</span>
          <span class="reports-stat-value money-negative">{{ formatMoney(totalOut) }}</span>
        </div>
        <div class="reports-stat-card">
          <span class="reports-stat-label">All-Time Net</span>
          <span class="reports-stat-value" :class="net >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(net) }}</span>
        </div>
        <div class="reports-stat-card">
          <span class="reports-stat-label">All-Time Transactions</span>
          <span class="reports-stat-value">{{ txStore.transactions.length }}</span>
        </div>
        <div class="reports-stat-card">
          <span class="reports-stat-label">Years of Data</span>
          <span class="reports-stat-value">{{ availableYears.length }}</span>
        </div>
      </div>
      <div class="reports-grid">
        <div class="reports-card reports-card-span2">
          <h3 class="reports-card-title">Year-over-Year Cash Flow</h3>
          <p class="rpt-chart-hint">Click a year to view its transactions</p>
          <div class="reports-chart-wrap" style="height:260px"><canvas ref="flowCanvas" /></div>
        </div>
        <div class="reports-card">
          <h3 class="reports-card-title">Net per Year</h3>
          <p class="rpt-chart-hint">Click a year to view its transactions</p>
          <div class="reports-chart-wrap" style="height:260px"><canvas ref="netCanvas" /></div>
        </div>
        <div class="reports-card">
          <h3 class="reports-card-title">All-Time In vs Out</h3>
          <div class="reports-chart-wrap" style="height:260px"><canvas ref="donutCanvas" /></div>
        </div>
        <div class="reports-card reports-card-span2">
          <h3 class="reports-card-title">Year Summary</h3>
          <div v-if="yearSummary.length === 0" class="rpt-empty">No transactions recorded yet.</div>
          <table v-else class="rpt-table">
            <thead>
              <tr>
                <th>Year</th>
                <th class="rpt-num">In</th>
                <th class="rpt-num">Out</th>
                <th class="rpt-num">Net</th>
                <th class="rpt-num">Transactions</th>
                <th class="rpt-num">Savings Rate</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in yearSummary"
                :key="row.year"
                class="rpt-row-clickable"
                @click="yearViewYear = row.year; activeTab = 'breakdown'; breakdownSubTab = 'year'"
                :title="'View ' + row.year + ' in Breakdown'"
              >
                <td><strong>{{ row.year }}</strong></td>
                <td class="rpt-num money-positive">{{ formatMoney(row.in) }}</td>
                <td class="rpt-num money-negative">{{ formatMoney(row.out) }}</td>
                <td class="rpt-num" :class="row.net >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(row.net) }}</td>
                <td class="rpt-num rpt-muted">{{ row.count }}</td>
                <td class="rpt-num">
                  <span :class="row.savingsRate >= 0 ? 'money-positive' : 'money-negative'">{{ row.savingsRate }}%</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- BREAKDOWN -->
    <template v-if="activeTab === 'breakdown'">

      <!-- Shared header: year picker + sub-tab strip -->
      <div class="bdown-header">
        <nav class="bdown-tabs" aria-label="Year" role="group">
          <button
            v-for="y in [...availableYears].reverse()" :key="y"
            class="bdown-tab"
            :class="{ 'bdown-tab--active': yearViewYear === y }"
            @click="yearViewYear = y"
          >{{ y }}</button>
        </nav>
        <nav class="bdown-tabs" role="tablist">
          <button role="tab" class="bdown-tab" :class="{ 'bdown-tab--active': breakdownSubTab === 'year' }"     @click="breakdownSubTab = 'year'">Year</button>
          <button role="tab" class="bdown-tab" :class="{ 'bdown-tab--active': breakdownSubTab === 'accounts' }" @click="breakdownSubTab = 'accounts'">Accounts</button>
          <button role="tab" class="bdown-tab" :class="{ 'bdown-tab--active': breakdownSubTab === 'month' }"    @click="breakdownSubTab = 'month'">Monthly</button>
          <button role="tab" class="bdown-tab" :class="{ 'bdown-tab--active': breakdownSubTab === 'range' }"    @click="breakdownSubTab = 'range'">Range</button>
        </nav>
      </div>

      <!-- ── Year sub-tab ──────────────────────────────────────── -->
      <template v-if="breakdownSubTab === 'year'">
        <div class="reports-stats">
          <button class="reports-stat-card rpt-stat-link" @click="goTx({ month: String(yearViewYear), type: 'in' })">
            <span class="reports-stat-label">Money In</span>
            <span class="reports-stat-value money-positive">{{ formatMoney(yearViewTotalIn) }}</span>
          </button>
          <button class="reports-stat-card rpt-stat-link" @click="goTx({ month: String(yearViewYear), type: 'out' })">
            <span class="reports-stat-label">Money Out</span>
            <span class="reports-stat-value money-negative">{{ formatMoney(yearViewTotalOut) }}</span>
          </button>
          <button class="reports-stat-card rpt-stat-link" @click="goTx({ month: String(yearViewYear) })">
            <span class="reports-stat-label">Net</span>
            <span class="reports-stat-value" :class="yearViewNet >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(yearViewNet) }}</span>
          </button>
          <button class="reports-stat-card rpt-stat-link" @click="goTx({ month: String(yearViewYear) })">
            <span class="reports-stat-label">Transactions</span>
            <span class="reports-stat-value">{{ yearViewTxCount }}</span>
          </button>
        </div>
        <div class="reports-grid">
          <div class="reports-card reports-card-span2">
            <h3 class="reports-card-title">Monthly Cash Flow — {{ yearViewYear }}</h3>
            <p class="rpt-chart-hint">Click a month bar to view its transactions</p>
            <div class="reports-chart-wrap" style="height:240px"><canvas ref="yearFlowCanvas" /></div>
          </div>
          <div class="reports-card">
            <h3 class="reports-card-title">Net per Month — {{ yearViewYear }}</h3>
            <p class="rpt-chart-hint">Click a bar to view that month's transactions</p>
            <div class="reports-chart-wrap" style="height:240px"><canvas ref="yearNetCanvas" /></div>
          </div>
          <div class="reports-card reports-card-span3">
            <h3 class="reports-card-title">Month Summary — {{ yearViewYear }}</h3>
            <div v-if="yearViewTxCount === 0" class="rpt-empty">No transactions for {{ yearViewYear }}.</div>
            <table v-else class="rpt-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th class="rpt-num">In</th>
                  <th class="rpt-num">Out</th>
                  <th class="rpt-num">Net</th>
                  <th class="rpt-num">Transactions</th>
                  <th class="rpt-num">Savings Rate</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in yearViewMonthSummary"
                  :key="row.key"
                  class="rpt-row-clickable"
                  @click="selectedMonthKey = row.key; breakdownSubTab = 'month'"
                  :title="'View ' + row.label + ' in Monthly'"
                >
                  <td><strong>{{ row.label }}</strong></td>
                  <td class="rpt-num money-positive">{{ formatMoney(row.in) }}</td>
                  <td class="rpt-num money-negative">{{ formatMoney(row.out) }}</td>
                  <td class="rpt-num" :class="row.net >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(row.net) }}</td>
                  <td class="rpt-num rpt-muted">{{ row.count }}</td>
                  <td class="rpt-num">
                    <span v-if="row.count > 0" :class="row.savingsRate >= 0 ? 'money-positive' : 'money-negative'">{{ row.savingsRate }}%</span>
                    <span v-else class="rpt-muted">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="reports-card">
            <h3 class="reports-card-title">Top Income — {{ yearViewYear }}</h3>
            <div v-if="yearTopIn.length === 0" class="rpt-empty">No income recorded.</div>
            <table v-else class="rpt-table">
              <thead><tr><th>Name</th><th class="rpt-num">Total</th></tr></thead>
              <tbody>
                <tr v-for="(row, i) in yearTopIn" :key="row.name" class="rpt-row-clickable" @click="goTx({ month: String(yearViewYear), name: row.name })">
                  <td><span class="rpt-rank">{{ i + 1 }}</span>{{ row.name }}</td>
                  <td class="rpt-num money-positive">{{ formatMoney(row.total) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="reports-card">
            <h3 class="reports-card-title">Top Outgoing — {{ yearViewYear }}</h3>
            <div v-if="yearTopOut.length === 0" class="rpt-empty">No outgoing recorded.</div>
            <table v-else class="rpt-table">
              <thead><tr><th>Name</th><th class="rpt-num">Total</th></tr></thead>
              <tbody>
                <tr v-for="(row, i) in yearTopOut" :key="row.name" class="rpt-row-clickable" @click="goTx({ month: String(yearViewYear), name: row.name })">
                  <td><span class="rpt-rank">{{ i + 1 }}</span>{{ row.name }}</td>
                  <td class="rpt-num money-negative">{{ formatMoney(row.total) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <!-- Transaction Heatmap -->
          <div class="reports-card reports-card-span3">
            <h3 class="reports-card-title">Transaction Activity — {{ yearViewYear }}</h3>
            <div v-if="yearViewTxCount === 0" class="rpt-empty">No transactions for {{ yearViewYear }}.</div>
            <div v-else class="rpt-heatmap">
              <!-- Month labels -->
              <div class="rpt-heatmap-months">
                <span
                  v-for="ml in yearHeatmapData.monthLabels"
                  :key="ml.week"
                  class="rpt-heatmap-month-label"
                  :style="{ gridColumnStart: ml.week + 1 }"
                >{{ ml.label }}</span>
              </div>
              <!-- Day rows (Sun–Sat) -->
              <div class="rpt-heatmap-grid">
                <div
                  v-for="(week, wi) in yearHeatmapData.weeks"
                  :key="wi"
                  class="rpt-heatmap-col"
                >
                  <div
                    v-for="(day, di) in week"
                    :key="di"
                    class="rpt-heatmap-cell"
                    :style="{ background: heatmapCellColor(day.count, day.inYear) }"
                    :title="day.date ? (day.count > 0 ? day.date + ': ' + day.count + ' transaction' + (day.count !== 1 ? 's' : '') : day.date + ': no transactions') : ''"
                    @click="day.date && day.count > 0 && goTx({ month: day.date })"
                    :class="{ 'rpt-heatmap-cell--clickable': day.date && day.count > 0 }"
                  />
                </div>
              </div>
              <!-- Legend -->
              <div class="rpt-heatmap-legend">
                <span class="rpt-heatmap-legend-label">Less</span>
                <div class="rpt-heatmap-cell" :style="{ background: heatmapCellColor(0, true) }" />
                <div class="rpt-heatmap-cell" :style="{ background: heatmapCellColor(Math.ceil(yearHeatmapData.maxCount * 0.25), true) }" />
                <div class="rpt-heatmap-cell" :style="{ background: heatmapCellColor(Math.ceil(yearHeatmapData.maxCount * 0.5), true) }" />
                <div class="rpt-heatmap-cell" :style="{ background: heatmapCellColor(Math.ceil(yearHeatmapData.maxCount * 0.75), true) }" />
                <div class="rpt-heatmap-cell" :style="{ background: heatmapCellColor(yearHeatmapData.maxCount, true) }" />
                <span class="rpt-heatmap-legend-label">More</span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- ── Accounts sub-tab ──────────────────────────────────── -->
      <template v-if="breakdownSubTab === 'accounts'">
        <div v-if="accountStats.length === 0" class="rpt-empty rpt-empty-lg">No accounts set up yet.</div>
        <template v-else>
          <p class="rpt-section-note" style="margin-top:0.5rem">Balances are all-time. In / Out reflects the selected year.</p>
          <div class="reports-stats">
            <div v-for="acc in accountStats" :key="acc.id" class="reports-stat-card">
              <span class="reports-stat-label">{{ acc.name }}</span>
              <span class="reports-stat-value" :class="acc.balance >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(acc.balance) }}</span>
            </div>
          </div>
          <div class="reports-grid">
            <div class="reports-card reports-card-span3">
              <h3 class="reports-card-title">Running Balance — {{ yearViewYear }}</h3>
              <div class="reports-chart-wrap" style="height:280px"><canvas ref="acctTrendCanvas" /></div>
            </div>
            <div class="reports-card reports-card-span3">
              <h3 class="reports-card-title">In vs Out by Account — {{ yearViewYear }}</h3>
              <div class="reports-chart-wrap" style="height:180px"><canvas ref="acctBarCanvas" /></div>
            </div>
            <div class="reports-card reports-card-span3">
              <h3 class="reports-card-title">Account Summary</h3>
              <table class="rpt-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th class="rpt-num">Transactions</th>
                    <th class="rpt-num">Total In</th>
                    <th class="rpt-num">Total Out</th>
                    <th class="rpt-num">Balance (All-Time)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="acc in accountStats" :key="acc.id">
                    <td>{{ acc.name }}</td>
                    <td class="rpt-num rpt-muted">{{ acc.count }}</td>
                    <td class="rpt-num money-positive">{{ formatMoney(acc.totalIn) }}</td>
                    <td class="rpt-num money-negative">{{ formatMoney(acc.totalOut) }}</td>
                    <td class="rpt-num" :class="acc.balance >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(acc.balance) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </template>

      <!-- ── Monthly sub-tab ───────────────────────────────────── -->
      <template v-if="breakdownSubTab === 'month'">
        <div v-if="breakdownMonthKeys.length === 0" class="rpt-filter-note" style="margin-bottom:0.5rem">No transactions in {{ yearViewYear }}.</div>
        <nav v-else class="bdown-tabs bdown-tabs--months" aria-label="Month" role="group">
          <button
            v-for="key in [...breakdownMonthKeys].reverse()" :key="key"
            class="bdown-tab"
            :class="{ 'bdown-tab--active': selectedMonthKey === key }"
            @click="selectedMonthKey = key"
          >{{ monthKeyShort(key) }}</button>
        </nav>
        <div class="reports-stats">
          <button class="reports-stat-card rpt-stat-link" @click="goTx({ month: selectedMonthKey, type: 'in' })">
            <span class="reports-stat-label">Money In</span>
            <span class="reports-stat-value money-positive">{{ formatMoney(monthIn) }}</span>
          </button>
          <button class="reports-stat-card rpt-stat-link" @click="goTx({ month: selectedMonthKey, type: 'out' })">
            <span class="reports-stat-label">Money Out</span>
            <span class="reports-stat-value money-negative">{{ formatMoney(monthOut) }}</span>
          </button>
          <button class="reports-stat-card rpt-stat-link" @click="goTx({ month: selectedMonthKey })">
            <span class="reports-stat-label">Net</span>
            <span class="reports-stat-value" :class="monthNet >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(monthNet) }}</span>
          </button>
          <button class="reports-stat-card rpt-stat-link" @click="goTx({ month: selectedMonthKey })">
            <span class="reports-stat-label">Transactions</span>
            <span class="reports-stat-value">{{ monthlyTxs.length }}</span>
          </button>
        </div>
        <div class="reports-grid">
          <div class="reports-card reports-card-span2">
            <h3 class="reports-card-title">Daily Activity — {{ monthKeyToLabel(selectedMonthKey) }}</h3>
            <div class="reports-chart-wrap" style="height:240px"><canvas ref="dailyCanvas" /></div>
          </div>
          <div class="reports-card">
            <h3 class="reports-card-title">Top Merchants</h3>
            <div v-if="monthTopSpending.length === 0" class="rpt-empty rpt-empty-chart">No spending this month.</div>
            <div v-else class="reports-chart-wrap" style="height:240px"><canvas ref="monthSpendCanvas" /></div>
          </div>
          <div class="reports-card reports-card-span3">
            <h3 class="reports-card-title">Budget Items vs Actual — {{ monthKeyToLabel(selectedMonthKey) }}</h3>
            <div v-if="monthItems.length === 0" class="rpt-empty">No budget items for this month. Open the Budget tab to set up items.</div>
            <table v-else class="rpt-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th class="rpt-num">Assigned</th>
                  <th class="rpt-num">Spent</th>
                  <th class="rpt-num">Available</th>
                  <th class="rpt-bar-col">Usage</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in monthItems" :key="item.id">
                  <td>{{ item.name }}</td>
                  <td class="rpt-muted">{{ item.category }}</td>
                  <td class="rpt-num">{{ formatMoney(item.assigned) }}</td>
                  <td class="rpt-num">{{ formatMoney(item.activity) }}</td>
                  <td class="rpt-num" :class="item.available < 0 ? 'money-negative' : (item.assigned === 0 && item.activity === 0 ? '' : 'money-positive')">{{ formatMoney(item.available) }}</td>
                  <td class="rpt-bar-cell">
                    <div class="rpt-bar-wrap"><div class="rpt-bar" :style="{ width: item.pct + '%', background: barColor(item.pct) }" /></div>
                    <span class="rpt-bar-pct">{{ item.pct }}%</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="reports-card">
            <h3 class="reports-card-title">Top Income — {{ monthKeyToLabel(selectedMonthKey) }}</h3>
            <div v-if="monthTopIncome.length === 0" class="rpt-empty">No income this month.</div>
            <table v-else class="rpt-table">
              <thead><tr><th>Name</th><th class="rpt-num">Total</th></tr></thead>
              <tbody>
                <tr v-for="(row, i) in monthTopIncome" :key="row.name" class="rpt-row-clickable" @click="goTx({ month: selectedMonthKey, name: row.name })">
                  <td><span class="rpt-rank">{{ i + 1 }}</span>{{ row.name }}</td>
                  <td class="rpt-num money-positive">{{ formatMoney(row.total) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="reports-card">
            <h3 class="reports-card-title">Top Outgoing — {{ monthKeyToLabel(selectedMonthKey) }}</h3>
            <div v-if="monthTopSpending.length === 0" class="rpt-empty">No outgoing this month.</div>
            <table v-else class="rpt-table">
              <thead><tr><th>Name</th><th class="rpt-num">Total</th></tr></thead>
              <tbody>
                <tr v-for="(row, i) in monthTopSpending" :key="row.name" class="rpt-row-clickable" @click="goTx({ month: selectedMonthKey, name: row.name })">
                  <td><span class="rpt-rank">{{ i + 1 }}</span>{{ row.name }}</td>
                  <td class="rpt-num money-negative">{{ formatMoney(row.total) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>

      <!-- ── Range sub-tab ──────────────────────────────────────── -->
      <template v-if="breakdownSubTab === 'range'">
        <div class="bdown-range-controls">
          <div class="bdown-range-field">
            <label class="bdown-range-label">From</label>
            <input type="date" v-model="rangeFrom" class="bdown-range-input" :max="rangeTo" />
          </div>
          <div class="bdown-range-field">
            <label class="bdown-range-label">To</label>
            <input type="date" v-model="rangeTo" class="bdown-range-input" :min="rangeFrom" />
          </div>
          <span v-if="rangeTxs.length > 0" class="bdown-range-count">{{ rangeTxs.length }} transactions</span>
        </div>
        <div v-if="rangeTxs.length === 0" class="rpt-empty rpt-empty-lg">No transactions in this date range.</div>
        <template v-else>
          <div class="reports-stats">
            <div class="reports-stat-card">
              <span class="reports-stat-label">Money In</span>
              <span class="reports-stat-value money-positive">{{ formatMoney(rangeIn) }}</span>
            </div>
            <div class="reports-stat-card">
              <span class="reports-stat-label">Money Out</span>
              <span class="reports-stat-value money-negative">{{ formatMoney(rangeOut) }}</span>
            </div>
            <div class="reports-stat-card">
              <span class="reports-stat-label">Net</span>
              <span class="reports-stat-value" :class="rangeNet >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(rangeNet) }}</span>
            </div>
            <div class="reports-stat-card">
              <span class="reports-stat-label">Transactions</span>
              <span class="reports-stat-value">{{ rangeTxs.length }}</span>
            </div>
          </div>
          <div class="reports-grid">
            <div class="reports-card reports-card-span3">
              <h3 class="reports-card-title">Activity</h3>
              <div class="reports-chart-wrap" style="height:240px"><canvas ref="rangeChartCanvas" /></div>
            </div>
            <div class="reports-card">
              <h3 class="reports-card-title">Top Spending</h3>
              <div v-if="rangeTopOut.length === 0" class="rpt-empty">No outgoing in range.</div>
              <table v-else class="rpt-table">
                <thead><tr><th>Name</th><th class="rpt-num">Total</th></tr></thead>
                <tbody>
                  <tr v-for="(row, i) in rangeTopOut" :key="row.name" class="rpt-row-clickable" @click="goTx({ name: row.name })">
                    <td><span class="rpt-rank">{{ i + 1 }}</span>{{ row.name }}</td>
                    <td class="rpt-num money-negative">{{ formatMoney(row.total) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="reports-card">
              <h3 class="reports-card-title">Top Income</h3>
              <div v-if="rangeTopIn.length === 0" class="rpt-empty">No income in range.</div>
              <table v-else class="rpt-table">
                <thead><tr><th>Name</th><th class="rpt-num">Total</th></tr></thead>
                <tbody>
                  <tr v-for="(row, i) in rangeTopIn" :key="row.name" class="rpt-row-clickable" @click="goTx({ name: row.name })">
                    <td><span class="rpt-rank">{{ i + 1 }}</span>{{ row.name }}</td>
                    <td class="rpt-num money-positive">{{ formatMoney(row.total) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </template>

    </template>

    <!-- ITEMS -->
    <template v-if="activeTab === 'items'">
      <!-- stat bar -->
      <div class="reports-stats">
        <div class="reports-stat-card">
          <span class="reports-stat-label">Total Spent (Items)</span>
          <span class="reports-stat-value money-negative">{{ formatMoney(itemsTotalSpent) }}</span>
        </div>
        <div class="reports-stat-card">
          <span class="reports-stat-label">Unassigned Spend</span>
          <span class="reports-stat-value" :class="itemsUnassigned > 0 ? 'money-negative' : 'rpt-muted'">{{ formatMoney(itemsUnassigned) }}</span>
        </div>
        <div class="reports-stat-card">
          <span class="reports-stat-label">Items with Activity</span>
          <span class="reports-stat-value">{{ itemsData.length }}</span>
        </div>
        <div class="reports-stat-card">
          <span class="reports-stat-label">Largest Single Item</span>
          <span class="reports-stat-value money-negative">{{ itemsData.length ? formatMoney(itemsData[0].activity) : '—' }}</span>
        </div>
      </div>

      <div v-if="itemsData.length === 0" class="rpt-empty rpt-empty-lg">
        No spending recorded against budget items yet.
      </div>

      <template v-else>
        <div class="reports-grid">
          <!-- Doughnut chart -->
          <div class="reports-card reports-card-span2">
            <h3 class="reports-card-title">Spend by Item</h3>
            <div class="reports-chart-wrap" style="height:280px">
              <canvas ref="itemsDonutCanvas" />
            </div>
          </div>

          <!-- Top items ranked list -->
          <div class="reports-card">
            <h3 class="reports-card-title">Top Items</h3>
            <div class="items-rank-list">
              <div
                v-for="(item, i) in itemsData.slice(0, 8)"
                :key="item.id"
                class="items-rank-row rpt-row-clickable"
                @click="goTx({ name: item.name })"
              >
                <span class="items-rank-badge" :style="{ background: PALETTE[i % PALETTE.length].replace('rgb(', 'rgba(').replace(')', ', 0.15)'), color: PALETTE[i % PALETTE.length] }">{{ i + 1 }}</span>
                <span class="items-rank-name">{{ item.name }}</span>
                <span class="items-rank-amount money-negative">{{ formatMoney(item.activity) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Full breakdown bar rows -->
        <div class="reports-card reports-card-span3" style="margin-top:0">
          <h3 class="reports-card-title">All Items — Spend vs Total (All Time)</h3>
          <div class="items-bar-list">
            <div
              v-for="(item, i) in itemsData"
              :key="item.id"
              class="items-bar-row rpt-row-clickable"
              @click="goTx({ name: item.name })"
            >
              <div class="items-bar-meta">
                <span class="items-bar-dot" :style="{ background: PALETTE[i % PALETTE.length] }" />
                <span class="items-bar-name">{{ item.name }}</span>
                <span class="items-bar-pct">{{ itemsTotalSpent > 0 ? Math.round((item.activity / itemsTotalSpent) * 100) : 0 }}%</span>
              </div>
              <div class="items-bar-track">
                <div
                  class="items-bar-fill"
                  :style="{
                    width: itemsTotalSpent > 0 ? Math.round((item.activity / itemsTotalSpent) * 100) + '%' : '0%',
                    background: PALETTE[i % PALETTE.length],
                  }"
                />
              </div>
              <span class="items-bar-amount money-negative">{{ formatMoney(item.activity) }}</span>
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- FINANCE -->
    <template v-if="activeTab === 'finance'">

      <!-- Empty state -->
      <div
        v-if="loanStore.loans.filter(l => !l.archived).length === 0 && loanStore.savings.filter(s => !s.archived).length === 0"
        class="rpt-empty rpt-empty-lg"
      >
        <p>No loans or savings accounts tracked yet.</p>
        <p class="rpt-muted" style="font-size:0.75rem;margin-top:0.25rem">Add them on the Finance page to see charts here.</p>
      </div>

      <!-- Summary stat bar -->
      <div v-if="loanStore.loans.filter(l => !l.archived).length > 0 || loanStore.savings.filter(s => !s.archived).length > 0" class="reports-stats">
        <div class="reports-stat-card">
          <span class="reports-stat-label">Active Loans</span>
          <span class="reports-stat-value">{{ loanStore.loans.filter(l => !l.archived).length }}</span>
        </div>
        <div class="reports-stat-card">
          <span class="reports-stat-label">Total Borrowed</span>
          <span class="reports-stat-value money-negative">{{ formatMoney(loanStore.loans.filter(l => !l.archived).reduce((s, l) => s + l.principal, 0)) }}</span>
        </div>
        <div class="reports-stat-card">
          <span class="reports-stat-label">Total Interest Cost</span>
          <span class="reports-stat-value money-negative">{{ formatMoney(loanStore.loans.filter(l => !l.archived).reduce((s, l) => s + loanStore.totalInterest(l), 0)) }}</span>
        </div>
        <div class="reports-stat-card">
          <span class="reports-stat-label">Savings Accounts</span>
          <span class="reports-stat-value">{{ loanStore.savings.filter(s => !s.archived).length }}</span>
        </div>
        <div class="reports-stat-card">
          <span class="reports-stat-label">Total Savings Balance</span>
          <span class="reports-stat-value money-positive">{{ formatMoney(loanStore.savings.filter(s => !s.archived).reduce((s, acc) => s + (acc.linkedAccountId ? loanStore.accountNetBalance(acc.linkedAccountId) : acc.startBalance), 0)) }}</span>
        </div>
      </div>

      <!-- ── Loans ─────────────────────────────────────── -->
      <template v-if="loanStore.loans.filter(l => !l.archived).length > 0">
        <h2 class="rpt-section-heading"><i class="pi pi-credit-card" /> Loans</h2>

        <div class="reports-grid">
          <div
            v-for="loan in loanStore.loans.filter(l => !l.archived)"
            :key="loan.id"
            class="reports-card reports-card-span3"
          >
            <div class="rpt-fin-card-header">
              <span class="rpt-fin-dot" :style="{ background: loan.color }" />
              <h3 class="rpt-fin-name">{{ loan.name }}</h3>
              <span class="rpt-fin-pill rpt-fin-pill--red">{{ loan.apr }}% APR</span>
              <span class="rpt-fin-pill">{{ loan.termMonths }}mo</span>
              <span class="rpt-fin-pill">ends {{ (() => { const d = new Date(loan.startDate + 'T00:00:00'); d.setMonth(d.getMonth() + loan.termMonths); return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) })() }}</span>
            </div>

            <div class="rpt-fin-stats">
              <div class="rpt-fin-stat">
                <span class="rpt-fin-stat-label">Principal</span>
                <span class="rpt-fin-stat-value">{{ formatMoney(loan.principal) }}</span>
              </div>
              <div class="rpt-fin-stat">
                <span class="rpt-fin-stat-label">Monthly payment</span>
                <span class="rpt-fin-stat-value rpt-fin-red">{{ formatMoney(loanStore.monthlyPayment(loan)) }}</span>
              </div>
              <div class="rpt-fin-stat">
                <span class="rpt-fin-stat-label">Total interest</span>
                <span class="rpt-fin-stat-value rpt-fin-amber">{{ formatMoney(loanStore.totalInterest(loan)) }}</span>
              </div>
              <div class="rpt-fin-stat">
                <span class="rpt-fin-stat-label">Total cost</span>
                <span class="rpt-fin-stat-value rpt-fin-red">{{ formatMoney(loan.principal + loanStore.totalInterest(loan)) }}</span>
              </div>
            </div>

            <div class="reports-chart-wrap" style="height:220px">
              <canvas :ref="el => registerFinCanvas('loan', loan.id, el as HTMLCanvasElement | null)" />
            </div>
            <p class="rpt-chart-hint" style="margin-top:0.25rem">
              Scheduled balance (solid) · Cumulative interest (dashed)
              <template v-if="loan.linkedAccountId"> · Actual account balance (amber)</template>
            </p>
          </div>
        </div>

        <!-- Loan comparison table -->
        <div class="reports-card reports-card-span3" style="margin-top:0">
          <h3 class="reports-card-title">Loan Comparison</h3>
          <table class="rpt-table">
            <thead>
              <tr>
                <th>Name</th>
                <th class="rpt-num">Principal</th>
                <th class="rpt-num">APR</th>
                <th class="rpt-num">Term</th>
                <th class="rpt-num">Monthly</th>
                <th class="rpt-num">Total Interest</th>
                <th class="rpt-num">Total Cost</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="loan in loanStore.loans.filter(l => !l.archived)" :key="loan.id">
                <td>
                  <span class="rpt-fin-dot rpt-fin-dot--inline" :style="{ background: loan.color }" />
                  {{ loan.name }}
                </td>
                <td class="rpt-num">{{ formatMoney(loan.principal) }}</td>
                <td class="rpt-num rpt-fin-red">{{ loan.apr }}%</td>
                <td class="rpt-num rpt-muted">{{ loan.termMonths }}mo</td>
                <td class="rpt-num rpt-fin-red">{{ formatMoney(loanStore.monthlyPayment(loan)) }}</td>
                <td class="rpt-num rpt-fin-amber">{{ formatMoney(loanStore.totalInterest(loan)) }}</td>
                <td class="rpt-num rpt-fin-red">{{ formatMoney(loan.principal + loanStore.totalInterest(loan)) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ── Savings Accounts ───────────────────────── -->
      <template v-if="loanStore.savings.filter(s => !s.archived).length > 0">
        <h2 class="rpt-section-heading rpt-section-heading--green"><i class="pi pi-chart-line" /> Savings Accounts</h2>

        <div class="reports-grid">
          <div
            v-for="sav in loanStore.savings.filter(s => !s.archived)"
            :key="sav.id"
            class="reports-card reports-card-span3"
          >
            <div class="rpt-fin-card-header">
              <span class="rpt-fin-dot" :style="{ background: sav.color }" />
              <h3 class="rpt-fin-name">{{ sav.name }}</h3>
              <span class="rpt-fin-pill rpt-fin-pill--green">{{ sav.apr }}% APR</span>
              <span class="rpt-fin-pill">{{ sav.compoundFreq }}</span>
            </div>

            <div class="rpt-fin-stats">
              <div class="rpt-fin-stat">
                <span class="rpt-fin-stat-label">Opening balance</span>
                <span class="rpt-fin-stat-value">{{ formatMoney(sav.startBalance) }}</span>
              </div>
              <div class="rpt-fin-stat">
                <span class="rpt-fin-stat-label">Projected now</span>
                <span class="rpt-fin-stat-value rpt-fin-green">{{ formatMoney((() => { const p = loanStore.calcSavingsProjection(sav, Math.max(0, (new Date().getFullYear() - new Date(sav.startDate).getFullYear()) * 12 + new Date().getMonth() - new Date(sav.startDate).getMonth())); return p[p.length - 1]?.balance ?? sav.startBalance })()) }}</span>
              </div>
              <div class="rpt-fin-stat">
                <span class="rpt-fin-stat-label">Projected (5yr)</span>
                <span class="rpt-fin-stat-value rpt-fin-muted">{{ formatMoney(loanStore.calcSavingsProjection(sav, 60)[60]?.balance ?? sav.startBalance) }}</span>
              </div>
              <div class="rpt-fin-stat">
                <span class="rpt-fin-stat-label">Projected (10yr)</span>
                <span class="rpt-fin-stat-value rpt-fin-muted">{{ formatMoney(loanStore.calcSavingsProjection(sav, 120)[120]?.balance ?? sav.startBalance) }}</span>
              </div>
              <div v-if="sav.linkedAccountId" class="rpt-fin-stat">
                <span class="rpt-fin-stat-label">Actual balance</span>
                <span class="rpt-fin-stat-value" :style="{ color: sav.color }">{{ formatMoney(loanStore.accountNetBalance(sav.linkedAccountId)) }}</span>
              </div>
            </div>

            <div class="reports-chart-wrap" style="height:220px">
              <canvas :ref="el => registerFinCanvas('sav', sav.id, el as HTMLCanvasElement | null)" />
            </div>
            <p class="rpt-chart-hint" style="margin-top:0.25rem">
              Projected compound growth (solid) · Interest earned (dashed)
              <template v-if="sav.linkedAccountId"> · Actual account balance (amber)</template>
            </p>
          </div>
        </div>

        <!-- Savings comparison table -->
        <div class="reports-card reports-card-span3" style="margin-top:0">
          <h3 class="reports-card-title">Savings Account Comparison</h3>
          <table class="rpt-table">
            <thead>
              <tr>
                <th>Name</th>
                <th class="rpt-num">Opening</th>
                <th class="rpt-num">APR</th>
                <th class="rpt-num">Compounding</th>
                <th class="rpt-num">Proj. 1yr</th>
                <th class="rpt-num">Proj. 5yr</th>
                <th class="rpt-num">Proj. 10yr</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="sav in loanStore.savings.filter(s => !s.archived)" :key="sav.id">
                <td>
                  <span class="rpt-fin-dot rpt-fin-dot--inline" :style="{ background: sav.color }" />
                  {{ sav.name }}
                </td>
                <td class="rpt-num">{{ formatMoney(sav.startBalance) }}</td>
                <td class="rpt-num rpt-fin-green">{{ sav.apr }}%</td>
                <td class="rpt-num rpt-muted">{{ sav.compoundFreq }}</td>
                <td class="rpt-num rpt-fin-green">{{ formatMoney(loanStore.calcSavingsProjection(sav, 12)[12]?.balance ?? sav.startBalance) }}</td>
                <td class="rpt-num rpt-fin-green">{{ formatMoney(loanStore.calcSavingsProjection(sav, 60)[60]?.balance ?? sav.startBalance) }}</td>
                <td class="rpt-num rpt-fin-green">{{ formatMoney(loanStore.calcSavingsProjection(sav, 120)[120]?.balance ?? sav.startBalance) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

    </template>

  </div>
</template>