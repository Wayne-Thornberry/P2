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
  reconcileTargetStr.value = accountBalance(id).toFixed(2)
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

// ── Quick Add: Irish Banks ─────────────────────────────────────
interface IrishBank {
  id: string
  abbr: string
  name: string
  color: string
  prefix: string
}

const IRISH_BANKS: IrishBank[] = [
  { id: 'boi',    abbr: 'BOI',  name: 'Bank of Ireland', color: '#003B6F', prefix: 'BOI'          },
  { id: 'aib',    abbr: 'AIB',  name: 'AIB',             color: '#007B5E', prefix: 'AIB'          },
  { id: 'ptsb',   abbr: 'PTSB', name: 'Permanent TSB',   color: '#006B3F', prefix: 'PTSB'         },
  { id: 'anpost', abbr: 'AP',   name: 'An Post',         color: '#CC1A1A', prefix: 'An Post'      },
  { id: 'cu',     abbr: 'CU',   name: 'Credit Union',    color: '#003B8E', prefix: 'Credit Union' },
  { id: 'rev',    abbr: 'R',    name: 'Revolut',         color: '#191C1F', prefix: 'Revolut'      },
  { id: 'n26',    abbr: 'N26',  name: 'N26',             color: '#23B07D', prefix: 'N26'          },
  { id: 'wise',   abbr: 'W',    name: 'Wise',            color: '#00B9A0', prefix: 'Wise'         },
]

const ACCOUNT_TYPES = [
  'Current Account',
  'Savings Account',
  'Joint Account',
  'Credit Card',
  'Mortgage',
  'Loan Account',
]

const selectedBank = ref<IrishBank | null>(null)

function selectBank(bank: IrishBank): void {
  selectedBank.value = selectedBank.value?.id === bank.id ? null : bank
}

function getNextAccountName(baseName: string): string {
  const names = new Set(accountStore.accounts.map(a => a.name))
  if (!names.has(baseName)) return baseName
  let n = 2
  while (names.has(`${baseName} (${n})`)) n++
  return `${baseName} (${n})`
}

function quickAddAccount(bank: IrishBank, type: string): void {
  const name = getNextAccountName(`${bank.prefix} ${type}`)
  const id   = accountStore.addAccount(name)
  openingBalanceAccountId.value = id
  openingBalanceStr.value       = ''
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

    <!-- Quick Add from Irish Banks -->
    <div class="settings-section">
      <p class="settings-section-title">Quick Add</p>
      <div class="bank-picker-grid">
        <button
          v-for="bank in IRISH_BANKS"
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
            >
              {{ type }}
            </button>
          </div>
        </div>
      </Transition>
    </div>

  </div>
</template>
