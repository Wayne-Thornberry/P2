<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAccountStore } from '../stores/accountStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTransactionStore } from '../stores/transactionStore'
import { useSavingsGoalStore } from '../stores/savingsGoalStore'
import { useLoanStore } from '../stores/loanStore'
import { useMoneyInput } from '../composables/useMoneyInput'
import { getTodayStr } from '../utils/date'
import { SUPPORTED_COUNTRIES, getCountryById } from '../data/countries'

const accountStore  = useAccountStore()
const settings      = useSettingsStore()
const txStore       = useTransactionStore()
const goalStore     = useSavingsGoalStore()
const loanStore     = useLoanStore()

const { moneyFocus, moneyBlur } = useMoneyInput()

const emit = defineEmits<{ viewTransactions: [accountId: string] }>()

function formatMoney(v: number): string { return settings.formatMoney(v) }

// â”€â”€ Add account â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const newName     = ref('')
const addInputRef = ref<HTMLInputElement | null>(null)

const openingBalanceAccountId = ref<string | null>(null)
const openingBalanceStr       = ref('')
const openingBalanceDate      = ref(getTodayStr())

function commitAdd(): void {
  const name = newName.value.trim()
  if (!name) return
  // If a previous account's OB prompt is still pending, skip it cleanly first
  if (openingBalanceAccountId.value !== null) {
    openingBalanceAccountId.value = null
  }
  const id = accountStore.addAccount(name)
  newName.value = ''
  openingBalanceAccountId.value = id
  openingBalanceStr.value       = '0'
  openingBalanceDate.value      = getTodayStr()
}

function commitOpeningBalance(): void {
  const id = openingBalanceAccountId.value
  if (id) {
    const raw = openingBalanceStr.value.trim()
    const amount = raw === '' ? 0 : parseFloat(raw)
    if (!isNaN(amount)) {
      txStore.addOpeningBalance(id, amount, openingBalanceDate.value)
    }
  }
  openingBalanceAccountId.value = null
  addInputRef.value?.focus()
}

function skipOpeningBalance(): void {
  openingBalanceAccountId.value = null
  addInputRef.value?.focus()
}

function onAddKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') commitAdd()
}

// â”€â”€ Rename account â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const editingId = ref<string | null>(null)
const editName  = ref('')

function startRename(id: string, name: string): void {
  editingId.value = id
  editName.value  = name
}

function commitRename(): void {
  if (editingId.value) accountStore.renameAccount(editingId.value, editName.value)
  editingId.value = null
  editName.value  = ''
}

function cancelRename(): void {
  editingId.value = null
  editName.value  = ''
}

// â”€â”€ Remove account â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const confirmRemoveId = ref<string | null>(null)

function requestRemove(id: string): void { confirmRemoveId.value = id }
function confirmRemove(): void {
  if (confirmRemoveId.value) accountStore.removeAccount(confirmRemoveId.value)
  confirmRemoveId.value = null
}
function cancelRemove(): void { confirmRemoveId.value = null }

// â”€â”€ Reconcile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const reconcilingId      = ref<string | null>(null)
const reconcileTargetStr = ref('')

function accountBalance(id: string): number {
  return txStore.transactions
    .filter(t => t.accountId === id)
    .reduce((s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0)
}

function startReconcile(id: string): void {
  editingId.value          = null
  reconcilingId.value      = id
  reconcileTargetStr.value = accountBalance(id).toFixed(2)
}
function cancelReconcile(): void { reconcilingId.value = null; reconcileTargetStr.value = '' }
function commitReconcile(id: string): void {
  const target = parseFloat(reconcileTargetStr.value)
  if (isNaN(target)) { cancelReconcile(); return }
  const diff = Math.round((target - accountBalance(id)) * 100) / 100
  if (diff === 0) { cancelReconcile(); return }
  txStore.addTransaction({ name: 'Reconciliation adjustment', date: getTodayStr(), type: diff > 0 ? 'in' : 'out', amount: Math.abs(diff), itemId: null, accountId: id })
  cancelReconcile()
}

// â”€â”€ Per-account detail stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const _now = new Date()
const _nowKey  = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}`
const _lastKey = (() => {
  const d = new Date(_now.getFullYear(), _now.getMonth() - 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
})()

const sixMonthKeys = (() => {
  const keys: string[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(_now.getFullYear(), _now.getMonth() - i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return keys
})()

function shortMonth(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(settings.locale, { month: 'short' })
}

const accountDetails = computed(() =>
  accountStore.accounts.map(acc => {
    const txs      = txStore.transactions.filter(t => t.accountId === acc.id)
    const balance  = txs.reduce((s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0)
    const txCount  = txs.length
    const recent   = txs.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 4)

    const nowTxs      = txs.filter(t => t.date.startsWith(_nowKey))
    const lastTxs     = txs.filter(t => t.date.startsWith(_lastKey))
    const thisMonthIn  = nowTxs.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0)
    const thisMonthOut = nowTxs.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0)
    const lastMonthOut = lastTxs.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0)

    const spendTrend = sixMonthKeys.map(key => ({
      key,
      label: shortMonth(key),
      out: txs.filter(t => t.date.startsWith(key) && t.type === 'out').reduce((s, t) => s + t.amount, 0),
    }))
    const maxOut = Math.max(1, ...spendTrend.map(m => m.out))

    const vsLastMonth = lastMonthOut > 0
      ? Math.round(((thisMonthOut - lastMonthOut) / lastMonthOut) * 100)
      : null

    const linkedGoals = goalStore.goals
      .filter(g => !g.archived && g.linkedAccountId === acc.id)
      .map(g => ({ id: g.id, name: g.name, color: g.color }))

    const linkedFinance = [
      ...loanStore.loans
        .filter(l => !l.archived && l.linkedAccountId === acc.id)
        .map(l => ({ id: `loan-${l.id}`, name: l.name, color: l.color, kind: 'loan' as const })),
      ...loanStore.savings
        .filter(s => !s.archived && s.linkedAccountId === acc.id)
        .map(s => ({ id: `sav-${s.id}`, name: s.name, color: s.color, kind: 'savings' as const })),
    ]

    return { id: acc.id, name: acc.name, balance, txCount, recent, thisMonthIn, thisMonthOut, lastMonthOut, spendTrend, maxOut, vsLastMonth, linkedGoals, linkedFinance }
  })
)

// â”€â”€ Quick Add â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ACCOUNT_TYPES = ['Current Account', 'Savings Account', 'Joint Account', 'Credit Card', 'Mortgage', 'Loan Account']
const userCountry   = computed(() => getCountryById(settings.country) ?? null)
const selectedBank  = ref<(typeof SUPPORTED_COUNTRIES[0]['banks'][0]) | null>(null)

function selectBank(bank: typeof SUPPORTED_COUNTRIES[0]['banks'][0]): void {
  selectedBank.value = selectedBank.value?.id === bank.id ? null : bank
}

function getNextAccountName(baseName: string): string {
  const names = new Set(accountStore.accounts.map(a => a.name))
  if (!names.has(baseName)) return baseName
  let n = 2
  while (names.has(`${baseName} (${n})`)) n++
  return `${baseName} (${n})`
}

function quickAddAccount(bank: typeof SUPPORTED_COUNTRIES[0]['banks'][0], type: string): void {
  // If a previous account's OB prompt is still pending, skip it cleanly first
  if (openingBalanceAccountId.value !== null) {
    openingBalanceAccountId.value = null
  }
  const id = accountStore.addAccount(getNextAccountName(`${bank.prefix} ${type}`))
  openingBalanceAccountId.value = id
  openingBalanceStr.value       = '0'
  openingBalanceDate.value      = getTodayStr()
}
</script>

<template>
  <div class="accounts-page">

    <!-- Confirm delete dialog -->
    <div v-if="confirmRemoveId !== null" class="accounts-overlay">
      <div class="accounts-dialog">
        <p class="accounts-dialog-title">Remove account?</p>
        <p class="accounts-dialog-body">
          Any transactions linked to this account will be set to <strong>unassigned</strong>. This cannot be undone.
        </p>
        <div class="accounts-dialog-actions">
          <button class="acct-btn acct-btn-ghost" @click="cancelRemove">Cancel</button>
          <button class="acct-btn acct-btn-danger" @click="confirmRemove">Remove</button>
        </div>
      </div>
    </div>

    <div class="acct-layout">

      <!-- â”€â”€ Left: account cards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ -->
      <div class="acct-cards-area">

        <div v-if="accountDetails.length === 0" class="acct-empty-state">
          <i class="pi pi-wallet" style="font-size:2rem;opacity:0.3" />
          <p>No accounts yet.</p>
          <p class="acct-empty-hint">Use the panel on the right to add your first account.</p>
        </div>

        <div
          v-for="acc in accountDetails"
          :key="acc.id"
          class="acct-card"
          :class="{ 'acct-card--reconciling': reconcilingId === acc.id }"
        >
          <!-- Card header -->
          <div class="acct-card-header">
            <div class="acct-card-name-wrap">
              <template v-if="editingId === acc.id">
                <input
                  class="acct-name-input acct-card-name-input"
                  v-model="editName"
                  :ref="(el) => { if (el) (el as HTMLInputElement).focus() }"
                  @keydown.enter.prevent="commitRename"
                  @keydown.escape="cancelRename"
                  @blur="commitRename"
                />
              </template>
              <template v-else>
                <span class="acct-card-name">{{ acc.name }}</span>
              </template>
            </div>
            <div class="acct-card-actions">
              <button class="acct-icon-btn" title="Transactions" @click="emit('viewTransactions', acc.id)">
                <i class="pi pi-list" />
              </button>
              <button class="acct-icon-btn" title="Reconcile" @click="startReconcile(acc.id)">
                <i class="pi pi-sliders-h" />
              </button>
              <button class="acct-icon-btn" title="Rename" @click="startRename(acc.id, acc.name)">
                <i class="pi pi-pencil" />
              </button>
              <button class="acct-icon-btn acct-icon-btn--danger" title="Remove" @click="requestRemove(acc.id)">
                <i class="pi pi-trash" />
              </button>
            </div>
          </div>

          <!-- Balance hero -->
          <div class="acct-card-balance" :class="acc.balance >= 0 ? 'money-positive' : 'money-negative'">
            {{ formatMoney(acc.balance) }}
          </div>
          <div class="acct-card-balance-label">All-time balance &middot; {{ acc.txCount }} transaction{{ acc.txCount !== 1 ? 's' : '' }}</div>

          <!-- This month stats -->
          <div class="acct-month-stats">
            <div class="acct-month-stat">
              <span class="acct-month-label">This Month In</span>
              <span class="acct-month-value money-positive">{{ formatMoney(acc.thisMonthIn) }}</span>
            </div>
            <div class="acct-month-stat">
              <span class="acct-month-label">This Month Out</span>
              <span class="acct-month-value money-negative">{{ formatMoney(acc.thisMonthOut) }}</span>
            </div>
            <div class="acct-month-stat">
              <span class="acct-month-label">vs Last Month</span>
              <span
                v-if="acc.vsLastMonth !== null"
                class="acct-month-value"
                :class="acc.vsLastMonth <= 0 ? 'money-positive' : 'money-negative'"
              >
                {{ acc.vsLastMonth > 0 ? '+' : '' }}{{ acc.vsLastMonth }}%
              </span>
              <span v-else class="acct-month-value acct-muted">&mdash;</span>
            </div>
          </div>

          <!-- 6-month spend sparkbar -->
          <div class="acct-spark">
            <div
              v-for="bar in acc.spendTrend"
              :key="bar.key"
              class="acct-spark-col"
              :title="bar.label + ': ' + formatMoney(bar.out)"
            >
              <div class="acct-spark-bar-wrap">
                <div
                  class="acct-spark-bar"
                  :class="{ 'acct-spark-bar--current': bar.key === _nowKey }"
                  :style="{ height: acc.maxOut > 0 ? Math.max(4, Math.round((bar.out / acc.maxOut) * 100)) + '%' : '4%' }"
                />
              </div>
              <span class="acct-spark-label">{{ bar.label }}</span>
            </div>
          </div>

          <!-- Recent transactions -->
          <div v-if="acc.recent.length > 0" class="acct-recent">
            <div class="acct-recent-title">Recent</div>
            <div v-for="tx in acc.recent" :key="tx.id" class="acct-recent-row">
              <span class="acct-recent-date">{{ tx.date.slice(5).replace('-', '/') }}</span>
              <span class="acct-recent-name">{{ tx.name }}</span>
              <span class="acct-recent-amount" :class="tx.type === 'in' ? 'money-positive' : 'money-negative'">
                {{ tx.type === 'in' ? '+' : '-' }}{{ formatMoney(tx.amount) }}
              </span>
            </div>
          </div>

          <!-- Linked savings goals & finance -->
          <div v-if="acc.linkedGoals.length > 0 || acc.linkedFinance.length > 0" class="acct-links">
            <span class="acct-links-label">Linked</span>
            <div class="acct-links-chips">
              <span
                v-for="g in acc.linkedGoals"
                :key="g.id"
                class="acct-link-chip acct-link-chip--goal"
                :style="{ '--chip-color': g.color }"
                :title="'Savings Goal: ' + g.name"
              >
                <i class="pi pi-flag" />{{ g.name }}
              </span>
              <span
                v-for="f in acc.linkedFinance"
                :key="f.id"
                class="acct-link-chip"
                :class="f.kind === 'loan' ? 'acct-link-chip--loan' : 'acct-link-chip--savings'"
                :style="{ '--chip-color': f.color }"
                :title="(f.kind === 'loan' ? 'Loan: ' : 'Savings Account: ') + f.name"
              >
                <i :class="f.kind === 'loan' ? 'pi pi-credit-card' : 'pi pi-building-columns'" />{{ f.name }}
              </span>
            </div>
          </div>

          <!-- Reconcile panel -->
          <div v-if="reconcilingId === acc.id" class="acct-reconcile-panel">
            <div class="acct-reconcile-row">
              <div class="acct-reconcile-field">
                <span class="accounts-reconcile-label">Tracked balance</span>
                <span class="accounts-reconcile-current" :class="acc.balance >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(acc.balance) }}</span>
              </div>
              <i class="pi pi-arrow-right accounts-reconcile-arrow" />
              <div class="acct-reconcile-field">
                <span class="accounts-reconcile-label">Actual balance</span>
                <input
                  type="text"
                  inputmode="decimal"
                  class="acct-name-input accounts-reconcile-input"
                  v-model="reconcileTargetStr"
                  placeholder="0.00"
                  @focus="moneyFocus"
                  @blur="moneyBlur"
                  @keydown.enter.prevent="commitReconcile(acc.id)"
                  @keydown.escape="cancelReconcile"
                />
              </div>
              <div class="accounts-reconcile-actions">
                <button class="acct-btn acct-btn-ghost" @click="cancelReconcile">Cancel</button>
                <button class="acct-btn acct-btn-primary" @click="commitReconcile(acc.id)">Apply</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- â”€â”€ Right: management panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ -->
      <aside class="acct-sidebar">

        <!-- Add account -->
        <div class="settings-section">
          <p class="settings-section-title">Add Account</p>
          <div class="acct-add-form">
            <input
              ref="addInputRef"
              class="acct-name-input acct-name-input-add"
              v-model="newName"
              placeholder="Account name..."
              @keydown="onAddKeydown"
            />
            <button class="acct-btn acct-btn-primary acct-add-btn" @click="commitAdd">
              <i class="pi pi-plus" />
              Add
            </button>
          </div>

          <!-- Opening balance prompt -->
          <div v-if="openingBalanceAccountId !== null" class="accounts-ob-panel">
            <div class="accounts-ob-header">
              <i class="pi pi-flag" />
              <span>Opening balance for <strong>{{ accountStore.accounts.find(a => a.id === openingBalanceAccountId)?.name }}</strong></span>
            </div>
            <div class="accounts-ob-body">
              <div class="accounts-ob-field">
                <label class="accounts-ob-label">Amount</label>
                <input
                  type="text"
                  inputmode="decimal"
                  class="acct-name-input"
                  v-model="openingBalanceStr"
                  placeholder="0.00"
                  :ref="(el) => { if (el) { (el as HTMLInputElement).focus(); (el as HTMLInputElement).select() } }"
                  @focus="moneyFocus"
                  @blur="moneyBlur"
                  @keydown.enter.prevent="commitOpeningBalance"
                  @keydown.escape="skipOpeningBalance"
                />
              </div>
              <div class="accounts-ob-field">
                <label class="accounts-ob-label">Date</label>
                <input type="date" class="acct-name-input" v-model="openingBalanceDate" @keydown.enter.prevent="commitOpeningBalance" />
              </div>
              <div class="accounts-ob-actions">
                <button class="acct-btn acct-btn-ghost" @click="skipOpeningBalance">Skip</button>
                <button class="acct-btn acct-btn-primary" @click="commitOpeningBalance">Set Balance</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Quick Add -->
        <div class="settings-section">
          <p class="settings-section-title">Quick Add</p>
          <div v-if="!userCountry" class="accounts-empty">No country configured. Check Settings.</div>
          <template v-else>
            <div class="bank-picker-grid">
              <button
                v-for="bank in userCountry.banks"
                :key="bank.id"
                class="bank-tile"
                :class="{ 'bank-tile--active': selectedBank?.id === bank.id }"
                :style="{ '--bank-color': bank.color }"
                :title="bank.name"
                @click="selectBank(bank)"
              >
                <span class="bank-tile-badge">{{ bank.abbr }}</span>
                <span class="bank-tile-name">{{ bank.name }}</span>
              </button>
            </div>
            <Transition name="slide-down">
              <div v-if="selectedBank" class="bank-type-picker">
                <span class="bank-type-label">Add {{ selectedBank.name }} account</span>
                <div class="bank-type-btns">
                  <button
                    v-for="type in ACCOUNT_TYPES"
                    :key="type"
                    class="acct-btn bank-type-btn"
                    @click="quickAddAccount(selectedBank, type)"
                  >{{ type }}</button>
                </div>
              </div>
            </Transition>
          </template>
        </div>

      </aside>
    </div>

  </div>
</template>
