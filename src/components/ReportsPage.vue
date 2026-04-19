<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { Chart, registerables } from 'chart.js'
import { useTransactionStore } from '../stores/transactionStore'
import { useAccountStore } from '../stores/accountStore'
import { useBudgetStore } from '../stores/budgetStore'
import { useSettingsStore } from '../stores/settingsStore'

Chart.register(...registerables)

const txStore      = useTransactionStore()
const accountStore = useAccountStore()
const budgetStore  = useBudgetStore()
const settings     = useSettingsStore()

function formatMoney(v: number): string { return settings.formatMoney(v) }

// ── Theme ──────────────────────────────────────────────────────
const isDark  = computed(() => settings.theme === 'dark')
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
type Tab = 'overall' | 'breakdown' | 'items'
const activeTab = ref<Tab>('overall')

type BreakdownSubTab = 'year' | 'accounts' | 'month'
const breakdownSubTab = ref<BreakdownSubTab>('year')
const tabs: { id: Tab; label: string }[] = [
  { id: 'overall',   label: 'Overview'   },
  { id: 'breakdown', label: 'Breakdown'  },
  { id: 'items',     label: 'Items'      },
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

// ──────────────────────────────────────────────────────────────
// MONTHLY TAB DATA
// ──────────────────────────────────────────────────────────────
const selYear  = computed(() => parseInt(selectedMonthKey.value.split('-')[0]))
const selMonth = computed(() => parseInt(selectedMonthKey.value.split('-')[1]))

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
    const idx = parseInt(t.date.split('-')[2]) - 1
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

const accountTrend = computed(() =>
  accountStore.accounts.map((acc, i) => ({
    name:     acc.name,
    color:    PALETTE[i % PALETTE.length],
    balances: trendMonths.value.map(({ key }) =>
      txStore.transactions
        .filter(t => t.accountId === acc.id && t.date.substring(0, 7) <= key)
        .reduce((s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0)
    ),
  }))
)

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
      plugins: { legend: { labels: { color: tc } }, tooltip: { callbacks: { label: ctx => ` ${formatMoney(ctx.parsed.y)}` } } },
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
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${formatMoney(ctx.parsed.y)}` } } },
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
      plugins: { legend: { labels: { color: tc } }, tooltip: { callbacks: { label: ctx => ` ${formatMoney(ctx.parsed.y)}` } } },
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
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${formatMoney(ctx.parsed.x)}` } } },
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
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatMoney(ctx.parsed.y)}` } },
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
        tooltip: { callbacks: { label: ctx => ` ${formatMoney(ctx.parsed.x)}` } },
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
      plugins: { legend: { labels: { color: tc } }, tooltip: { callbacks: { label: ctx => ` ${formatMoney(ctx.parsed.y)}` } } },
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
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${formatMoney(ctx.parsed.y)}` } } },
      scales: {
        x: { ticks: { color: tc }, grid: { color: gc } },
        y: { ticks: { color: tc, callback: money }, grid: { color: gc } },
      },
    },
  }))
}

function buildBreakdown(): void {
  if (breakdownSubTab.value === 'year')     { buildYear() }
  else if (breakdownSubTab.value === 'accounts') { buildAccounts() }
  else                                      { buildMonthly() }
}

function buildTab(tab: Tab): void {
  destroyAll()
  if (tab === 'overall')   buildOverall()
  if (tab === 'breakdown') buildBreakdown()
  if (tab === 'items')     return // no charts on items tab
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

    </template>

    <!-- ITEMS -->
    <template v-if="activeTab === 'items'">
      <div class="reports-stats">
        <div class="reports-stat-card">
          <span class="reports-stat-label">Total Spent</span>
          <span class="reports-stat-value money-negative">{{ formatMoney(itemsTotalSpent) }}</span>
        </div>
        <div class="reports-stat-card">
          <span class="reports-stat-label">Unassigned Spend</span>
          <span class="reports-stat-value" :class="itemsUnassigned > 0 ? 'money-negative' : 'rpt-muted'">{{ formatMoney(itemsUnassigned) }}</span>
        </div>
      </div>
      <div v-if="itemsData.length === 0" class="rpt-empty rpt-empty-lg">
        No spending recorded against budget items yet.
      </div>
      <div v-else class="reports-grid">
        <div class="reports-card reports-card-span3">
          <h3 class="reports-card-title">Item Breakdown (All Time)</h3>
          <table class="rpt-table">
            <thead>
              <tr>
                <th>Item</th>
                <th class="rpt-num">Spent</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in itemsData" :key="item.id">
                <td>{{ item.name }}</td>
                <td class="rpt-num">{{ formatMoney(item.activity) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

  </div>
</template>