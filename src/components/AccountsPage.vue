<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAccountStore } from '../stores/accountStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTransactionStore } from '../stores/transactionStore'
import { useMoneyInput } from '../composables/useMoneyInput'
import { getTodayStr } from '../utils/date'

const accountStore = useAccountStore()
const settings     = useSettingsStore()
const txStore      = useTransactionStore()

const { moneyFocus, moneyBlur } = useMoneyInput()

const emit = defineEmits<{ viewTransactions: [accountId: string] }>()

function formatMoney(v: number): string { return settings.formatMoney(v) }

// ── Add account ────────────────────────────────────────────────
const newName     = ref('')
const addInputRef = ref<HTMLInputElement | null>(null)

// Opening balance prompt for a freshly created account
const openingBalanceAccountId = ref<string | null>(null)
const openingBalanceStr       = ref('')
const openingBalanceDate      = ref(getTodayStr())

function commitAdd(): void {
  const name = newName.value.trim()
  if (!name) return
  const id = accountStore.addAccount(name)
  newName.value = ''
  // Prompt for opening balance
  openingBalanceAccountId.value = id
  openingBalanceStr.value       = ''
  openingBalanceDate.value      = getTodayStr()
}

function commitOpeningBalance(): void {
  const id = openingBalanceAccountId.value
  if (id) {
    const amount = parseFloat(openingBalanceStr.value)
    if (!isNaN(amount) && amount !== 0) {
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

// ── Rename account ─────────────────────────────────────────────
const editingId   = ref<string | null>(null)
const editName    = ref('')

function startRename(id: string, name: string): void {
  editingId.value = id
  editName.value  = name
}

function commitRename(): void {
  if (editingId.value) {
    accountStore.renameAccount(editingId.value, editName.value)
  }
  editingId.value = null
  editName.value  = ''
}

function cancelRename(): void {
  editingId.value = null
  editName.value  = ''
}

// ── Remove account ─────────────────────────────────────────────
const confirmRemoveId = ref<string | null>(null)

function requestRemove(id: string): void {
  confirmRemoveId.value = id
}

function confirmRemove(): void {
  if (confirmRemoveId.value) {
    accountStore.removeAccount(confirmRemoveId.value)
  }
  confirmRemoveId.value = null
}

function cancelRemove(): void {
  confirmRemoveId.value = null
}

// ── Per-account balance + tx count (single-pass computed) ─────────
const accountStats = computed(() => {
  const balances = new Map<string, number>()
  const counts   = new Map<string, number>()
  for (const t of txStore.transactions) {
    if (!t.accountId) continue
    balances.set(t.accountId, (balances.get(t.accountId) ?? 0) + (t.type === 'in' ? t.amount : -t.amount))
    counts.set(t.accountId, (counts.get(t.accountId) ?? 0) + 1)
  }
  return { balances, counts }
})

function accountBalance(id: string): number {
  return accountStats.value.balances.get(id) ?? 0
}

function accountTxCount(id: string): number {
  return accountStats.value.counts.get(id) ?? 0
}

// ── Reconcile ──────────────────────────────────────────────────
const reconcilingId      = ref<string | null>(null)
const reconcileTargetStr = ref('')

function startReconcile(id: string): void {
  editingId.value          = null
  reconcilingId.value      = id
  reconcileTargetStr.value = String(accountBalance(id))
}

function cancelReconcile(): void {
  reconcilingId.value      = null
  reconcileTargetStr.value = ''
}

function commitReconcile(id: string): void {
  const target  = parseFloat(reconcileTargetStr.value)
  if (isNaN(target)) { cancelReconcile(); return }
  const current = accountBalance(id)
  const diff    = Math.round((target - current) * 100) / 100
  if (diff === 0) { cancelReconcile(); return }
  txStore.addTransaction({
    name:      'Reconciliation adjustment',
    date:      getTodayStr(),
    type:      diff > 0 ? 'in' : 'out',
    amount:    Math.abs(diff),
    itemId:    null,
    accountId: id,
  })
  cancelReconcile()
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

    <!-- Header section -->
    <div class="settings-section">
      <p class="settings-section-title">Accounts</p>

      <!-- Account list -->
      <div v-if="accountStore.accounts.length === 0" class="accounts-empty">
        No accounts yet. Add one below.
      </div>

      <template v-for="acc in accountStore.accounts" :key="acc.id">
        <div class="accounts-row">
          <!-- Name (or inline rename input) -->
          <div class="accounts-row-info">
            <template v-if="editingId === acc.id">
              <input
                class="acct-name-input"
                v-model="editName"
                :ref="(el) => { if (el) (el as HTMLInputElement).focus() }"
                @keydown.enter.prevent="commitRename"
                @keydown.escape="cancelRename"
                @blur="commitRename"
              />
            </template>
            <template v-else>
              <span class="accounts-row-name">{{ acc.name }}</span>
              <span class="accounts-row-meta">{{ accountTxCount(acc.id) }} transaction{{ accountTxCount(acc.id) !== 1 ? 's' : '' }}</span>
            </template>
          </div>

          <!-- Balance -->
          <span
            v-if="editingId !== acc.id && reconcilingId !== acc.id"
            class="accounts-row-balance"
            :class="accountBalance(acc.id) >= 0 ? 'money-positive' : 'money-negative'"
          >
            {{ formatMoney(accountBalance(acc.id)) }}
          </span>

          <!-- Actions -->
          <div class="accounts-row-actions" v-if="editingId !== acc.id && reconcilingId !== acc.id">
            <button class="acct-btn acct-btn-ghost acct-btn-sm" title="View Transactions" @click="emit('viewTransactions', acc.id)">
              <i class="pi pi-list" />
            </button>
            <button class="acct-btn acct-btn-ghost acct-btn-sm" title="Reconcile" @click="startReconcile(acc.id)">
              <i class="pi pi-sliders-h" />
            </button>
            <button class="acct-btn acct-btn-ghost acct-btn-sm" title="Rename" @click="startRename(acc.id, acc.name)">
              <i class="pi pi-pencil" />
            </button>
            <button class="acct-btn acct-btn-danger acct-btn-sm" title="Remove" @click="requestRemove(acc.id)">
              <i class="pi pi-trash" />
            </button>
          </div>
        </div>

        <!-- Reconcile panel (expands below its row) -->
        <div v-if="reconcilingId === acc.id" class="accounts-reconcile-panel">
          <div class="accounts-reconcile-info">
            <span class="accounts-reconcile-label">Tracked balance</span>
            <span class="accounts-reconcile-current" :class="accountBalance(acc.id) >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(accountBalance(acc.id)) }}</span>
          </div>
          <i class="pi pi-arrow-right accounts-reconcile-arrow" />
        <div class="accounts-reconcile-input-wrap">
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
      </template>

      <!-- Add new account row -->
      <div class="accounts-add-row">
        <input
          ref="addInputRef"
          class="acct-name-input acct-name-input-add"
          v-model="newName"
          placeholder="New account name…"
          @keydown="onAddKeydown"
        />
        <button class="acct-btn acct-btn-primary" @click="commitAdd">
          <i class="pi pi-plus" />
          Add Account
        </button>
      </div>

      <!-- Opening balance prompt (shown after account creation) -->
      <div v-if="openingBalanceAccountId !== null" class="accounts-ob-panel">
        <div class="accounts-ob-header">
          <i class="pi pi-flag" />
          <span>Set opening balance for <strong>{{ accountStore.accounts.find(a => a.id === openingBalanceAccountId)?.name }}</strong></span>
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
            <input
              type="date"
              class="acct-name-input"
              v-model="openingBalanceDate"
              @keydown.enter.prevent="commitOpeningBalance"
            />
          </div>
          <div class="accounts-ob-actions">
            <button class="acct-btn acct-btn-ghost" @click="skipOpeningBalance">Skip</button>
            <button class="acct-btn acct-btn-primary" @click="commitOpeningBalance">Set Balance</button>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
/* ── Page shell ─────────────────────────────────────────────── */
.accounts-page {
  max-width: 640px;
}

/* ── Account list rows ──────────────────────────────────────── */
.accounts-empty {
  padding: 1rem;
  font-size: 0.75rem;
  color: #71717a;
}

.accounts-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.65rem 1rem;
  border-bottom: 1px solid #e4e4e7;
}

.dark .accounts-row {
  border-bottom-color: #3f3f46;
}

.accounts-row:last-child {
  border-bottom: none;
}

.accounts-row-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.accounts-row-name {
  font-size: 0.8rem;
  font-weight: 700;
  color: #18181b;
}

.dark .accounts-row-name {
  color: #f4f4f5;
}

.accounts-row-meta {
  font-size: 0.65rem;
  color: #71717a;
}

.accounts-row-balance {
  font-size: 0.8rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  min-width: 6rem;
  text-align: right;
}

.accounts-row-actions {
  display: flex;
  gap: 0.35rem;
}

/* ── Reconcile panel ─────────────────────────────────────────── */
.accounts-reconcile-panel {
  display: flex;
  align-items: flex-end;
  gap: 1rem;
  padding: 0.85rem 1rem 0.85rem 1.25rem;
  background-color: #f4f4f5;
  border-bottom: 1px solid #e4e4e7;
  border-top: 1px solid #e4e4e7;
}

.dark .accounts-reconcile-panel {
  background-color: #27272a;
  border-color: #3f3f46;
}

.accounts-reconcile-info,
.accounts-reconcile-input-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.accounts-reconcile-label {
  font-size: 0.6rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #71717a;
}

.accounts-reconcile-current {
  font-size: 0.9rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.accounts-reconcile-arrow {
  font-size: 0.75rem;
  color: #a1a1aa;
  padding-bottom: 0.45rem;
}

.accounts-reconcile-input {
  width: 9rem;
  flex: none;
}

.accounts-reconcile-actions {
  display: flex;
  gap: 0.4rem;
  margin-left: auto;
}

/* ── Add row ────────────────────────────────────────────────── */
.accounts-add-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-top: 2px solid #e4e4e7;
  background-color: #f4f4f5;
}

.dark .accounts-add-row {
  border-top-color: #3f3f46;
  background-color: #27272a;
}

/* ── Opening balance panel ──────────────────────────────────── */
.accounts-ob-panel {
  border-top: 2px solid #3b82f6;
  background: #eff6ff;
  padding: 0.85rem 1rem;
}

.dark .accounts-ob-panel {
  background: #1e3a5f;
  border-top-color: #3b82f6;
}

.accounts-ob-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #1d4ed8;
  margin-bottom: 0.75rem;
}

.dark .accounts-ob-header {
  color: #93c5fd;
}

.accounts-ob-body {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.accounts-ob-field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  flex: 1;
  min-width: 8rem;
}

.accounts-ob-label {
  font-size: 0.6rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #71717a;
}

.dark .accounts-ob-label {
  color: #a1a1aa;
}

.accounts-ob-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding-bottom: 0.05rem;
}

/* ── Inputs ─────────────────────────────────────────────────── */
.acct-name-input {
  flex: 1;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.3rem 0.5rem;
  border: 2px solid #a1a1aa;
  background: #ffffff;
  color: #18181b;
  outline: none;
  min-width: 0;
}

.dark .acct-name-input {
  background: #18181b;
  color: #f4f4f5;
  border-color: #52525b;
}

.acct-name-input:focus {
  border-color: #18181b;
}

.dark .acct-name-input:focus {
  border-color: #e4e4e7;
}

.acct-name-input-add {
  max-width: 20rem;
}

/* ── Buttons ─────────────────────────────────────────────────── */
.acct-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.65rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 0.35rem 0.7rem;
  border: 2px solid transparent;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.acct-btn-sm {
  padding: 0.25rem 0.45rem;
  font-size: 0.6rem;
}

.acct-btn-primary {
  background-color: #18181b;
  color: #f4f4f5;
  border-color: #18181b;
}

.dark .acct-btn-primary {
  background-color: #f4f4f5;
  color: #18181b;
  border-color: #f4f4f5;
}

.acct-btn-primary:hover {
  background-color: #3f3f46;
  border-color: #3f3f46;
}

.dark .acct-btn-primary:hover {
  background-color: #d4d4d8;
  border-color: #d4d4d8;
}

.acct-btn-ghost {
  background-color: transparent;
  color: #52525b;
  border-color: #d4d4d8;
}

.dark .acct-btn-ghost {
  color: #a1a1aa;
  border-color: #3f3f46;
}

.acct-btn-ghost:hover {
  background-color: #e4e4e7;
  color: #18181b;
}

.dark .acct-btn-ghost:hover {
  background-color: #3f3f46;
  color: #f4f4f5;
}

.acct-btn-danger {
  background-color: transparent;
  color: #dc2626;
  border-color: #fca5a5;
}

.dark .acct-btn-danger {
  color: #f87171;
  border-color: #7f1d1d;
}

.acct-btn-danger:hover {
  background-color: #fee2e2;
  border-color: #dc2626;
}

.dark .acct-btn-danger:hover {
  background-color: #450a0a;
  border-color: #dc2626;
}

/* ── Confirm dialog ─────────────────────────────────────────── */
.accounts-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.accounts-dialog {
  background: #ffffff;
  border: 2px solid #18181b;
  padding: 1.5rem;
  max-width: 380px;
  width: 100%;
}

.dark .accounts-dialog {
  background: #18181b;
  border-color: #e4e4e7;
}

.accounts-dialog-title {
  font-size: 0.75rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 0 0 0.5rem;
  color: #18181b;
}

.dark .accounts-dialog-title {
  color: #f4f4f5;
}

.accounts-dialog-body {
  font-size: 0.75rem;
  color: #52525b;
  margin: 0 0 1.25rem;
  line-height: 1.5;
}

.dark .accounts-dialog-body {
  color: #a1a1aa;
}

.accounts-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

/* ── Money colours (shared globals but scoped fallbacks) ──── */
.money-positive { color: #16a34a; }
.money-negative { color: #dc2626; }

/* ── Midnight theme overrides (must live in scoped block) ─── */
.theme-midnight.dark .accounts-row {
  border-bottom-color: #334155;
}
.theme-midnight.dark .accounts-row-name {
  color: #f1f5f9;
}
.theme-midnight.dark .accounts-reconcile-panel {
  background-color: #1e293b;
  border-color: #334155;
}
.theme-midnight.dark .accounts-add-row {
  border-top-color: #334155;
  background-color: #1e293b;
}
.theme-midnight.dark .accounts-ob-panel {
  background: #12203a;
  border-top-color: #6366f1;
}
.theme-midnight.dark .accounts-ob-header {
  color: #a5b4fc;
}
.theme-midnight.dark .accounts-ob-label {
  color: #94a3b8;
}
.theme-midnight.dark .acct-name-input {
  background: #0f172a;
  color: #f1f5f9;
  border-color: #475569;
}
.theme-midnight.dark .acct-name-input:focus {
  border-color: #e2e8f0;
}
.theme-midnight.dark .acct-btn-primary {
  background-color: #f1f5f9;
  color: #0f172a;
  border-color: #f1f5f9;
}
.theme-midnight.dark .acct-btn-primary:hover {
  background-color: #cbd5e1;
  border-color: #cbd5e1;
}
.theme-midnight.dark .acct-btn-ghost {
  color: #94a3b8;
  border-color: #334155;
}
.theme-midnight.dark .acct-btn-ghost:hover {
  background-color: #334155;
  color: #f1f5f9;
}
.theme-midnight.dark .accounts-dialog {
  background: #0f172a;
  border-color: #e2e8f0;
}
.theme-midnight.dark .accounts-dialog-title {
  color: #f1f5f9;
}
.theme-midnight.dark .accounts-dialog-body {
  color: #94a3b8;
}

/* ── Forest theme overrides (must live in scoped block) ──── */
.theme-forest.dark .accounts-row {
  border-bottom-color: #264d36;
}
.theme-forest.dark .accounts-row-name {
  color: #e6f2e8;
}
.theme-forest.dark .accounts-reconcile-panel {
  background-color: #1a3325;
  border-color: #264d36;
}
.theme-forest.dark .accounts-add-row {
  border-top-color: #264d36;
  background-color: #1a3325;
}
.theme-forest.dark .accounts-ob-panel {
  background: #122818;
  border-top-color: #f59e0b;
}
.theme-forest.dark .accounts-ob-header {
  color: #f59e0b;
}
.theme-forest.dark .accounts-ob-label {
  color: #6aab7a;
}
.theme-forest.dark .acct-name-input {
  background: #101f16;
  color: #e6f2e8;
  border-color: #36694a;
}
.theme-forest.dark .acct-name-input:focus {
  border-color: #c5deca;
}
.theme-forest.dark .acct-btn-primary {
  background-color: #e6f2e8;
  color: #101f16;
  border-color: #e6f2e8;
}
.theme-forest.dark .acct-btn-primary:hover {
  background-color: #c5deca;
  border-color: #c5deca;
}
.theme-forest.dark .acct-btn-ghost {
  color: #6aab7a;
  border-color: #264d36;
}
.theme-forest.dark .acct-btn-ghost:hover {
  background-color: #264d36;
  color: #e6f2e8;
}
.theme-forest.dark .accounts-dialog {
  background: #101f16;
  border-color: #c5deca;
}
.theme-forest.dark .accounts-dialog-title {
  color: #e6f2e8;
}
.theme-forest.dark .accounts-dialog-body {
  color: #6aab7a;
}

/* ── Purple theme overrides (must live in scoped block) ──── */
.theme-purple.dark .accounts-row {
  border-bottom-color: #431f5e;
}
.theme-purple.dark .accounts-row-name {
  color: #f0e6fa;
}
.theme-purple.dark .accounts-reconcile-panel {
  background-color: #2c1040;
  border-color: #431f5e;
}
.theme-purple.dark .accounts-add-row {
  border-top-color: #431f5e;
  background-color: #2c1040;
}
.theme-purple.dark .accounts-ob-panel {
  background: #200838;
  border-top-color: #e879f9;
}
.theme-purple.dark .accounts-ob-header {
  color: #e879f9;
}
.theme-purple.dark .accounts-ob-label {
  color: #9a6ec8;
}
.theme-purple.dark .acct-name-input {
  background: #1a0930;
  color: #f0e6fa;
  border-color: #5e3280;
}
.theme-purple.dark .acct-name-input:focus {
  border-color: #dcc8f0;
}
.theme-purple.dark .acct-btn-primary {
  background-color: #f0e6fa;
  color: #1a0930;
  border-color: #f0e6fa;
}
.theme-purple.dark .acct-btn-primary:hover {
  background-color: #dcc8f0;
  border-color: #dcc8f0;
}
.theme-purple.dark .acct-btn-ghost {
  color: #9a6ec8;
  border-color: #431f5e;
}
.theme-purple.dark .acct-btn-ghost:hover {
  background-color: #431f5e;
  color: #f0e6fa;
}
.theme-purple.dark .accounts-dialog {
  background: #1a0930;
  border-color: #dcc8f0;
}
.theme-purple.dark .accounts-dialog-title {
  color: #f0e6fa;
}
.theme-purple.dark .accounts-dialog-body {
  color: #9a6ec8;
}
</style>
