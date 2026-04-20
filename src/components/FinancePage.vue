<script setup lang="ts">
import { ref, computed, nextTick, onUnmounted } from 'vue'
import { Chart, registerables } from 'chart.js'
import { useLoanStore } from '../stores/loanStore'
import type { LoanRecord, SavingsAccountRecord } from '../stores/loanStore'
import { useAccountStore } from '../stores/accountStore'
import { useSettingsStore } from '../stores/settingsStore'
import { getTodayStr } from '../utils/date'

Chart.register(...registerables)

const store    = useLoanStore()
const accounts = useAccountStore()
const settings = useSettingsStore()

function fmt(v: number): string { return settings.formatMoney(v) }

const today = getTodayStr()

// ── Active tab ─────────────────────────────────────────────────
const activeTab    = ref<'loans' | 'savings'>('loans')
const showArchived = ref(false)

const activeLoans = computed(() => store.loans.filter(l => showArchived.value || !l.archived))
const activeSavs  = computed(() => store.savings.filter(s => showArchived.value || !s.archived))

// ── Theme helpers (for charts) ────────────────────────────────
const isDark     = computed(() => ['dark', 'midnight', 'forest', 'purple'].includes(settings.theme))
const gridColor  = computed(() => isDark.value ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)')
const labelColor = computed(() => isDark.value ? '#a1a1aa' : '#71717a')

// ── Expanded cards ────────────────────────────────────────────
const expandedLoanIds = ref<number[]>([])
const expandedSavIds  = ref<number[]>([])

function toggleLoanExpand(id: number): void {
  const idx = expandedLoanIds.value.indexOf(id)
  if (idx !== -1) {
    expandedLoanIds.value.splice(idx, 1)
    const c = loanCharts.get(id)
    if (c) { c.destroy(); loanCharts.delete(id) }
  } else {
    expandedLoanIds.value.push(id)
    nextTick(() => mountLoanChart(id))
  }
}

function toggleSavExpand(id: number): void {
  const idx = expandedSavIds.value.indexOf(id)
  if (idx !== -1) {
    expandedSavIds.value.splice(idx, 1)
    const c = savCharts.get(id)
    if (c) { c.destroy(); savCharts.delete(id) }
  } else {
    expandedSavIds.value.push(id)
    nextTick(() => mountSavChart(id))
  }
}

// ── Chart instances ───────────────────────────────────────────
const loanCharts = new Map<number, Chart>()
const savCharts  = new Map<number, Chart>()

onUnmounted(() => {
  loanCharts.forEach(c => c.destroy())
  savCharts.forEach(c => c.destroy())
})

function mountLoanChart(id: number): void {
  const loan   = store.loans.find(l => l.id === id)
  const canvas = document.getElementById(`loan-chart-${id}`) as HTMLCanvasElement | null
  if (!loan || !canvas) return

  const existing = loanCharts.get(id)
  if (existing) { existing.destroy(); loanCharts.delete(id) }

  const rows   = store.calcAmortization(loan)
  const labels = rows.map(r => r.date)

  // Scheduled balance line
  const balances = rows.map(r => r.closingBalance)

  // Cumulative interest paid
  let cumInt = 0
  const cumInterest = rows.map(r => { cumInt += r.interestPaid; return Math.round(cumInt * 100) / 100 })

  // Actual balance from linked account (forward-filled)
  let actualPoints: (number | null)[] | null = null
  if (loan.linkedAccountId) {
    const byMonth  = store.buildMonthlyRunningBalance(loan.linkedAccountId)
    const startYM  = loan.startDate.slice(0, 7)
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
      fill: true,
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.4,
      order: 2,
    },
    {
      label: 'Cumulative interest',
      data: cumInterest,
      borderColor: '#ef444488',
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderDash: [5, 3],
      pointRadius: 0,
      tension: 0.4,
      order: 3,
    },
  ]
  if (actualPoints) {
    datasets.push({
      label: 'Actual account balance',
      data: actualPoints,
      borderColor: '#f59e0b',
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderDash: [4, 4],
      pointRadius: 3,
      tension: 0.3,
      spanGaps: true,
      order: 1,
    })
  }

  const chart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: labelColor.value, font: { size: 10 }, boxWidth: 12 } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } },
      },
      scales: {
        x: { ticks: { color: labelColor.value, font: { size: 9 }, maxTicksLimit: 10 }, grid: { color: gridColor.value } },
        y: { ticks: { color: labelColor.value, font: { size: 9 }, callback: (v) => fmt(Number(v)) }, grid: { color: gridColor.value } },
      },
    },
  })
  loanCharts.set(id, chart)
}

function mountSavChart(id: number): void {
  const sav    = store.savings.find(s => s.id === id)
  const canvas = document.getElementById(`sav-chart-${id}`) as HTMLCanvasElement | null
  if (!sav || !canvas) return

  const existing = savCharts.get(id)
  if (existing) { existing.destroy(); savCharts.delete(id) }

  // Project: whichever is longer — 5 years from start, or 1 year beyond today
  const start = new Date(sav.startDate + 'T00:00:00')
  const now   = new Date()
  const elapsed = Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth())
  const projMonths = Math.max(60, elapsed + 12)

  const projection = store.calcSavingsProjection(sav, projMonths)
  const labels     = projection.map(p => p.date)
  const projected  = projection.map(p => p.balance)

  // Interest earned line
  const interestLine = projected.map(b => Math.round((b - sav.startBalance) * 100) / 100)

  // Actual account balance
  let actualPoints: (number | null)[] | null = null
  if (sav.linkedAccountId) {
    const byMonth  = store.buildMonthlyRunningBalance(sav.linkedAccountId)
    const startYM  = sav.startDate.slice(0, 7)
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
      fill: true,
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.4,
      order: 2,
    },
    {
      label: 'Projected interest earned',
      data: interestLine,
      borderColor: '#10b98188',
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderDash: [5, 3],
      pointRadius: 0,
      tension: 0.4,
      order: 3,
    },
  ]
  if (actualPoints) {
    datasets.push({
      label: 'Actual account balance',
      data: actualPoints,
      borderColor: '#f59e0b',
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderDash: [4, 4],
      pointRadius: 3,
      tension: 0.3,
      spanGaps: true,
      order: 1,
    })
  }

  const chart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: labelColor.value, font: { size: 10 }, boxWidth: 12 } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } },
      },
      scales: {
        x: { ticks: { color: labelColor.value, font: { size: 9 }, maxTicksLimit: 10 }, grid: { color: gridColor.value } },
        y: { ticks: { color: labelColor.value, font: { size: 9 }, callback: (v) => fmt(Number(v)) }, grid: { color: gridColor.value } },
      },
    },
  })
  savCharts.set(id, chart)
}

// ── Loan derived stats ────────────────────────────────────────
interface LoanStats {
  monthly: number; totalInt: number; paidOff: number; remaining: number
  scheduledBalance: number; interestPaid: number; pct: number; endStr: string
}

function loanStats(loan: LoanRecord): LoanStats {
  const rows    = store.calcAmortization(loan)
  const monthly = store.monthlyPayment(loan)
  const totalInt = store.totalInterest(loan)

  const start   = new Date(loan.startDate + 'T00:00:00')
  const now     = new Date()
  const elapsed = Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth())
  const paidOff = Math.min(elapsed, loan.termMonths)
  const remaining = loan.termMonths - paidOff

  const scheduledBalance = paidOff < rows.length ? rows[paidOff].closingBalance : 0
  const interestPaid = Math.round(rows.slice(0, paidOff).reduce((s, r) => s + r.interestPaid, 0) * 100) / 100
  const pct = Math.min(100, Math.round((paidOff / loan.termMonths) * 100))

  const endDate = new Date(start)
  endDate.setMonth(endDate.getMonth() + loan.termMonths)
  const endStr = endDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short' })

  return { monthly, totalInt, paidOff, remaining, scheduledBalance, interestPaid, pct, endStr }
}

const loanStatsMap = computed(() => {
  const m = new Map<number, LoanStats>()
  for (const l of store.loans) m.set(l.id, loanStats(l))
  return m
})

// ── Savings account derived stats ─────────────────────────────
interface SavStats {
  projectedNow: number; interestEarned: number; actualBalance: number | null
  proj5y: number; proj10y: number
}

function savStats(sav: SavingsAccountRecord): SavStats {
  const freqMap: Record<string, number> = { monthly: 12, quarterly: 4, annually: 1 }
  const ppy   = freqMap[sav.compoundFreq]
  const r     = sav.apr / 100 / ppy
  const ppm   = ppy / 12

  const start   = new Date(sav.startDate + 'T00:00:00')
  const now     = new Date()
  const elapsed = Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth())

  const projectedNow  = Math.round(sav.startBalance * Math.pow(1 + r, elapsed * ppm) * 100) / 100
  const interestEarned = Math.round((projectedNow - sav.startBalance) * 100) / 100
  const proj5y  = Math.round(sav.startBalance * Math.pow(1 + r, 60  * ppm) * 100) / 100
  const proj10y = Math.round(sav.startBalance * Math.pow(1 + r, 120 * ppm) * 100) / 100
  const actualBalance = sav.linkedAccountId ? store.accountNetBalance(sav.linkedAccountId) : null

  return { projectedNow, interestEarned, actualBalance, proj5y, proj10y }
}

const savStatsMap = computed(() => {
  const m = new Map<number, SavStats>()
  for (const s of store.savings) m.set(s.id, savStats(s))
  return m
})

// ── Loan form ─────────────────────────────────────────────────
const showLoanForm  = ref(false)
const editLoanId    = ref<number | null>(null)
const loanName      = ref('')
const loanPrincipal = ref('')
const loanApr       = ref('')
const loanTerm      = ref('')
const loanStart     = ref(today)
const loanAccount   = ref('')

function openLoanForm(loan?: LoanRecord): void {
  editLoanId.value    = loan?.id ?? null
  loanName.value      = loan?.name ?? ''
  loanPrincipal.value = loan ? String(loan.principal) : ''
  loanApr.value       = loan ? String(loan.apr) : ''
  loanTerm.value      = loan ? String(loan.termMonths) : ''
  loanStart.value     = loan?.startDate ?? today
  loanAccount.value   = loan?.linkedAccountId ?? ''
  showLoanForm.value  = true
}

function closeLoanForm(): void { showLoanForm.value = false; editLoanId.value = null }

function submitLoan(): void {
  const name = loanName.value.trim()
  const P    = parseFloat(loanPrincipal.value)
  const apr  = parseFloat(loanApr.value)
  const term = parseInt(loanTerm.value)
  if (!name || isNaN(P) || P <= 0 || isNaN(apr) || apr < 0 || isNaN(term) || term < 1) return
  if (editLoanId.value !== null) {
    store.updateLoan(editLoanId.value, {
      name, principal: P, apr, termMonths: term,
      startDate: loanStart.value, linkedAccountId: loanAccount.value || undefined,
    })
    const eid = editLoanId.value
    if (expandedLoanIds.value.includes(eid)) nextTick(() => mountLoanChart(eid))
  } else {
    store.addLoan(name, P, apr, term, loanStart.value, loanAccount.value || undefined)
  }
  closeLoanForm()
}

// ── Savings account form ──────────────────────────────────────
const showSavForm   = ref(false)
const editSavId     = ref<number | null>(null)
const savName       = ref('')
const savApr        = ref('')
const savFreq       = ref<'monthly' | 'quarterly' | 'annually'>('monthly')
const savStart      = ref(today)
const savStartBal   = ref('')
const savAccount    = ref('')

function openSavForm(sav?: SavingsAccountRecord): void {
  editSavId.value   = sav?.id ?? null
  savName.value     = sav?.name ?? ''
  savApr.value      = sav ? String(sav.apr) : ''
  savFreq.value     = sav?.compoundFreq ?? 'monthly'
  savStart.value    = sav?.startDate ?? today
  savStartBal.value = sav ? String(sav.startBalance) : ''
  savAccount.value  = sav?.linkedAccountId ?? ''
  showSavForm.value = true
}

function closeSavForm(): void { showSavForm.value = false; editSavId.value = null }

function submitSav(): void {
  const name = savName.value.trim()
  const apr  = parseFloat(savApr.value)
  const bal  = parseFloat(savStartBal.value)
  if (!name || isNaN(apr) || apr < 0 || isNaN(bal) || bal < 0) return
  if (editSavId.value !== null) {
    store.updateSavingsAccount(editSavId.value, {
      name, apr, compoundFreq: savFreq.value,
      startDate: savStart.value, startBalance: bal,
      linkedAccountId: savAccount.value || undefined,
    })
    const eid = editSavId.value
    if (expandedSavIds.value.includes(eid)) nextTick(() => mountSavChart(eid))
  } else {
    store.addSavingsAccount(name, apr, savFreq.value, bal, savStart.value, savAccount.value || undefined)
  }
  closeSavForm()
}

function loanProgressLabel(loan: LoanRecord): string {
  const s = loanStatsMap.value.get(loan.id)!
  return `${fmt(loan.principal - s.scheduledBalance)} paid · ${fmt(s.scheduledBalance)} remaining · ends ${s.endStr}`
}
</script>

<template>
  <div class="fn-page">

    <!-- Header -->
    <div class="fn-header">
      <div>
        <h1 class="fn-title">Finance</h1>
        <p class="fn-subtitle">Loans &amp; Interest-Bearing Savings</p>
      </div>
      <div class="fn-header-actions">
        <label class="fn-archive-toggle">
          <input type="checkbox" v-model="showArchived" />
          Show archived
        </label>
        <button v-if="activeTab === 'loans'" class="fn-add-btn" @click="openLoanForm()">
          <i class="pi pi-plus" /> New Loan
        </button>
        <button v-else class="fn-add-btn fn-add-btn--sav" @click="openSavForm()">
          <i class="pi pi-plus" /> New Savings Account
        </button>
      </div>
    </div>

    <!-- Tabs -->
    <div class="fn-tabs">
      <button
        class="fn-tab"
        :class="{ 'fn-tab--active': activeTab === 'loans' }"
        @click="activeTab = 'loans'"
      >
        <i class="pi pi-credit-card" />
        Loans
        <span class="fn-tab-badge">{{ store.loans.filter(l => !l.archived).length }}</span>
      </button>
      <button
        class="fn-tab"
        :class="{ 'fn-tab--active fn-tab--sav-active': activeTab === 'savings' }"
        @click="activeTab = 'savings'"
      >
        <i class="pi pi-chart-line" />
        Savings Accounts
        <span class="fn-tab-badge fn-tab-badge--sav">{{ store.savings.filter(s => !s.archived).length }}</span>
      </button>
    </div>

    <!-- ═══════════════ LOANS ═══════════════ -->
    <template v-if="activeTab === 'loans'">

      <!-- Form -->
      <div v-if="showLoanForm" class="fn-form-card">
        <h3 class="fn-form-title">{{ editLoanId ? 'Edit Loan' : 'New Loan' }}</h3>
        <div class="fn-form-grid">
          <div class="fn-form-group">
            <label class="fn-label">Name</label>
            <input class="fn-input" v-model="loanName" placeholder="e.g. Car Loan" @keydown.escape="closeLoanForm" autofocus />
          </div>
          <div class="fn-form-group">
            <label class="fn-label">Principal <span class="fn-label-hint">(loan amount)</span></label>
            <input class="fn-input" type="number" min="0.01" step="0.01" v-model="loanPrincipal" placeholder="15000.00" />
          </div>
          <div class="fn-form-group">
            <label class="fn-label">APR % <span class="fn-label-hint">(annual rate)</span></label>
            <input class="fn-input" type="number" min="0" step="0.01" v-model="loanApr" placeholder="5.5" />
          </div>
          <div class="fn-form-group">
            <label class="fn-label">Term <span class="fn-label-hint">(months)</span></label>
            <input class="fn-input" type="number" min="1" step="1" v-model="loanTerm" placeholder="60" />
          </div>
          <div class="fn-form-group">
            <label class="fn-label">Start date</label>
            <input class="fn-input" type="date" v-model="loanStart" />
          </div>
          <div class="fn-form-group">
            <label class="fn-label">Linked account <span class="fn-label-hint">(optional)</span></label>
            <select class="fn-input" v-model="loanAccount">
              <option value="">— None —</option>
              <option v-for="acc in accounts.accounts" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
            </select>
          </div>
        </div>
        <!-- Preview monthly payment -->
        <div
          v-if="loanPrincipal && loanApr && loanTerm && parseFloat(loanPrincipal) > 0 && parseInt(loanTerm) > 0"
          class="fn-form-preview"
        >
          <i class="pi pi-info-circle" />
          Monthly payment:
          <strong>{{ fmt(store.monthlyPayment({ principal: parseFloat(loanPrincipal), apr: parseFloat(loanApr) || 0, termMonths: parseInt(loanTerm), id: 0, name: '', startDate: '', color: '', createdAt: '', archived: false })) }}</strong>
          · Total interest:
          <strong>{{ fmt(store.totalInterest({ principal: parseFloat(loanPrincipal), apr: parseFloat(loanApr) || 0, termMonths: parseInt(loanTerm), id: 0, name: '', startDate: '', color: '', createdAt: '', archived: false })) }}</strong>
        </div>
        <div class="fn-form-actions">
          <button
            class="fn-btn fn-btn--primary"
            @click="submitLoan"
            :disabled="!loanName.trim() || !loanPrincipal || !loanTerm || parseFloat(loanPrincipal) <= 0 || parseInt(loanTerm) < 1"
          >{{ editLoanId ? 'Save Changes' : 'Add Loan' }}</button>
          <button class="fn-btn fn-btn--ghost" @click="closeLoanForm">Cancel</button>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="store.loans.length === 0 && !showLoanForm" class="fn-empty">
        <i class="pi pi-credit-card fn-empty-icon" />
        <p class="fn-empty-title">No loans tracked</p>
        <p class="fn-empty-sub">Add mortgages, car loans, personal loans — see your amortization schedule, monthly payment, and total interest cost.</p>
        <button class="fn-btn fn-btn--primary" @click="openLoanForm()">Add your first loan</button>
      </div>

      <!-- Loans list -->
      <div class="fn-cards">
        <div
          v-for="loan in activeLoans"
          :key="loan.id"
          class="fn-card"
          :class="{ 'fn-card--archived': loan.archived }"
        >

          <!-- Card header -->
          <div class="fn-card-header">
            <div class="fn-color-dot" :style="{ background: loan.color }" />
            <div class="fn-card-title-wrap">
              <span class="fn-card-name">{{ loan.name }}</span>
              <span v-if="loan.linkedAccountId" class="fn-linked-badge">
                <i class="pi pi-link" />
                {{ accounts.accounts.find(a => a.id === loan.linkedAccountId)?.name ?? 'Linked account' }}
              </span>
            </div>
            <div class="fn-card-meta">
              <span class="fn-meta-pill fn-meta-pill--red">{{ loan.apr }}% APR</span>
              <span class="fn-meta-pill">{{ loan.termMonths }}mo</span>
            </div>
            <div class="fn-card-actions">
              <button class="fn-icon-btn" title="Edit" @click="openLoanForm(loan)"><i class="pi pi-pencil" /></button>
              <button class="fn-icon-btn" :title="loan.archived ? 'Unarchive' : 'Archive'" @click="store.updateLoan(loan.id, { archived: !loan.archived })">
                <i :class="loan.archived ? 'pi pi-eye' : 'pi pi-eye-slash'" />
              </button>
              <button class="fn-icon-btn fn-icon-btn--danger" title="Delete" @click="store.deleteLoan(loan.id)">
                <i class="pi pi-trash" />
              </button>
              <button
                class="fn-icon-btn fn-icon-btn--chart"
                :title="expandedLoanIds.includes(loan.id) ? 'Hide chart' : 'Show chart'"
                @click="toggleLoanExpand(loan.id)"
              >
                <i :class="expandedLoanIds.includes(loan.id) ? 'pi pi-angle-up' : 'pi pi-chart-line'" />
              </button>
            </div>
          </div>

          <!-- Stats -->
          <template v-if="!loan.archived && loanStatsMap.has(loan.id)">
            <div class="fn-stats-row">
              <div class="fn-stat">
                <span class="fn-stat-label">Monthly payment</span>
                <span class="fn-stat-value fn-stat-value--red">{{ fmt(loanStatsMap.get(loan.id)!.monthly) }}</span>
              </div>
              <div class="fn-stat">
                <span class="fn-stat-label">Remaining balance</span>
                <span class="fn-stat-value">{{ fmt(loanStatsMap.get(loan.id)!.scheduledBalance) }}</span>
              </div>
              <div class="fn-stat">
                <span class="fn-stat-label">Interest paid</span>
                <span class="fn-stat-value fn-stat-value--amber">{{ fmt(loanStatsMap.get(loan.id)!.interestPaid) }}</span>
              </div>
              <div class="fn-stat">
                <span class="fn-stat-label">Total interest</span>
                <span class="fn-stat-value fn-stat-value--muted">{{ fmt(loanStatsMap.get(loan.id)!.totalInt) }}</span>
              </div>
              <div class="fn-stat">
                <span class="fn-stat-label">Progress</span>
                <span class="fn-stat-value" :style="{ color: loan.color }">{{ loanStatsMap.get(loan.id)!.pct }}%</span>
              </div>
              <div class="fn-stat">
                <span class="fn-stat-label">Months left</span>
                <span class="fn-stat-value">{{ loanStatsMap.get(loan.id)!.remaining }}</span>
              </div>
            </div>

            <!-- Progress bar -->
            <div class="fn-progress-wrap">
              <div class="fn-progress-track">
                <div
                  class="fn-progress-fill"
                  :style="{ width: loanStatsMap.get(loan.id)!.pct + '%', background: loan.color }"
                />
              </div>
              <span class="fn-progress-label">{{ loanProgressLabel(loan) }}</span>
            </div>
          </template>

          <!-- Chart -->
          <div v-if="expandedLoanIds.includes(loan.id)" class="fn-chart-area">
            <div class="fn-chart-legend-row">
              <span class="fn-chart-legend-item">
                <span class="fn-chart-legend-dot" :style="{ background: loan.color }" />Scheduled balance
              </span>
              <span class="fn-chart-legend-item">
                <span class="fn-chart-legend-line fn-chart-legend-line--red" />Cumulative interest
              </span>
              <span v-if="loan.linkedAccountId" class="fn-chart-legend-item">
                <span class="fn-chart-legend-line fn-chart-legend-line--amber" />Actual balance
              </span>
            </div>
            <div class="fn-chart-canvas-wrap">
              <canvas :id="`loan-chart-${loan.id}`" />
            </div>
          </div>

        </div>
      </div>

    </template>

    <!-- ═══════════════ SAVINGS ACCOUNTS ═══════════════ -->
    <template v-else>

      <!-- Form -->
      <div v-if="showSavForm" class="fn-form-card fn-form-card--sav">
        <h3 class="fn-form-title">{{ editSavId ? 'Edit Savings Account' : 'New Savings Account' }}</h3>
        <div class="fn-form-grid">
          <div class="fn-form-group">
            <label class="fn-label">Name</label>
            <input class="fn-input" v-model="savName" placeholder="e.g. High-Yield Savings" @keydown.escape="closeSavForm" autofocus />
          </div>
          <div class="fn-form-group">
            <label class="fn-label">APR % <span class="fn-label-hint">(annual rate)</span></label>
            <input class="fn-input" type="number" min="0" step="0.01" v-model="savApr" placeholder="3.5" />
          </div>
          <div class="fn-form-group">
            <label class="fn-label">Compounding</label>
            <select class="fn-input" v-model="savFreq">
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annually">Annually</option>
            </select>
          </div>
          <div class="fn-form-group">
            <label class="fn-label">Opening balance</label>
            <input class="fn-input" type="number" min="0" step="0.01" v-model="savStartBal" placeholder="5000.00" />
          </div>
          <div class="fn-form-group">
            <label class="fn-label">Start date</label>
            <input class="fn-input" type="date" v-model="savStart" />
          </div>
          <div class="fn-form-group">
            <label class="fn-label">Linked account <span class="fn-label-hint">(optional)</span></label>
            <select class="fn-input" v-model="savAccount">
              <option value="">— None —</option>
              <option v-for="acc in accounts.accounts" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
            </select>
          </div>
        </div>
        <div class="fn-form-actions">
          <button
            class="fn-btn fn-btn--sav"
            @click="submitSav"
            :disabled="!savName.trim() || !savApr || !savStartBal || parseFloat(savStartBal) < 0"
          >{{ editSavId ? 'Save Changes' : 'Add Account' }}</button>
          <button class="fn-btn fn-btn--ghost" @click="closeSavForm">Cancel</button>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="store.savings.length === 0 && !showSavForm" class="fn-empty fn-empty--sav">
        <i class="pi pi-chart-line fn-empty-icon fn-empty-icon--sav" />
        <p class="fn-empty-title">No savings accounts tracked</p>
        <p class="fn-empty-sub">Track ISAs, high-yield savings, fixed-rate bonds — see projected compound growth and compare against your actual account balance.</p>
        <button class="fn-btn fn-btn--sav" @click="openSavForm()">Add savings account</button>
      </div>

      <!-- Savings list -->
      <div class="fn-cards">
        <div
          v-for="sav in activeSavs"
          :key="sav.id"
          class="fn-card fn-card--sav"
          :class="{ 'fn-card--archived': sav.archived }"
        >

          <div class="fn-card-header">
            <div class="fn-color-dot" :style="{ background: sav.color }" />
            <div class="fn-card-title-wrap">
              <span class="fn-card-name">{{ sav.name }}</span>
              <span v-if="sav.linkedAccountId" class="fn-linked-badge">
                <i class="pi pi-link" />
                {{ accounts.accounts.find(a => a.id === sav.linkedAccountId)?.name ?? 'Linked account' }}
              </span>
            </div>
            <div class="fn-card-meta">
              <span class="fn-meta-pill fn-meta-pill--green">{{ sav.apr }}% APR</span>
              <span class="fn-meta-pill">{{ sav.compoundFreq }}</span>
            </div>
            <div class="fn-card-actions">
              <button class="fn-icon-btn" title="Edit" @click="openSavForm(sav)"><i class="pi pi-pencil" /></button>
              <button class="fn-icon-btn" :title="sav.archived ? 'Unarchive' : 'Archive'" @click="store.updateSavingsAccount(sav.id, { archived: !sav.archived })">
                <i :class="sav.archived ? 'pi pi-eye' : 'pi pi-eye-slash'" />
              </button>
              <button class="fn-icon-btn fn-icon-btn--danger" title="Delete" @click="store.deleteSavingsAccount(sav.id)">
                <i class="pi pi-trash" />
              </button>
              <button
                class="fn-icon-btn fn-icon-btn--chart"
                :title="expandedSavIds.includes(sav.id) ? 'Hide chart' : 'Show chart'"
                @click="toggleSavExpand(sav.id)"
              >
                <i :class="expandedSavIds.includes(sav.id) ? 'pi pi-angle-up' : 'pi pi-chart-line'" />
              </button>
            </div>
          </div>

          <template v-if="!sav.archived && savStatsMap.has(sav.id)">
            <div class="fn-stats-row">
              <div class="fn-stat">
                <span class="fn-stat-label">Opening balance</span>
                <span class="fn-stat-value">{{ fmt(sav.startBalance) }}</span>
              </div>
              <div class="fn-stat">
                <span class="fn-stat-label">Projected now</span>
                <span class="fn-stat-value fn-stat-value--green">{{ fmt(savStatsMap.get(sav.id)!.projectedNow) }}</span>
              </div>
              <div class="fn-stat">
                <span class="fn-stat-label">Interest earned</span>
                <span class="fn-stat-value fn-stat-value--green">{{ fmt(savStatsMap.get(sav.id)!.interestEarned) }}</span>
              </div>
              <div class="fn-stat">
                <span class="fn-stat-label">Projected (5yr)</span>
                <span class="fn-stat-value fn-stat-value--muted">{{ fmt(savStatsMap.get(sav.id)!.proj5y) }}</span>
              </div>
              <div class="fn-stat">
                <span class="fn-stat-label">Projected (10yr)</span>
                <span class="fn-stat-value fn-stat-value--muted">{{ fmt(savStatsMap.get(sav.id)!.proj10y) }}</span>
              </div>
              <div v-if="savStatsMap.get(sav.id)!.actualBalance !== null" class="fn-stat">
                <span class="fn-stat-label">Actual balance</span>
                <span class="fn-stat-value" :style="{ color: sav.color }">{{ fmt(savStatsMap.get(sav.id)!.actualBalance!) }}</span>
              </div>
            </div>
          </template>

          <!-- Chart -->
          <div v-if="expandedSavIds.includes(sav.id)" class="fn-chart-area">
            <div class="fn-chart-legend-row">
              <span class="fn-chart-legend-item">
                <span class="fn-chart-legend-dot" :style="{ background: sav.color }" />Projected
              </span>
              <span class="fn-chart-legend-item">
                <span class="fn-chart-legend-line fn-chart-legend-line--green" />Interest earned
              </span>
              <span v-if="sav.linkedAccountId" class="fn-chart-legend-item">
                <span class="fn-chart-legend-line fn-chart-legend-line--amber" />Actual balance
              </span>
            </div>
            <div class="fn-chart-canvas-wrap">
              <canvas :id="`sav-chart-${sav.id}`" />
            </div>
          </div>

        </div>
      </div>

    </template>

  </div>
</template>
