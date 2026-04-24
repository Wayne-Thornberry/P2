<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePlannerStore } from '../stores/plannerStore'
import { useTransactionStore } from '../stores/transactionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useAccountStore } from '../stores/accountStore'
import { cleanTxName } from '../utils/txNameCleaner'

const emit = defineEmits<{ (e: 'navigate', page: string): void }>()

const plannerStore = usePlannerStore()
const txStore      = useTransactionStore()
const settings     = useSettingsStore()
const accountStore = useAccountStore()

const accountBankIdMap = computed(() =>
  new Map(accountStore.accounts.map(a => [a.id, a.bankId ?? null]))
)

function txClean(tx: { name: string; accountId?: string | null }): string {
  const bankId = tx.accountId ? (accountBankIdMap.value.get(tx.accountId) ?? null) : null
  return cleanTxName(tx.name, bankId)
}

function fmt(v: number): string { return settings.formatMoney(v) }

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const selectedMonth = ref(currentMonth())

const ideal = computed(() => plannerStore.idealSimulation)

const idealExpenses = computed(() => ideal.value?.items.filter(i => i.kind === 'expense') ?? [])
const idealIncome   = computed(() => ideal.value?.items.filter(i => i.kind === 'income')  ?? [])

// ── Transactions for selected month ───────────────────────────
const monthTxs = computed(() =>
  txStore.transactions.filter(t => t.date.startsWith(selectedMonth.value))
)

const outTxs = computed(() => monthTxs.value.filter(t => t.type === 'out'))
const inTxs  = computed(() => monthTxs.value.filter(t => t.type === 'in'))

// ── Expense comparison ─────────────────────────────────────────
interface ExpenseRow {
  name: string
  ideal: number
  actual: number
  variance: number
  status: 'ok' | 'over' | 'under'
}

const expenseRows = computed<ExpenseRow[]>(() => {
  return idealExpenses.value.map(item => {
    const norm = item.name.toLowerCase().trim()
    const actual = outTxs.value
      .filter(t => txClean(t).toLowerCase().trim() === norm)
      .reduce((s, t) => s + t.amount, 0)
    const variance = actual - item.amount
    return {
      name: item.name,
      ideal: item.amount,
      actual,
      variance,
      status: actual === 0 && item.amount > 0 ? 'under' : variance > 0 ? 'over' : 'ok',
    }
  })
})

// ── Unplanned transactions ─────────────────────────────────────
const idealExpenseNames = computed(() =>
  new Set(idealExpenses.value.map(i => i.name.toLowerCase().trim()))
)

const unplannedTxs = computed(() =>
  outTxs.value.filter(t => !idealExpenseNames.value.has(txClean(t).toLowerCase().trim()))
)

const unplannedTotal = computed(() => unplannedTxs.value.reduce((s, t) => s + t.amount, 0))

// ── Income comparison ──────────────────────────────────────────
interface IncomeRow {
  name: string
  ideal: number
  actual: number
  variance: number
}

const incomeRows = computed<IncomeRow[]>(() => {
  return idealIncome.value.map(item => {
    const norm = item.name.toLowerCase().trim()
    const actual = inTxs.value
      .filter(t => txClean(t).toLowerCase().trim() === norm)
      .reduce((s, t) => s + t.amount, 0)
    return {
      name: item.name,
      ideal: item.amount,
      actual,
      variance: actual - item.amount,
    }
  })
})

// ── Summary ────────────────────────────────────────────────────
const totalIdealExpenses  = computed(() => idealExpenses.value.reduce((s, i) => s + i.amount, 0))
const totalActualExpenses = computed(() => outTxs.value.reduce((s, t) => s + t.amount, 0))
const expenseVariance     = computed(() => totalActualExpenses.value - totalIdealExpenses.value)

const totalIdealIncome  = computed(() => idealIncome.value.reduce((s, i) => s + i.amount, 0))
const totalActualIncome = computed(() => inTxs.value.reduce((s, t) => s + t.amount, 0))
</script>

<template>
  <div class="perf-root">

    <div class="perf-header">
      <div>
        <h1 class="perf-title">Performance</h1>
        <p class="perf-subtitle">Compare actual spending vs your ideal month plan.</p>
      </div>
      <div class="perf-controls">
        <label class="perf-month-label" for="perf-month">Month</label>
        <input id="perf-month" v-model="selectedMonth" type="month" class="perf-month-input" />
      </div>
    </div>

    <!-- No ideal set -->
    <div v-if="!ideal" class="perf-no-ideal">
      <i class="pi pi-star perf-no-ideal-icon" />
      <p class="perf-no-ideal-msg">No ideal month has been set.</p>
      <p class="perf-no-ideal-hint">Go to the Planner, open a simulation, and mark it as <strong>Ideal</strong> to enable performance tracking.</p>
      <button class="perf-go-planner-btn" @click="emit('navigate', 'planner')">
        <i class="pi pi-calculator" /> Open Planner
      </button>
    </div>

    <template v-else>

      <!-- Summary bar -->
      <div class="perf-summary">
        <div class="perf-summary-item">
          <span class="perf-summary-label">Ideal expenses</span>
          <span class="perf-summary-value">{{ fmt(totalIdealExpenses) }}</span>
        </div>
        <div class="perf-summary-item">
          <span class="perf-summary-label">Actual expenses</span>
          <span class="perf-summary-value" :class="totalActualExpenses > totalIdealExpenses ? 'perf-value--over' : 'perf-value--ok'">{{ fmt(totalActualExpenses) }}</span>
        </div>
        <div class="perf-summary-item">
          <span class="perf-summary-label">Variance</span>
          <span class="perf-summary-value" :class="expenseVariance > 0 ? 'perf-value--over' : expenseVariance < 0 ? 'perf-value--under' : 'perf-value--ok'">
            {{ expenseVariance >= 0 ? '+' : '' }}{{ fmt(expenseVariance) }}
          </span>
        </div>
        <div class="perf-summary-item perf-summary-item--ideal">
          <span class="perf-summary-label">Ideal plan</span>
          <span class="perf-summary-ideal-name">{{ ideal.name }}</span>
        </div>
      </div>

      <!-- ── Expense comparison ───────────────────────────────── -->
      <div class="perf-section">
        <h2 class="perf-section-title"><i class="pi pi-minus-circle" /> Expense Comparison</h2>
        <div v-if="expenseRows.length === 0" class="perf-empty">No expense items in the ideal plan.</div>
        <table v-else class="perf-table">
          <thead>
            <tr>
              <th class="perf-th perf-th--name">Category</th>
              <th class="perf-th perf-th--num">Ideal</th>
              <th class="perf-th perf-th--num">Actual</th>
              <th class="perf-th perf-th--num">Variance</th>
              <th class="perf-th perf-th--status">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in expenseRows" :key="row.name" class="perf-tr">
              <td class="perf-td perf-td--name">{{ row.name }}</td>
              <td class="perf-td perf-td--num">{{ fmt(row.ideal) }}</td>
              <td class="perf-td perf-td--num" :class="row.actual > row.ideal ? 'perf-value--over' : ''">{{ fmt(row.actual) }}</td>
              <td class="perf-td perf-td--num" :class="row.variance > 0 ? 'perf-value--over' : row.variance < 0 ? 'perf-value--under' : ''">
                {{ row.variance > 0 ? '+' : '' }}{{ fmt(row.variance) }}
              </td>
              <td class="perf-td perf-td--status">
                <span class="perf-status-badge" :class="`perf-status-badge--${row.status}`">
                  <i :class="row.status === 'over' ? 'pi pi-arrow-up' : row.status === 'under' ? 'pi pi-question' : 'pi pi-check'" />
                  {{ row.status === 'over' ? 'Over' : row.status === 'under' ? 'No data' : 'OK' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ── Unplanned spending ───────────────────────────────── -->
      <div v-if="unplannedTxs.length > 0" class="perf-section">
        <h2 class="perf-section-title"><i class="pi pi-exclamation-triangle" /> Unplanned Spending <span class="perf-section-total perf-value--over">{{ fmt(unplannedTotal) }}</span></h2>
        <p class="perf-section-desc">Transactions not matched to any ideal expense item.</p>
        <table class="perf-table">
          <thead>
            <tr>
              <th class="perf-th perf-th--name">Transaction</th>
              <th class="perf-th perf-th--date">Date</th>
              <th class="perf-th perf-th--num">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tx in unplannedTxs" :key="tx.id" class="perf-tr">
              <td class="perf-td perf-td--name">{{ txClean(tx) }}</td>
              <td class="perf-td perf-td--date">{{ tx.date }}</td>
              <td class="perf-td perf-td--num perf-value--over">{{ fmt(tx.amount) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ── Income comparison ───────────────────────────────── -->
      <div class="perf-section">
        <h2 class="perf-section-title"><i class="pi pi-arrow-circle-down" /> Income Comparison</h2>
        <div class="perf-income-summary">
          <span class="perf-summary-label">Ideal</span>
          <span class="perf-summary-value">{{ fmt(totalIdealIncome) }}</span>
          <span class="perf-summary-label">Actual</span>
          <span class="perf-summary-value" :class="totalActualIncome >= totalIdealIncome ? 'perf-value--ok' : 'perf-value--over'">{{ fmt(totalActualIncome) }}</span>
        </div>
        <div v-if="incomeRows.length === 0" class="perf-empty">No income items in the ideal plan.</div>
        <table v-else class="perf-table">
          <thead>
            <tr>
              <th class="perf-th perf-th--name">Source</th>
              <th class="perf-th perf-th--num">Ideal</th>
              <th class="perf-th perf-th--num">Actual</th>
              <th class="perf-th perf-th--num">Variance</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in incomeRows" :key="row.name" class="perf-tr">
              <td class="perf-td perf-td--name">{{ row.name }}</td>
              <td class="perf-td perf-td--num">{{ fmt(row.ideal) }}</td>
              <td class="perf-td perf-td--num">{{ fmt(row.actual) }}</td>
              <td class="perf-td perf-td--num" :class="row.variance < 0 ? 'perf-value--over' : row.variance > 0 ? 'perf-value--under' : ''">
                {{ row.variance >= 0 ? '+' : '' }}{{ fmt(row.variance) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

    </template>

  </div>
</template>
