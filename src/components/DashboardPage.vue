<script setup lang="ts">
import { computed } from 'vue'
import { useTransactionStore } from '../stores/transactionStore'
import { useAccountStore }     from '../stores/accountStore'
import { useBudgetStore }      from '../stores/budgetStore'
import { useSettingsStore }    from '../stores/settingsStore'
import { useLoanStore }        from '../stores/loanStore'

const txStore      = useTransactionStore()
const accountStore = useAccountStore()
const budgetStore  = useBudgetStore()
const settings     = useSettingsStore()
const loanStore    = useLoanStore()

function formatMoney(v: number): string { return settings.formatMoney(v) }

const emit = defineEmits<{
  navigate:            [page: string]
  viewTransactions:    [month: string]
  viewSearchFor:       [name: string]
}>()

// ── Current month ─────────────────────────────────────────────
const _now       = new Date()
const _thisYear  = _now.getFullYear()
const _thisMonth = _now.getMonth() + 1
const _monthKey  = `${_thisYear}-${String(_thisMonth).padStart(2, '0')}`
const _monthLabel = _now.toLocaleDateString(settings.locale, { month: 'long', year: 'numeric' })

const thisMonthTxs = computed(() =>
  txStore.transactions.filter(t => t.date.startsWith(_monthKey))
)

const monthIn  = computed(() => thisMonthTxs.value.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0))
const monthOut = computed(() => thisMonthTxs.value.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0))
const monthNet = computed(() => monthIn.value - monthOut.value)

// ── Savings rate ──────────────────────────────────────────────
const savingsRate = computed(() =>
  monthIn.value > 0 ? Math.round(((monthIn.value - monthOut.value) / monthIn.value) * 100) : 0
)

// ── Account balances ──────────────────────────────────────────
const accountBalances = computed(() =>
  accountStore.accounts.map(acc => {
    const balance = txStore.transactions.reduce((s, t) => {
      if (t.accountId !== acc.id) return s
      return s + (t.type === 'in' ? t.amount : -t.amount)
    }, 0)
    return { id: acc.id, name: acc.name, balance: Math.round(balance * 100) / 100 }
  })
)

const totalBalance = computed(() =>
  Math.round(accountBalances.value.reduce((s, a) => s + a.balance, 0) * 100) / 100
)

// ── Budget status ─────────────────────────────────────────────
const budgetStatus = computed(() => {
  const items = budgetStore.items
  if (items.length === 0) return null
  const rows = items.map(item => {
    const activity  = txStore.getItemActivity(item.id, _thisYear, _thisMonth)
    const available = Math.round((item.assigned - activity) * 100) / 100
    const pct       = item.assigned > 0 ? Math.min(100, Math.round((activity / item.assigned) * 100)) : (activity > 0 ? 100 : 0)
    return { ...item, activity, available, pct }
  })
  const totalAssigned = Math.round(rows.reduce((s, r) => s + r.assigned, 0) * 100) / 100
  const totalActivity = Math.round(rows.reduce((s, r) => s + r.activity, 0) * 100) / 100
  const overCount     = rows.filter(r => r.available < 0).length
  const onTrack       = rows.filter(r => r.available >= 0).length
  const overallPct    = totalAssigned > 0 ? Math.min(100, Math.round((totalActivity / totalAssigned) * 100)) : 0
  const topRows       = rows.slice().sort((a, b) => b.pct - a.pct).slice(0, 5)
  return { totalAssigned, totalActivity, overCount, onTrack, overallPct, topRows }
})

// ── Top spending (this month) ─────────────────────────────────
const topSpending = computed(() => {
  const map = new Map<string, number>()
  for (const t of thisMonthTxs.value) {
    if (t.type !== 'out') continue
    map.set(t.name, (map.get(t.name) ?? 0) + t.amount)
  }
  return [...map.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)
})

// ── Recent transactions ───────────────────────────────────────
const recentTxs = computed(() =>
  txStore.transactions
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8)
)

function budgetBarColor(pct: number): string {
  if (pct >= 100) return '#dc2626'
  if (pct >= 80)  return '#d97706'
  return '#16a34a'
}

function getAccountName(id: string | null): string {
  if (!id) return '—'
  return accountStore.accounts.find(a => a.id === id)?.name ?? id
}

// ── Finance summary ───────────────────────────────────────────
const activeLoans = computed(() => loanStore.loans.filter(l => !l.archived))
const activeSavings = computed(() => loanStore.savings.filter(s => !s.archived))

const totalMonthlyPayments = computed(() =>
  Math.round(activeLoans.value.reduce((s, l) => s + loanStore.monthlyPayment(l), 0) * 100) / 100
)

const totalLoanRemaining = computed(() => {
  return Math.round(activeLoans.value.reduce((l, loan) => {
    const rows = loanStore.calcAmortization(loan)
    const nowYM = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}`
    const row = rows.find(r => r.date >= nowYM)
    return l + (row?.openingBalance ?? loan.principal)
  }, 0) * 100) / 100
})

const totalProjectedSavings = computed(() => {
  return Math.round(activeSavings.value.reduce((s, sav) => {
    if (sav.linkedAccountId) return s + loanStore.accountNetBalance(sav.linkedAccountId)
    const elapsedMonths = Math.max(0,
      (_now.getFullYear() - new Date(sav.startDate).getFullYear()) * 12 +
      _now.getMonth() - new Date(sav.startDate).getMonth()
    )
    const proj = loanStore.calcSavingsProjection(sav, elapsedMonths)
    return s + (proj[proj.length - 1]?.balance ?? sav.startBalance)
  }, 0) * 100) / 100
})

const finNetPosition = computed(() =>
  Math.round((totalProjectedSavings.value - totalLoanRemaining.value) * 100) / 100
)

interface LoanDashRow {
  id: number; name: string; color: string; apr: number
  principal: number; remaining: number; pctPaid: number
  monthlyPayment: number; payoffDate: string
}

const loanDashRows = computed((): LoanDashRow[] =>
  activeLoans.value.map(loan => {
    const rows = loanStore.calcAmortization(loan)
    const nowYM = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}`
    const row = rows.find(r => r.date >= nowYM)
    const remaining = row?.openingBalance ?? 0
    const pctPaid = loan.principal > 0
      ? Math.round(((loan.principal - remaining) / loan.principal) * 100)
      : 100
    const payoffRow = rows[rows.length - 1]
    const payoffDate = payoffRow
      ? new Date(payoffRow.date + '-01').toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
      : '—'
    return {
      id: loan.id, name: loan.name, color: loan.color, apr: loan.apr,
      principal: loan.principal, remaining, pctPaid,
      monthlyPayment: loanStore.monthlyPayment(loan), payoffDate,
    }
  })
)

interface SavDashRow {
  id: number; name: string; color: string; apr: number
  startBalance: number; projectedNow: number; interestEarned: number; compoundFreq: string
}

const savDashRows = computed((): SavDashRow[] =>
  activeSavings.value.map(sav => {
    const elapsedMonths = Math.max(0,
      (_now.getFullYear() - new Date(sav.startDate).getFullYear()) * 12 +
      _now.getMonth() - new Date(sav.startDate).getMonth()
    )
    const proj = loanStore.calcSavingsProjection(sav, elapsedMonths)
    const projectedNow = sav.linkedAccountId
      ? loanStore.accountNetBalance(sav.linkedAccountId)
      : (proj[proj.length - 1]?.balance ?? sav.startBalance)
    return {
      id: sav.id, name: sav.name, color: sav.color, apr: sav.apr,
      startBalance: sav.startBalance,
      projectedNow,
      interestEarned: Math.round((projectedNow - sav.startBalance) * 100) / 100,
      compoundFreq: sav.compoundFreq,
    }
  })
)

const hasFinance = computed(() => activeLoans.value.length > 0 || activeSavings.value.length > 0)

</script>

<template>
  <div class="dash">

    <!-- Header -->
    <div class="dash-header">
      <div>
        <h1 class="dash-title">Dashboard</h1>
        <p class="dash-subtitle">{{ _monthLabel }}</p>
      </div>
    </div>

    <!-- Month overview cards -->
    <section class="dash-section">
      <h2 class="dash-section-title">This Month</h2>
      <div class="dash-stat-grid">
        <button class="dash-stat-card" @click="emit('viewTransactions', _monthKey)">
          <span class="dash-stat-label">Money In</span>
          <span class="dash-stat-value money-positive">{{ formatMoney(monthIn) }}</span>
          <span class="dash-stat-sub">{{ thisMonthTxs.filter(t => t.type === 'in').length }} transactions</span>
        </button>
        <button class="dash-stat-card" @click="emit('viewTransactions', _monthKey)">
          <span class="dash-stat-label">Money Out</span>
          <span class="dash-stat-value money-negative">{{ formatMoney(monthOut) }}</span>
          <span class="dash-stat-sub">{{ thisMonthTxs.filter(t => t.type === 'out').length }} transactions</span>
        </button>
        <div class="dash-stat-card">
          <span class="dash-stat-label">Net</span>
          <span class="dash-stat-value" :class="monthNet >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(monthNet) }}</span>
          <span class="dash-stat-sub" :class="savingsRate >= 0 ? 'money-positive' : 'money-negative'">{{ savingsRate >= 0 ? savingsRate + '% saved' : Math.abs(savingsRate) + '% overspent' }}</span>
        </div>
        <div class="dash-stat-card">
          <span class="dash-stat-label">Total Funds</span>
          <span class="dash-stat-value" :class="totalBalance >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(totalBalance) }}</span>
          <span class="dash-stat-sub">across {{ accountBalances.length }} account{{ accountBalances.length !== 1 ? 's' : '' }}</span>
        </div>
      </div>
    </section>

    <div class="dash-two-col">

      <!-- Left: Top spending + recent transactions -->
      <div class="dash-col">

        <!-- Top spending this month -->
        <section class="dash-section">
          <h2 class="dash-section-title">Top Spending — {{ _monthLabel }}</h2>
          <div v-if="topSpending.length === 0" class="dash-empty">No outgoing transactions this month.</div>
          <div v-else class="dash-top-list">
            <div v-for="(row, i) in topSpending" :key="row.name" class="dash-top-row">
              <span class="dash-top-rank">{{ i + 1 }}</span>
              <button class="dash-top-name" @click="emit('viewSearchFor', row.name)">{{ row.name }}</button>
              <span class="dash-top-bar-wrap">
                <span class="dash-top-bar" :style="{ width: (row.total / topSpending[0].total * 100) + '%' }" />
              </span>
              <span class="dash-top-amount money-negative">{{ formatMoney(row.total) }}</span>
            </div>
          </div>
        </section>

        <!-- Recent transactions -->
        <section class="dash-section">
          <div class="dash-section-header">
            <h2 class="dash-section-title">Recent Transactions</h2>
            <button class="dash-link" @click="emit('navigate', 'transactions')">View all</button>
          </div>
          <div v-if="recentTxs.length === 0" class="dash-empty">No transactions yet.</div>
          <div v-else class="dash-recent-list">
            <div v-for="tx in recentTxs" :key="tx.id" class="dash-recent-row">
              <span class="dash-recent-icon" :class="tx.type === 'in' ? 'dash-recent-icon--in' : 'dash-recent-icon--out'">
                <i :class="tx.type === 'in' ? 'pi pi-arrow-down' : 'pi pi-arrow-up'" />
              </span>
              <div class="dash-recent-info">
                <span class="dash-recent-name">{{ tx.name }}</span>
                <span class="dash-recent-meta">{{ tx.date }} · {{ getAccountName(tx.accountId) }}</span>
              </div>
              <span class="dash-recent-amount" :class="tx.type === 'in' ? 'money-positive' : 'money-negative'">
                {{ tx.type === 'in' ? '+' : '-' }}{{ formatMoney(tx.amount) }}
              </span>
            </div>
          </div>
        </section>

      </div>

      <!-- Right: Accounts + Budget status -->
      <div class="dash-col">

        <!-- Account balances -->
        <section class="dash-section">
          <div class="dash-section-header">
            <h2 class="dash-section-title">Accounts</h2>
            <button class="dash-link" @click="emit('navigate', 'accounts')">Manage</button>
          </div>
          <div v-if="accountBalances.length === 0" class="dash-empty">
            No accounts yet. <button class="dash-link" @click="emit('navigate', 'accounts')">Add one</button>
          </div>
          <div v-else class="dash-accounts-list">
            <div v-for="acc in accountBalances" :key="acc.id" class="dash-account-row">
              <span class="dash-account-name">{{ acc.name }}</span>
              <span class="dash-account-balance" :class="acc.balance >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(acc.balance) }}</span>
            </div>
            <div class="dash-account-row dash-account-total">
              <span class="dash-account-name">Total</span>
              <span class="dash-account-balance" :class="totalBalance >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(totalBalance) }}</span>
            </div>
          </div>
        </section>

        <!-- Budget status -->
        <section class="dash-section">
          <div class="dash-section-header">
            <h2 class="dash-section-title">Budget — {{ _monthLabel }}</h2>
            <button class="dash-link" @click="emit('navigate', 'budget')">Edit</button>
          </div>
          <div v-if="!budgetStatus" class="dash-empty">
            No budget items for this month. <button class="dash-link" @click="emit('navigate', 'budget')">Set up budget</button>
          </div>
          <template v-else>
            <!-- Overall usage bar -->
            <div class="dash-budget-overall">
              <div class="dash-budget-bar-row">
                <span class="dash-budget-bar-label">Overall usage</span>
                <span class="dash-budget-bar-pct" :style="{ color: budgetBarColor(budgetStatus.overallPct) }">{{ budgetStatus.overallPct }}%</span>
              </div>
              <div class="dash-budget-bar-track">
                <div class="dash-budget-bar-fill" :style="{ width: budgetStatus.overallPct + '%', background: budgetBarColor(budgetStatus.overallPct) }" />
              </div>
              <div class="dash-budget-meta">
                <span>{{ formatMoney(budgetStatus.totalActivity) }} spent</span>
                <span class="dash-muted">of {{ formatMoney(budgetStatus.totalAssigned) }} assigned</span>
              </div>
            </div>
            <div class="dash-budget-flags">
              <span v-if="budgetStatus.overCount > 0" class="dash-flag dash-flag--danger">
                <i class="pi pi-exclamation-circle" />
                {{ budgetStatus.overCount }} overspent
              </span>
              <span v-else class="dash-flag dash-flag--ok">
                <i class="pi pi-check-circle" />
                All items on track
              </span>
            </div>
            <!-- Top items by usage -->
            <div class="dash-budget-items">
              <div v-for="row in budgetStatus.topRows" :key="row.id" class="dash-budget-item-row">
                <span class="dash-budget-item-name">{{ row.name }}</span>
                <div class="dash-budget-mini-bar">
                  <div class="dash-budget-mini-fill" :style="{ width: Math.min(100, row.pct) + '%', background: budgetBarColor(row.pct) }" />
                </div>
                <span class="dash-budget-item-pct" :style="{ color: budgetBarColor(row.pct) }">{{ row.pct }}%</span>
              </div>
            </div>
          </template>
        </section>

      </div>

    </div>

    <!-- Finance at a Glance -->
    <section v-if="hasFinance" class="dash-section">
      <div class="dash-section-header">
        <h2 class="dash-section-title">Finance</h2>
        <button class="dash-link" @click="emit('navigate', 'finance')">View Finance</button>
      </div>

      <!-- Top stat row -->
      <div class="dash-stat-grid">
        <div v-if="activeLoans.length > 0" class="dash-stat-card">
          <span class="dash-stat-label">Monthly Loan Payments</span>
          <span class="dash-stat-value money-negative">{{ formatMoney(totalMonthlyPayments) }}</span>
          <span class="dash-stat-sub">{{ activeLoans.length }} active loan{{ activeLoans.length !== 1 ? 's' : '' }}</span>
        </div>
        <div v-if="activeLoans.length > 0" class="dash-stat-card">
          <span class="dash-stat-label">Loan Debt Remaining</span>
          <span class="dash-stat-value money-negative">{{ formatMoney(totalLoanRemaining) }}</span>
          <span class="dash-stat-sub">outstanding balance</span>
        </div>
        <div v-if="activeSavings.length > 0" class="dash-stat-card">
          <span class="dash-stat-label">Savings Balance</span>
          <span class="dash-stat-value money-positive">{{ formatMoney(totalProjectedSavings) }}</span>
          <span class="dash-stat-sub">{{ activeSavings.length }} savings account{{ activeSavings.length !== 1 ? 's' : '' }}</span>
        </div>
        <div v-if="hasFinance" class="dash-stat-card">
          <span class="dash-stat-label">Net Finance Position</span>
          <span class="dash-stat-value" :class="finNetPosition >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(finNetPosition) }}</span>
          <span class="dash-stat-sub">savings minus debt</span>
        </div>
      </div>

      <div class="dash-two-col" style="gap:1rem">

        <!-- Loans -->
        <div v-if="loanDashRows.length > 0" class="dash-col" style="gap:0.5rem">
          <span class="dash-section-title">Loans</span>
          <div v-for="row in loanDashRows" :key="row.id" class="dash-fin-card">
            <div class="dash-fin-card-top">
              <span class="dash-fin-dot" :style="{ background: row.color }" />
              <span class="dash-fin-name">{{ row.name }}</span>
              <span class="dash-fin-badge dash-fin-badge--red">{{ row.apr }}% APR</span>
            </div>
            <div class="dash-fin-bar-track">
              <div
                class="dash-fin-bar-fill"
                :style="{ width: Math.max(2, row.pctPaid) + '%', background: row.color }"
              />
            </div>
            <div class="dash-fin-stats">
              <span class="dash-fin-stat">
                <span class="dash-fin-stat-label">Remaining</span>
                <span class="dash-fin-stat-val money-negative">{{ formatMoney(row.remaining) }}</span>
              </span>
              <span class="dash-fin-stat">
                <span class="dash-fin-stat-label">Monthly</span>
                <span class="dash-fin-stat-val money-negative">{{ formatMoney(row.monthlyPayment) }}</span>
              </span>
              <span class="dash-fin-stat">
                <span class="dash-fin-stat-label">Paid off</span>
                <span class="dash-fin-stat-val">{{ row.pctPaid }}%</span>
              </span>
              <span class="dash-fin-stat">
                <span class="dash-fin-stat-label">Payoff</span>
                <span class="dash-fin-stat-val">{{ row.payoffDate }}</span>
              </span>
            </div>
          </div>
        </div>

        <!-- Savings accounts -->
        <div v-if="savDashRows.length > 0" class="dash-col" style="gap:0.5rem">
          <span class="dash-section-title">Savings Accounts</span>
          <div v-for="row in savDashRows" :key="row.id" class="dash-fin-card dash-fin-card--sav">
            <div class="dash-fin-card-top">
              <span class="dash-fin-dot" :style="{ background: row.color }" />
              <span class="dash-fin-name">{{ row.name }}</span>
              <span class="dash-fin-badge dash-fin-badge--green">{{ row.apr }}% APR</span>
              <span class="dash-fin-badge">{{ row.compoundFreq }}</span>
            </div>
            <div class="dash-fin-stats">
              <span class="dash-fin-stat">
                <span class="dash-fin-stat-label">Opening</span>
                <span class="dash-fin-stat-val">{{ formatMoney(row.startBalance) }}</span>
              </span>
              <span class="dash-fin-stat">
                <span class="dash-fin-stat-label">Now</span>
                <span class="dash-fin-stat-val money-positive">{{ formatMoney(row.projectedNow) }}</span>
              </span>
              <span class="dash-fin-stat">
                <span class="dash-fin-stat-label">Earned</span>
                <span class="dash-fin-stat-val money-positive">+{{ formatMoney(row.interestEarned) }}</span>
              </span>
            </div>
          </div>
        </div>

      </div>
    </section>

  </div>
</template>
