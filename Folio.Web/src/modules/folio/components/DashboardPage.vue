<script setup lang="ts">
import { computed } from 'vue'
import { useAccountStore }             from '../stores/accountStore'
import { useSettingsStore }            from '../stores/settingsStore'
import { useSavingsGoalStore }         from '../stores/savingsGoalStore'
import { useUpcomingTransactionStore } from '../stores/upcomingTransactionStore'
import { useHealthScore }              from '../composables/useHealthScore'
import { useDashboard }                from '../composables/useDashboard'
import { useFinance }                  from '../composables/useFinance'
import { yearMonthKey } from '../utils/date'

const accountStore   = useAccountStore()
const settings       = useSettingsStore()
const goalStore      = useSavingsGoalStore()
const upStore        = useUpcomingTransactionStore()

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
const _monthKey  = yearMonthKey(_thisYear, _thisMonth)
const _monthLabel = _now.toLocaleDateString(settings.locale, { month: 'long', year: 'numeric' })


// ── The numbers, from the API ─────────────────────────────────
// The totals, the balances, the spending lines and the budget's progress are one answer
// from one request, so the cards cannot disagree with each other.
const { totals, accounts: accountBalances, totalFunds: totalBalance, topSpending, budget: budgetStatus, recent: recentTxs } =
  useDashboard(() => _monthKey)

const monthIn     = computed(() => totals.value.income)
const monthOut    = computed(() => totals.value.expenses)
const monthNet    = computed(() => totals.value.net)
const savingsRate = computed(() => totals.value.savingsRate)

function budgetBarColor(pct: number): string {
  if (pct >= 100) return '#dc2626'
  if (pct >= 80)  return '#d97706'
  return '#16a34a'
}

function getAccountName(id: string | null): string {
  if (!id) return '—'
  return accountStore.accounts.find(a => a.id === id)?.name ?? id
}

// ── Finance summary, from the API ─────────────────────────────
// What a loan still owes, what it costs a month and when it ends are one calculation, so
// they arrive together rather than each card working them out from a schedule.
const {
  loans: loanDashRows,
  savings: savDashRows,
  totals: financeTotals,
  hasFinance,
  payoffLabel,
} = useFinance()

const totalMonthlyPayments  = computed(() => financeTotals.value.monthlyPayments)
const totalLoanRemaining    = computed(() => financeTotals.value.loanRemaining)
const totalProjectedSavings = computed(() => financeTotals.value.projectedSavings)
const finNetPosition        = computed(() => financeTotals.value.netPosition)
// ── Performance snapshot ──────────────────────────────────────
const { score: perfHealthScore, grade: perfHealthGrade } = useHealthScore()

// ── Upcoming transactions ─────────────────────────────────────
const upcomingPending = computed(() => upStore.pending.slice(0, 7))

// ── Savings goals summary ────────────────────────────────────────
const activeGoals = computed(() => goalStore.goals.filter(g => !g.archived))
const hasGoals    = computed(() => activeGoals.value.length > 0)

interface GoalDashRow {
  id: number; name: string; color: string
  saved: number; target: number; pct: number; complete: boolean
  linkedAccountName?: string; deadline?: string
}

const goalDashRows = computed((): GoalDashRow[] =>
  activeGoals.value.map(g => ({
    id: g.id, name: g.name, color: g.color,
    saved:    goalStore.totalSaved(g),
    target:   g.targetAmount,
    pct:      goalStore.progressPct(g),
    complete: goalStore.progressPct(g) >= 100,
    linkedAccountName: g.linkedAccountId ? accountStore.accounts.find(a => a.id === g.linkedAccountId)?.name : undefined,
    deadline: g.deadline,
  }))
)

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
          <span class="dash-stat-sub">{{ totals.incomeCount }} transactions</span>
        </button>
        <button class="dash-stat-card" @click="emit('viewTransactions', _monthKey)">
          <span class="dash-stat-label">Money Out</span>
          <span class="dash-stat-value money-negative">{{ formatMoney(monthOut) }}</span>
          <span class="dash-stat-sub">{{ totals.expenseCount }} transactions</span>
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

    <!-- Performance snapshot -->
    <section class="dash-section dash-perf-snap">
      <div class="dash-perf-snap-header">
        <div class="dash-perf-snap-score" :style="{ borderColor: perfHealthGrade.color }">
          <span class="dash-perf-snap-letter" :style="{ color: perfHealthGrade.color }">{{ perfHealthGrade.letter }}</span>
        </div>
        <div class="dash-perf-snap-text">
          <p class="dash-perf-snap-label">Financial Health — <strong :style="{ color: perfHealthGrade.color }">{{ perfHealthGrade.label }}</strong></p>
          <p class="dash-perf-snap-sub">Score {{ perfHealthScore }}/100 &nbsp;·&nbsp; Savings rate {{ savingsRate >= 0 ? savingsRate + '%' : '0%' }} this month</p>
        </div>
        <button class="dash-link dash-perf-snap-link" @click="emit('navigate', 'performance')">Full report →</button>
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

    <!-- Savings Goals -->
    <section v-if="hasGoals" class="dash-section">
      <div class="dash-section-header">
        <h2 class="dash-section-title">Savings Goals</h2>
        <button class="dash-link" @click="emit('navigate', 'savings')">View All</button>
      </div>
      <div class="dash-goals-grid">
        <div v-for="row in goalDashRows" :key="row.id" class="dash-goal-card" :class="{ 'dash-goal-card--complete': row.complete }">
          <div class="dash-goal-top">
            <span class="dash-fin-dot" :style="{ background: row.color }" />
            <span class="dash-goal-name">{{ row.name }}</span>
            <span v-if="row.complete" class="dash-goal-badge dash-goal-badge--done">
              <i class="pi pi-check" /> Done
            </span>
            <span v-else-if="row.deadline" class="dash-goal-badge">
              {{ (() => { const d = Math.ceil((new Date(row.deadline + 'T00:00:00').getTime() - Date.now()) / 86400000); return d < 0 ? `${Math.abs(d)}d overdue` : d < 30 ? `${d}d left` : `${Math.round(d/30.4)}mo left` })() }}
            </span>
          </div>
          <div class="dash-goal-amounts">
            <span class="dash-goal-saved" :style="{ color: row.color }">{{ formatMoney(row.saved) }}</span>
            <span class="dash-goal-sep">/</span>
            <span class="dash-goal-target">{{ formatMoney(row.target) }}</span>
            <span class="dash-goal-pct" :style="{ color: row.color }">{{ row.pct }}%</span>
          </div>
          <div class="dash-goal-track">
            <div class="dash-goal-fill" :style="{ width: Math.max(2, row.pct) + '%', background: row.color }" />
          </div>
          <div v-if="row.linkedAccountName" class="dash-goal-linked">
            <i class="pi pi-link" style="font-size:0.6rem" /> {{ row.linkedAccountName }}
          </div>
        </div>
      </div>
    </section>

    <!-- Upcoming Transactions -->
    <section v-if="upcomingPending.length > 0" class="dash-section">
      <div class="dash-section-header">
        <h2 class="dash-section-title">Upcoming Transactions</h2>
        <button class="dash-link" @click="emit('navigate', 'calendar')">View Calendar</button>
      </div>
      <div class="dash-upcoming-list">
        <div v-for="u in upcomingPending" :key="u.id" class="dash-upcoming-row">
          <span class="dash-upcoming-icon" :class="u.type === 'in' ? 'dash-upcoming-icon--in' : 'dash-upcoming-icon--out'">
            <i :class="u.type === 'in' ? 'pi pi-arrow-down' : 'pi pi-arrow-up'" />
          </span>
          <div class="dash-upcoming-info">
            <span class="dash-upcoming-name">{{ u.title }}</span>
            <span class="dash-upcoming-date">{{ u.date }}</span>
          </div>
          <span class="dash-upcoming-amount" :class="u.type === 'in' ? 'money-positive' : 'money-negative'">
            {{ u.type === 'in' ? '+' : '-' }}{{ formatMoney(u.amount) }}
          </span>
        </div>
        <div v-if="upStore.pending.length > 7" class="dash-upcoming-more">
          <button class="dash-link" @click="emit('navigate', 'calendar')">+ {{ upStore.pending.length - 7 }} more — view calendar</button>
        </div>
      </div>
    </section>

    <!-- Finance at a Glance -->
    <section v-if="hasFinance" class="dash-section">
      <div class="dash-section-header">
        <h2 class="dash-section-title">Finance</h2>
        <button class="dash-link" @click="emit('navigate', 'finance')">View Finance</button>
      </div>

      <!-- Top stat row -->
      <div class="dash-stat-grid">
        <div v-if="loanDashRows.length > 0" class="dash-stat-card">
          <span class="dash-stat-label">Monthly Loan Payments</span>
          <span class="dash-stat-value money-negative">{{ formatMoney(totalMonthlyPayments) }}</span>
          <span class="dash-stat-sub">{{ loanDashRows.length }} active loan{{ loanDashRows.length !== 1 ? 's' : '' }}</span>
        </div>
        <div v-if="loanDashRows.length > 0" class="dash-stat-card">
          <span class="dash-stat-label">Loan Debt Remaining</span>
          <span class="dash-stat-value money-negative">{{ formatMoney(totalLoanRemaining) }}</span>
          <span class="dash-stat-sub">outstanding balance</span>
        </div>
        <div v-if="savDashRows.length > 0" class="dash-stat-card">
          <span class="dash-stat-label">Savings Balance</span>
          <span class="dash-stat-value money-positive">{{ formatMoney(totalProjectedSavings) }}</span>
          <span class="dash-stat-sub">{{ savDashRows.length }} savings account{{ savDashRows.length !== 1 ? 's' : '' }}</span>
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
                <span class="dash-fin-stat-val">{{ payoffLabel(row.payoffMonth) }}</span>
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
