<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAccountStore } from '../stores/accountStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTransactionStore } from '../stores/transactionStore'
import { useSavingsGoalStore } from '../stores/savingsGoalStore'
import { useLoanStore } from '../stores/loanStore'
import { useMoneyInput } from '../composables/useMoneyInput'
import { useConfirm } from '../composables/useConfirm'
import { getTodayStr } from '../utils/date'
import { roundCents, txNet } from '../utils/math'
import { SUPPORTED_COUNTRIES, getCountryById } from '../data/countries'
import { UNASSIGNED_ACCOUNT_ID } from '../types/transaction'
import { CSV_ADAPTERS } from '../utils/csvAdapters'

const accountStore  = useAccountStore()
const settings      = useSettingsStore()
const txStore       = useTransactionStore()
const goalStore     = useSavingsGoalStore()
const loanStore     = useLoanStore()

const { moneyFocus, moneyBlur } = useMoneyInput()
const { confirm } = useConfirm()

const emit = defineEmits<{
  viewTransactions: [accountId: string]
  viewInReports:    [accountId: string]
  viewBreakdown:    [month: string, accountId: string]
  viewSavingsGoal:  [goalId: number]
  viewFinance:      [kind: 'loan' | 'savings', id: number]
}>()

function formatMoney(v: number): string { return settings.formatMoney(v) }

// â”€â”€ Add account â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const newName     = ref('')
const newType     = ref<'asset' | 'savings' | 'liability'>('asset')
const addInputRef = ref<HTMLInputElement | null>(null)

const openingBalanceAccountId = ref<string | null>(null)
const openingBalanceStr       = ref('')
const openingBalanceDate      = ref(getTodayStr())

// Pending quick-add: user picks bank+type → OB form shown first → account created on confirm
type PendingQuickAdd = { bank: typeof SUPPORTED_COUNTRIES[0]['banks'][0]; type: string }
const pendingQuickAdd = ref<PendingQuickAdd | null>(null)
const pendingObStr    = ref('0')
const pendingObDate   = ref(getTodayStr())

function commitAdd(): void {
  const name = newName.value.trim()
  if (!name) return
  // If a previous account's OB prompt is still pending, skip it cleanly first
  if (openingBalanceAccountId.value !== null) {
    openingBalanceAccountId.value = null
  }
  const id = accountStore.addAccount(name, newType.value)
  newName.value = ''
  newType.value = 'asset'
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

function onNameInputBlur(e: FocusEvent): void {
  // If focus moved to an element inside the same account card (e.g. bank select), don't exit edit mode
  const related = e.relatedTarget as HTMLElement | null
  if (related?.closest?.('.acct-card')) return
  commitRename()
}

function cancelRename(): void {
  editingId.value = null
  editName.value  = ''
}

// ── Remove / unlink account ───────────────────────────────────────────────────────────────────────────────────────────
async function requestRemove(id: string): Promise<void> {
  const acc = accountStore.accounts.find(a => a.id === id)
  if (!acc) return
  const txCount   = txStore.transactions.filter(t => t.accountId === id).length
  const goalCount = goalStore.goals.filter(g => g.linkedAccountId === id).length
  const loanCount = loanStore.loans.filter(l => l.linkedAccountId === id).length
  const savCount  = loanStore.savings.filter(s => s.linkedAccountId === id).length

  const linked: string[] = []
  if (txCount   > 0) linked.push(`${txCount} transaction${txCount !== 1 ? 's' : ''}`)
  if (goalCount > 0) linked.push(`${goalCount} savings goal${goalCount !== 1 ? 's' : ''}`)
  if (loanCount + savCount > 0) linked.push(`${loanCount + savCount} finance record${loanCount + savCount !== 1 ? 's' : ''} (will be unlinked only)`)

  const detail = linked.length
    ? `This will permanently delete: ${linked.join(', ')}. This cannot be undone.`
    : 'This cannot be undone.'

  const ok = await confirm({
    title:        `Delete "${acc.name}"?`,
    message:      detail,
    confirmLabel: 'Delete Account',
    danger:       true,
  })
  if (ok) accountStore.removeAccount(id)
}

async function requestUnlinkTransactions(id: string): Promise<void> {
  const acc = accountStore.accounts.find(a => a.id === id)
  if (!acc) return
  const txCount = txStore.transactions.filter(t => t.accountId === id).length
  if (txCount === 0) return

  const ok = await confirm({
    title:        `Unlink transactions from "${acc.name}"?`,
    message:      `${txCount} transaction${txCount !== 1 ? 's' : ''} will be set to unassigned. The account and transactions are kept — only the link is removed.`,
    confirmLabel: 'Unlink',
    danger:       false,
  })
  if (ok) accountStore.unlinkTransactions(id)
}

async function requestArchive(id: string): Promise<void> {
  const acc = accountStore.accounts.find(a => a.id === id)
  if (!acc) return
  const txCount = txStore.transactions.filter(t => t.accountId === id).length
  const linkedGoalCount    = goalStore.goals.filter(g => !g.archived && g.linkedAccountId === id).length
  const linkedFinanceCount = [
    ...loanStore.loans.filter(l => !l.archived && l.linkedAccountId === id),
    ...loanStore.savings.filter(s => !s.archived && s.linkedAccountId === id),
  ].length
  const extras: string[] = []
  if (txCount            > 0) extras.push(`${txCount} transaction${txCount !== 1 ? 's' : ''} will be locked`)
  if (linkedGoalCount    > 0) extras.push(`${linkedGoalCount} savings goal${linkedGoalCount !== 1 ? 's' : ''} will be archived`)
  if (linkedFinanceCount > 0) extras.push(`${linkedFinanceCount} finance record${linkedFinanceCount !== 1 ? 's' : ''} will be archived`)

  const ok = await confirm({
    title:        `Archive "${acc.name}"?`,
    message:      extras.length > 0
      ? `This account will be marked as historical. ${extras.join(', ')}.`
      : 'This account will be marked as historical.',
    confirmLabel: 'Archive',
    danger:       false,
  })
  if (ok) accountStore.archiveAccount(id)
}

function requestUnarchive(id: string): void {
  accountStore.unarchiveAccount(id)
}

// ── Reconcile ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const reconcilingId      = ref<string | null>(null)
const reconcileTargetStr = ref('')

function accountBalance(id: string): number {
  return txStore.transactions
    .filter(t => t.accountId === id)
    .reduce((sum, transaction) => sum + txNet(transaction), 0)
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
  const diff = roundCents(target - accountBalance(id))
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

const _allAccountDetails = computed(() =>
  accountStore.accounts.map(acc => {
    const txs      = txStore.transactions.filter(t => t.accountId === acc.id)
    const balance  = txs.reduce((sum, transaction) => sum + txNet(transaction), 0)
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
      .filter(g => g.linkedAccountId === acc.id)
      .map(g => ({ id: g.id, name: g.name, color: g.color, archived: g.archived }))

    const linkedFinance = [
      ...loanStore.loans
        .filter(l => l.linkedAccountId === acc.id)
        .map(l => ({ id: `loan-${l.id}`, rawId: l.id, name: l.name, color: l.color, kind: 'loan' as const, archived: l.archived })),
      ...loanStore.savings
        .filter(s => s.linkedAccountId === acc.id)
        .map(s => ({ id: `sav-${s.id}`, rawId: s.id, name: s.name, color: s.color, kind: 'savings' as const, archived: s.archived })),
    ]

    return { id: acc.id, name: acc.name, balance, txCount, recent, thisMonthIn, thisMonthOut, lastMonthOut, spendTrend, maxOut, vsLastMonth, linkedGoals, linkedFinance,
      type:             (acc.type ?? 'asset') as 'asset' | 'savings' | 'liability',
      includedInBudget: acc.excludeFromBudget !== undefined ? !acc.excludeFromBudget : acc.type !== 'liability',
      archived:         acc.archived ?? false,
      bankId:           acc.bankId ?? '',
    }
  })
)

const accountDetails         = computed(() => _allAccountDetails.value.filter(a => !a.archived))
const archivedAccountDetails = computed(() => _allAccountDetails.value.filter(a => a.archived))
const showArchivedAccounts   = ref(false)

// ── Bank filter ───────────────────────────────────────────────────────────
const filterBankId = ref<string>('')

const activeBanks = computed(() => {
  const ids = new Set(accountDetails.value.map(a => a.bankId).filter(Boolean))
  return (userCountry.value?.banks ?? []).filter(b => b.adapterId && ids.has(b.adapterId))
})

function getBankColor(bankId: string): string {
  return userCountry.value?.banks.find(b => b.adapterId === bankId)?.color ?? ''
}

const filteredAccountDetails = computed(() =>
  filterBankId.value === ''
    ? accountDetails.value
    : accountDetails.value.filter(a => a.bankId === filterBankId.value)
)

const unassignedDetails = computed(() => {
  const txs = txStore.transactions.filter(t => t.accountId === null)
  if (txs.length === 0) return null
  const balance      = txs.reduce((sum, transaction) => sum + txNet(transaction), 0)
  const txCount      = txs.length
  const recent       = txs.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 4)
  const nowTxs       = txs.filter(t => t.date.startsWith(_nowKey))
  const lastTxs      = txs.filter(t => t.date.startsWith(_lastKey))
  const thisMonthIn  = nowTxs.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0)
  const thisMonthOut = nowTxs.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0)
  const lastMonthOut = lastTxs.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0)
  const spendTrend   = sixMonthKeys.map(key => ({
    key, label: shortMonth(key),
    out: txs.filter(t => t.date.startsWith(key) && t.type === 'out').reduce((s, t) => s + t.amount, 0),
  }))
  const maxOut       = Math.max(1, ...spendTrend.map(m => m.out))
  const vsLastMonth  = lastMonthOut > 0 ? Math.round(((thisMonthOut - lastMonthOut) / lastMonthOut) * 100) : null
  return { id: UNASSIGNED_ACCOUNT_ID, name: 'Unassigned', balance, txCount, recent, thisMonthIn, thisMonthOut, spendTrend, maxOut, vsLastMonth }
})

// ── Account type & budget helpers ─────────────────────────────────────────────────────────────────
const LIABILITY_QUICK_TYPES = new Set(['Credit Card', 'Mortgage', 'Loan Account'])
const SAVINGS_QUICK_TYPES   = new Set(['Savings Account'])

const ACCOUNT_TYPE_CYCLE: Array<'asset' | 'savings' | 'liability'> = ['asset', 'savings', 'liability']

function cycleAccountType(id: string, current: 'asset' | 'savings' | 'liability'): void {
  const next = ACCOUNT_TYPE_CYCLE[(ACCOUNT_TYPE_CYCLE.indexOf(current) + 1) % ACCOUNT_TYPE_CYCLE.length]
  accountStore.updateAccount(id, { type: next, excludeFromBudget: undefined })
}

function setBankId(id: string, bankId: string): void {
  accountStore.updateAccount(id, { bankId: bankId || undefined })
}

// Adapters available as bank options (exclude generic, filter by active currency)
const bankOptions = computed(() =>
  CSV_ADAPTERS.filter(a => a.id !== 'generic' && (!a.currency || a.currency === settings.currency))
)

function toggleBudgetInclude(id: string, acc: { type: 'asset' | 'savings' | 'liability'; includedInBudget: boolean }): void {
  const newIncluded = !acc.includedInBudget
  const typeDefault = acc.type !== 'liability'
  accountStore.updateAccount(id, { excludeFromBudget: newIncluded === typeDefault ? undefined : !newIncluded })
}

// ── Quick Add ──────────────────────────────────────────────────────────────────────────────────────
const ACCOUNT_TYPES = ['Current Account', 'Savings Account', 'Joint Account', 'Credit Card', 'Mortgage', 'Loan Account']
const userCountry   = computed(() => getCountryById(settings.country) ?? null)
const selectedBank  = ref<(typeof SUPPORTED_COUNTRIES[0]['banks'][0]) | null>(null)

// Only list banks that have a registered (non-generic) CSV adapter — updates automatically as adapters are added
const _supportedAdapterIds = new Set(CSV_ADAPTERS.filter(a => a.id !== 'generic').map(a => a.id))
const quickAddBanks = computed(() =>
  (userCountry.value?.banks ?? []).filter(b => b.adapterId && _supportedAdapterIds.has(b.adapterId))
)

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
  // Show OB form FIRST — account is created only after the user confirms or skips
  pendingQuickAdd.value = { bank, type }
  pendingObStr.value    = '0'
  pendingObDate.value   = getTodayStr()
}

function confirmPendingAdd(): void {
  const qa = pendingQuickAdd.value
  if (!qa) return
  const accType = LIABILITY_QUICK_TYPES.has(qa.type) ? 'liability' : SAVINGS_QUICK_TYPES.has(qa.type) ? 'savings' : 'asset'
  const id = accountStore.addAccount(getNextAccountName(`${qa.bank.prefix} ${qa.type}`), accType, qa.bank.adapterId)
  const raw = pendingObStr.value.trim()
  const amount = raw === '' ? 0 : parseFloat(raw)
  if (!isNaN(amount)) txStore.addOpeningBalance(id, amount, pendingObDate.value)
  pendingQuickAdd.value = null
  selectedBank.value    = null
}

function cancelPendingAdd(): void {
  pendingQuickAdd.value = null
}
</script>

<template>
  <div class="accounts-page">

    <!-- Confirm delete dialog is now handled by useConfirm (ConfirmDialog.vue) -->

    <div class="acct-layout">

      <!-- ── Left: account cards ──────────────────────────────────────── -->
      <div class="acct-cards-area">

        <!-- ── Bank filter bar ──────────────────────────────────── -->
        <div v-if="activeBanks.length >= 1" class="acct-filter-bar">
          <button
            class="acct-filter-pill"
            :class="{ 'acct-filter-pill--active': filterBankId === '' }"
            @click="filterBankId = ''"
          >All</button>
          <button
            v-for="bank in activeBanks"
            :key="bank.id"
            class="acct-filter-pill"
            :class="{ 'acct-filter-pill--active': filterBankId === bank.adapterId }"
            :style="{ '--pill-color': bank.color }"
            @click="filterBankId = bank.adapterId ?? ''"
          >
            <span class="acct-filter-pill-dot" />
            {{ bank.abbr }}
          </button>
        </div>

        <div v-if="accountDetails.length === 0" class="acct-empty-state">
          <i class="pi pi-wallet" style="font-size:2rem;opacity:0.3" />
          <p>No accounts yet.</p>
          <p class="acct-empty-hint">Use the panel on the right to add your first account.</p>
        </div>

        <div
          v-for="acc in filteredAccountDetails"
          :key="acc.id"
          class="acct-card"
          :class="{ 'acct-card--reconciling': reconcilingId === acc.id }"
          :style="acc.bankId && getBankColor(acc.bankId) ? { borderLeftColor: getBankColor(acc.bankId) } : {}"
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
                  @blur="onNameInputBlur($event)"
                />
              </template>
              <template v-else>
                <span class="acct-card-name">{{ acc.name }}</span>
              </template>
            </div>
            <div class="acct-card-actions">
              <button class="acct-icon-btn acct-icon-btn--labeled" title="View transactions for this account" @click="emit('viewTransactions', acc.id)">
                <i class="pi pi-receipt" />
                <span class="acct-btn-label">Txns</span>
              </button>
              <button class="acct-icon-btn acct-icon-btn--labeled" title="Reconcile account balance" @click="startReconcile(acc.id)">
                <i class="pi pi-calculator" />
                <span class="acct-btn-label">Reconcile</span>
              </button>
              <button class="acct-icon-btn acct-icon-btn--labeled" title="View in Reports" @click="emit('viewInReports', acc.id)">
                <i class="pi pi-chart-bar" />
                <span class="acct-btn-label">Reports</span>
              </button>
              <button class="acct-icon-btn" title="Rename" @click="startRename(acc.id, acc.name)">
                <i class="pi pi-pencil" />
              </button>
              <button class="acct-icon-btn" title="Unlink transactions" @click="requestUnlinkTransactions(acc.id)">
                <i class="pi pi-link" />
              </button>
              <button class="acct-icon-btn acct-icon-btn--muted" title="Archive account" @click="requestArchive(acc.id)">
                <i class="pi pi-history" />
              </button>
              <button class="acct-icon-btn acct-icon-btn--danger" title="Delete account" @click="requestRemove(acc.id)">
                <i class="pi pi-trash" />
              </button>
            </div>
          </div>

          <!-- Balance hero -->
          <div class="acct-card-balance" :class="acc.balance >= 0 ? 'money-positive' : 'money-negative'">
            {{ formatMoney(acc.balance) }}
          </div>
          <div class="acct-card-balance-label">All-time balance &middot; {{ acc.txCount }} transaction{{ acc.txCount !== 1 ? 's' : '' }}</div>

          <!-- Type badge + budget toggle -->
          <div class="acct-type-row">
            <button
              class="acct-type-badge"
              :class="acc.type === 'liability' ? 'acct-type-badge--liability' : acc.type === 'savings' ? 'acct-type-badge--savings' : 'acct-type-badge--asset'"
              :title="'Click to cycle: Asset → Savings → Liability'"
              @click="cycleAccountType(acc.id, acc.type)"
            >
              <i :class="acc.type === 'liability' ? 'pi pi-credit-card' : acc.type === 'savings' ? 'pi pi-building-columns' : 'pi pi-wallet'" />
              {{ acc.type === 'liability' ? 'Liability' : acc.type === 'savings' ? 'Savings' : 'Asset' }}
            </button>
            <label class="acct-budget-label" :class="{ 'acct-budget-label--excluded': !acc.includedInBudget }" :title="acc.includedInBudget ? 'Included in budget total' : 'Excluded from budget total'">
              <input type="checkbox" class="acct-budget-checkbox" :checked="acc.includedInBudget" @change="toggleBudgetInclude(acc.id, acc)" />
              <span>Budget</span>
            </label>
          </div>

          <!-- Bank (drives friendly-name cleaning in Transaction Log) -->
          <div class="acct-bank-row">
            <i class="pi pi-building-columns acct-bank-icon" />
            <template v-if="editingId === acc.id">
              <select
                class="acct-bank-select"
                :value="acc.bankId"
                @change="setBankId(acc.id, ($event.target as HTMLSelectElement).value)"
                title="Set bank for transaction name cleaning"
              >
                <option value="">— No bank selected —</option>
                <option v-for="adapter in bankOptions" :key="adapter.id" :value="adapter.id">
                  {{ adapter.name }}
                </option>
              </select>
            </template>
            <template v-else>
              <span class="acct-bank-label">
                {{ bankOptions.find(a => a.id === acc.bankId)?.name ?? '— No bank selected —' }}
              </span>
            </template>
          </div>

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
            <button
              v-for="bar in acc.spendTrend"
              :key="bar.key"
              class="acct-spark-col acct-spark-col--btn"
              :title="bar.label + ': ' + formatMoney(bar.out) + ' — click to view in Reports'"
              @click="emit('viewBreakdown', bar.key, acc.id)"
            >
              <div class="acct-spark-bar-wrap">
                <div
                  class="acct-spark-bar"
                  :class="{ 'acct-spark-bar--current': bar.key === _nowKey }"
                  :style="{ height: acc.maxOut > 0 ? Math.max(4, Math.round((bar.out / acc.maxOut) * 100)) + '%' : '4%' }"
                />
              </div>
              <span class="acct-spark-label">{{ bar.label }}</span>
            </button>
          </div>

          <!-- Recent transactions -->
          <div v-if="acc.recent.length > 0" class="acct-recent">
            <div class="acct-recent-title">Recent <span class="acct-recent-hint">— click to view all</span></div>
            <button
              v-for="tx in acc.recent"
              :key="tx.id"
              class="acct-recent-row acct-recent-row--link"
              :title="'View transactions for ' + acc.name"
              @click="emit('viewTransactions', acc.id)"
            >
              <span class="acct-recent-date">{{ tx.date.slice(5).replace('-', '/') }}</span>
              <span class="acct-recent-name">{{ tx.name }}</span>
              <span class="acct-recent-amount" :class="tx.type === 'in' ? 'money-positive' : 'money-negative'">
                {{ tx.type === 'in' ? '+' : '-' }}{{ formatMoney(tx.amount) }}
              </span>
            </button>
          </div>

          <!-- Linked savings goals & finance -->
          <div v-if="acc.linkedGoals.length > 0 || acc.linkedFinance.length > 0" class="acct-links">
            <span class="acct-links-label">Linked</span>
            <div class="acct-links-chips">
              <button
                v-for="g in acc.linkedGoals"
                :key="g.id"
                class="acct-link-chip acct-link-chip--goal acct-link-chip--btn"
                :style="{ '--chip-color': g.color }"
                :title="'Go to Savings Goal: ' + g.name"
                @click="emit('viewSavingsGoal', g.id)"
              >
                <i class="pi pi-flag" />{{ g.name }}
              </button>
              <button
                v-for="f in acc.linkedFinance"
                :key="f.id"
                class="acct-link-chip acct-link-chip--btn"
                :class="f.kind === 'loan' ? 'acct-link-chip--loan' : 'acct-link-chip--savings'"
                :style="{ '--chip-color': f.color }"
                :title="(f.kind === 'loan' ? 'Go to Loan: ' : 'Go to Savings Account: ') + f.name"
                @click="emit('viewFinance', f.kind, f.rawId)"
              >
                <i :class="f.kind === 'loan' ? 'pi pi-credit-card' : 'pi pi-building-columns'" />{{ f.name }}
              </button>
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

        <!-- ── Unassigned ghost card ──────────────────────────── -->
        <div v-if="unassignedDetails" class="acct-card acct-card--ghost">
          <div class="acct-card-header">
            <div class="acct-card-name-wrap">
              <span class="acct-card-name"><i class="pi pi-question-circle" style="opacity:0.5;margin-right:0.3rem" />{{ unassignedDetails.name }}</span>
            </div>
            <div class="acct-card-actions">
              <button class="acct-icon-btn acct-icon-btn--labeled" title="View unassigned transactions" @click="emit('viewTransactions', unassignedDetails.id)">
                <i class="pi pi-receipt" />
                <span class="acct-btn-label">Txns</span>
              </button>
              <button class="acct-icon-btn acct-icon-btn--labeled" title="View in Reports" @click="emit('viewInReports', unassignedDetails.id)">
                <i class="pi pi-chart-bar" />
                <span class="acct-btn-label">Reports</span>
              </button>
            </div>
          </div>

          <div class="acct-card-balance" :class="unassignedDetails.balance >= 0 ? 'money-positive' : 'money-negative'">
            {{ formatMoney(unassignedDetails.balance) }}
          </div>
          <div class="acct-card-balance-label">
            All-time balance &middot; {{ unassignedDetails.txCount }} transaction{{ unassignedDetails.txCount !== 1 ? 's' : '' }} &middot; <em>no account set</em>
          </div>

          <div class="acct-month-stats">
            <div class="acct-month-stat">
              <span class="acct-month-label">This Month In</span>
              <span class="acct-month-value money-positive">{{ formatMoney(unassignedDetails.thisMonthIn) }}</span>
            </div>
            <div class="acct-month-stat">
              <span class="acct-month-label">This Month Out</span>
              <span class="acct-month-value money-negative">{{ formatMoney(unassignedDetails.thisMonthOut) }}</span>
            </div>
            <div class="acct-month-stat">
              <span class="acct-month-label">vs Last Month</span>
              <span v-if="unassignedDetails.vsLastMonth !== null" class="acct-month-value" :class="unassignedDetails.vsLastMonth <= 0 ? 'money-positive' : 'money-negative'">
                {{ unassignedDetails.vsLastMonth > 0 ? '+' : '' }}{{ unassignedDetails.vsLastMonth }}%
              </span>
              <span v-else class="acct-month-value acct-muted">&mdash;</span>
            </div>
          </div>

          <div class="acct-spark">
            <button
              v-for="bar in unassignedDetails.spendTrend"
              :key="bar.key"
              class="acct-spark-col acct-spark-col--btn"
              :title="bar.label + ': ' + formatMoney(bar.out) + ' — click to view in Reports'"
              @click="emit('viewBreakdown', bar.key, unassignedDetails.id)"
            >
              <div class="acct-spark-bar-wrap">
                <div
                  class="acct-spark-bar"
                  :class="{ 'acct-spark-bar--current': bar.key === _nowKey }"
                  :style="{ height: unassignedDetails.maxOut > 0 ? Math.max(4, Math.round((bar.out / unassignedDetails.maxOut) * 100)) + '%' : '4%' }"
                />
              </div>
              <span class="acct-spark-label">{{ bar.label }}</span>
            </button>
          </div>

          <div v-if="unassignedDetails.recent.length > 0" class="acct-recent">
            <div class="acct-recent-title">Recent <span class="acct-recent-hint">— click to view all</span></div>
            <button
              v-for="tx in unassignedDetails.recent"
              :key="tx.id"
              class="acct-recent-row acct-recent-row--link"
              title="View unassigned transactions"
              @click="emit('viewTransactions', unassignedDetails.id)"
            >
              <span class="acct-recent-date">{{ tx.date.slice(5).replace('-', '/') }}</span>
              <span class="acct-recent-name">{{ tx.name }}</span>
              <span class="acct-recent-amount" :class="tx.type === 'in' ? 'money-positive' : 'money-negative'">
                {{ tx.type === 'in' ? '+' : '-' }}{{ formatMoney(tx.amount) }}
              </span>
            </button>
          </div>
        </div>

        <!-- ── Archived accounts section ──────────────────────────── -->
        <div v-if="archivedAccountDetails.length > 0" class="acct-archived-section">
          <button class="acct-archived-header" @click="showArchivedAccounts = !showArchivedAccounts">
            <i :class="showArchivedAccounts ? 'pi pi-chevron-down' : 'pi pi-chevron-right'" />
            <span>Archived accounts</span>
            <span class="acct-archived-count">{{ archivedAccountDetails.length }}</span>
          </button>

          <div v-if="showArchivedAccounts">
            <div
              v-for="acc in archivedAccountDetails"
              :key="acc.id"
              class="acct-card acct-card--archived"
            >
              <div class="acct-card-header">
                <div class="acct-card-name-wrap">
                  <span class="acct-card-name">{{ acc.name }}</span>
                </div>
                <div class="acct-card-actions">
                  <button class="acct-icon-btn" title="View transactions" @click="emit('viewTransactions', acc.id)">
                    <i class="pi pi-list" />
                  </button>
                  <button class="acct-icon-btn acct-icon-btn--restore" title="Unarchive account" @click="requestUnarchive(acc.id)">
                    <i class="pi pi-replay" />
                  </button>
                  <button class="acct-icon-btn acct-icon-btn--danger" title="Delete account" @click="requestRemove(acc.id)">
                    <i class="pi pi-trash" />
                  </button>
                </div>
              </div>

              <div class="acct-card-balance" :class="acc.balance >= 0 ? 'money-positive' : 'money-negative'">
                {{ formatMoney(acc.balance) }}
              </div>
              <div class="acct-card-balance-label">{{ acc.txCount }} transaction{{ acc.txCount !== 1 ? 's' : '' }} &middot; archived</div>

              <!-- Linked goals & finance (archived) -->
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
            </div>
          </div>
        </div>
      </div>

      <!-- â”€â”€ Right: management panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ -->
      <aside class="acct-sidebar">

        <!-- Add account -->
        <div class="settings-section">
          <p class="settings-section-title">Add Account</p>
          <div class="acct-type-picker">
            <button type="button" :class="['acct-type-pick-btn', newType === 'asset' ? 'acct-type-pick-btn--active' : '']" @click="newType = 'asset'">
              <i class="pi pi-wallet" /> Asset
            </button>
            <button type="button" :class="['acct-type-pick-btn acct-type-pick-btn--savings', newType === 'savings' ? 'acct-type-pick-btn--active' : '']" @click="newType = 'savings'">
              <i class="pi pi-building-columns" /> Savings
            </button>
            <button type="button" :class="['acct-type-pick-btn acct-type-pick-btn--liability', newType === 'liability' ? 'acct-type-pick-btn--active' : '']" @click="newType = 'liability'">
              <i class="pi pi-credit-card" /> Liability
            </button>
          </div>
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
                v-for="bank in quickAddBanks"
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
            <!-- OB form shown BEFORE account creation -->
            <Transition name="slide-down">
              <div v-if="pendingQuickAdd" class="accounts-ob-panel">
                <div class="accounts-ob-header">
                  <i class="pi pi-flag" />
                  <span>Opening balance for <strong>{{ pendingQuickAdd.bank.name }} {{ pendingQuickAdd.type }}</strong></span>
                </div>
                <div class="accounts-ob-body">
                  <div class="accounts-ob-field">
                    <label class="accounts-ob-label">Amount</label>
                    <input
                      type="text"
                      inputmode="decimal"
                      class="acct-name-input"
                      v-model="pendingObStr"
                      placeholder="0.00"
                      :ref="(el) => { if (el) { (el as HTMLInputElement).focus(); (el as HTMLInputElement).select() } }"
                      @focus="moneyFocus"
                      @blur="moneyBlur"
                      @keydown.enter.prevent="confirmPendingAdd"
                      @keydown.escape="cancelPendingAdd"
                    />
                  </div>
                  <div class="accounts-ob-field">
                    <label class="accounts-ob-label">Date</label>
                    <input type="date" class="acct-name-input" v-model="pendingObDate" @keydown.enter.prevent="confirmPendingAdd" />
                  </div>
                  <div class="accounts-ob-actions">
                    <button class="acct-btn acct-btn-ghost" @click="cancelPendingAdd">Cancel</button>
                    <button class="acct-btn acct-btn-primary" @click="confirmPendingAdd">Create Account</button>
                  </div>
                </div>
              </div>
            </Transition>
          </template>
        </div>

      </aside>
    </div>

  </div>
</template>
