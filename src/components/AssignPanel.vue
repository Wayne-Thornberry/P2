<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Transaction } from '../types/transaction'
import type { BudgetItem } from '../types/budget'
import { useTransactionStore } from '../stores/transactionStore'
import { useAccountStore } from '../stores/accountStore'
import { useBudgetStore } from '../stores/budgetStore'
import { useSettingsStore } from '../stores/settingsStore'
import { suggestTopItems } from '../utils/autoCategory'
import { cleanTxName, hasFriendlyName, txNamesMatch } from '../utils/txNameCleaner'

const props = defineProps<{
  year: number
  month: number
}>()

const emit = defineEmits<{
  viewTransaction: [txName: string, yearMonth: string]
}>()

const txStore      = useTransactionStore()
const accountStore = useAccountStore()
const budgetStore  = useBudgetStore()
const settings     = useSettingsStore()

// ── Account → bankId lookup ────────────────────────────────────
const accountBankIdMap = computed(() =>
  new Map(accountStore.accounts.map(a => [a.id, a.bankId ?? null]))
)

// ── Friendly name helpers ──────────────────────────────────────
function txFriendlyName(tx: Transaction): string {
  const bankId = tx.accountId ? (accountBankIdMap.value.get(tx.accountId) ?? null) : null
  return cleanTxName(tx.name, bankId)
}

const currentFriendlyName = computed<string>(() =>
  current.value ? txFriendlyName(current.value) : ''
)

const currentHasFriendly = computed<boolean>(() =>
  current.value
    ? hasFriendlyName(current.value.name, current.value.accountId ? accountBankIdMap.value.get(current.value.accountId) : null)
    : false
)

function navigateToTransaction(): void {
  const tx = current.value
  if (!tx) return
  const ym = `${props.year}-${String(props.month).padStart(2, '0')}`
  emit('viewTransaction', tx.name, ym)
}

// ── Unassigned list for this month ─────────────────────────────
const unassigned = computed<Transaction[]>(() =>
  txStore.transactions.filter(t => {
    if (t.itemId !== null) return false
    const [y, m] = t.date.split('-').map(Number)
    return y === props.year && m === props.month
  })
)

// ── Current index ──────────────────────────────────────────────
const index = ref(0)
const current = computed<Transaction | null>(() => unassigned.value[index.value] ?? null)

watch(unassigned, () => {
  if (index.value >= unassigned.value.length) {
    index.value = Math.max(0, unassigned.value.length - 1)
  }
})

// ── Suggestions ────────────────────────────────────────────────
const TOP_N_SUGGESTIONS = 6

const suggestions = computed<BudgetItem[]>(() => {
  if (!current.value) return []
  const nameForMatching = currentFriendlyName.value || current.value.name
  return suggestTopItems(nameForMatching, budgetStore.items, TOP_N_SUGGESTIONS)
})

// ── All items grouped for the "browse all" dropdown ────────────
const allCategories = computed<string[]>(() => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of budgetStore.items) {
    if (!seen.has(item.category)) { seen.add(item.category); result.push(item.category) }
  }
  return result
})

const browseText        = ref('')
const browseNewCategory = ref('')

// All items as a flat list for datalist lookup
const allItems = computed(() => budgetStore.items)

// The existing item whose name case-insensitively matches the typed text
const browseMatchedItem = computed<BudgetItem | null>(() => {
  const q = browseText.value.trim().toLowerCase()
  if (!q) return null
  return allItems.value.find(i => i.name.toLowerCase() === q) ?? null
})

// Whether the typed text is a genuinely new name (non-empty, no match)
const browseIsNew = computed(() =>
  browseText.value.trim().length > 0 && browseMatchedItem.value === null
)

// ── Bulk suggest ───────────────────────────────────────────────
type BulkSuggest = {
  tx:       Transaction   // pending: not yet committed to the store
  txName:   string
  itemId:   number
  itemName: string
  matches:  Transaction[]
}
const bulkSuggest = ref<BulkSuggest | null>(null)

function _commitAssign(tx: Transaction, itemId: number): void {
  txStore.updateTransaction(tx.id, {
    name:      tx.name,
    date:      tx.date,
    type:      tx.type,
    amount:    tx.amount,
    itemId,
    accountId: tx.accountId,
  })
}

// ── Actions ────────────────────────────────────────────────────
function assign(itemId: number): void {
  const tx = current.value
  if (!tx) return

  browseText.value = ''

  // Check for similar unassigned transactions BEFORE committing anything
  const txClean = txFriendlyName(tx)
  const similar = txStore.transactions.filter(
    t => t.itemId === null && t.id !== tx.id && txNamesMatch(txFriendlyName(t), txClean)
  )

  if (similar.length > 0) {
    // Defer assignment — let user decide scope first
    const item = budgetStore.items.find(i => i.id === itemId)
    bulkSuggest.value = {
      tx,
      txName:   tx.name,
      itemId,
      itemName: item?.name ?? 'this item',
      matches:  similar,
    }
    return
  }

  // No similar transactions — assign immediately
  _commitAssign(tx, itemId)
}

function confirmBulkAssign(): void {
  if (!bulkSuggest.value) return
  const { tx, matches, itemId } = bulkSuggest.value
  _commitAssign(tx, itemId)
  for (const t of matches) {
    _commitAssign(t, itemId)
  }
  bulkSuggest.value = null
}

function dismissBulkSuggest(): void {
  if (!bulkSuggest.value) return
  const { tx, itemId } = bulkSuggest.value
  // Assign only the current transaction
  _commitAssign(tx, itemId)
  bulkSuggest.value = null
}

function assignFromBrowse(): void {
  if (!browseMatchedItem.value) return
  assign(browseMatchedItem.value.id)
  browseText.value = ''
  browseNewCategory.value = ''
}

function createAndAssign(): void {
  const name = browseText.value.trim()
  const cat  = browseNewCategory.value
  if (!name || !cat) return
  // addItem creates a global item + adds it to the active month entries
  budgetStore.addItem(name, cat)
  // Find the newly created item by name
  const newItem = budgetStore.items.find(i => i.name === name)
  if (newItem) assign(newItem.id)
  browseText.value = ''
  browseNewCategory.value = ''
}

function skip(): void {
  index.value = Math.min(index.value + 1, unassigned.value.length - 1)
  browseText.value = ''
  browseNewCategory.value = ''
}

function prev(): void {
  index.value = Math.max(0, index.value - 1)
  browseText.value = ''
  browseNewCategory.value = ''
}

// ── Display helpers ────────────────────────────────────────────
function formatMoney(v: number, type: 'in' | 'out'): string {
  const fmt = settings.formatMoney(Math.abs(v))
  return type === 'out' ? `-${fmt}` : fmt
}

function formatDate(iso: string): string {
  return settings.formatDate(iso)
}

const monthLabel = computed(() =>
  new Date(props.year, props.month - 1, 1)
    .toLocaleDateString(settings.locale, { month: 'long', year: 'numeric' })
)

const progress = computed(() => {
  const total = unassigned.value.length
  return total === 0 ? 100 : Math.round((index.value / total) * 100)
})
</script>

<template>
  <div class="assign-panel" :class="{ dark: settings.theme === 'dark' || settings.theme === 'midnight' || settings.theme === 'forest' || settings.theme === 'purple', 'theme-midnight': settings.theme === 'midnight', 'theme-forest': settings.theme === 'forest', 'theme-purple': settings.theme === 'purple' }">

    <!-- Header -->
    <div class="assign-dialog-header">
      <div class="assign-dialog-title">
        <i class="pi pi-tag" />
        Assign Transactions
        <span class="assign-dialog-month">{{ monthLabel }}</span>
      </div>
    </div>

    <!-- All done -->
    <div v-if="unassigned.length === 0" class="assign-dialog-done">
      <i class="pi pi-check-circle assign-dialog-done-icon" />
      <p class="assign-dialog-done-title">All caught up!</p>
      <p class="assign-dialog-done-sub">Every transaction for {{ monthLabel }} has been assigned.</p>
    </div>

    <!-- Active review -->
    <template v-else>

    <!-- Bulk suggest banner -->
      <div v-if="bulkSuggest" class="assign-bulk-banner">
        <div class="assign-bulk-banner-msg">
          <i class="pi pi-bolt" />
          <span>
            <strong>{{ bulkSuggest.matches.length }}</strong>
            other unassigned
            <strong>"{{ bulkSuggest.txName }}"</strong>
            {{ bulkSuggest.matches.length === 1 ? 'transaction' : 'transactions' }} found.
            Assign {{ bulkSuggest.matches.length === 1 ? 'it' : 'all' }} to
            <strong>{{ bulkSuggest.itemName }}</strong>?
          </span>
        </div>
        <div class="assign-bulk-banner-actions">
          <button class="assign-bulk-confirm-btn" @click="confirmBulkAssign">
            <i class="pi pi-check" /> Assign all {{ bulkSuggest.matches.length }}
          </button>
          <button class="assign-bulk-dismiss-btn" @click="dismissBulkSuggest">
            Just this one
          </button>
        </div>
      </div>

      <!-- Progress row -->
      <div class="assign-dialog-progress-row">
        <span class="assign-dialog-progress-label">
          {{ index + 1 }} of {{ unassigned.length }} unassigned
        </span>
        <div class="assign-dialog-progress-bar-wrap">
          <div class="assign-dialog-progress-bar" :style="{ width: progress + '%' }" />
        </div>
      </div>

      <!-- Transaction card — whole card is clickable to navigate to the transaction log -->
      <button v-if="current" class="assign-tx-card assign-tx-card--link" @click="navigateToTransaction" title="View in Transaction Log">
        <div class="assign-tx-name">
          {{ current.name }}
          <i class="pi pi-arrow-right assign-tx-name-icon" />
        </div>
        <!-- Always rendered to hold height; invisible when no merchant cleaning -->
        <div class="assign-tx-friendly" :class="{ 'assign-tx-friendly--hidden': !currentHasFriendly }">
          <i class="pi pi-sparkles" /> {{ currentHasFriendly ? currentFriendlyName : '&nbsp;' }}
        </div>
        <div class="assign-tx-meta">
          <span class="assign-tx-date">{{ formatDate(current.date) }}</span>
          <span
            class="assign-tx-amount"
            :class="current.type === 'in' ? 'money-positive' : 'money-negative'"
          >
            {{ formatMoney(current.amount, current.type) }}
          </span>
          <span class="assign-tx-type-badge" :class="current.type === 'in' ? 'badge-in' : 'badge-out'">
            {{ current.type === 'in' ? '↑ In' : '↓ Out' }}
          </span>
        </div>
      </button>

      <!-- Suggestions -->
      <div class="assign-suggestions-label">
        <i class="pi pi-sparkles" /> Suggested items
      </div>
      <div class="assign-suggestions-grid">
        <button
          v-for="item in suggestions"
          :key="item.id"
          class="assign-suggestion-btn"
          @click="assign(item.id)"
        >
          <span class="assign-suggestion-name">{{ item.name }}</span>
          <span class="assign-suggestion-cat">{{ item.category }}</span>
        </button>
      </div>

      <!-- Browse / create item -->
      <div class="assign-browse-row">
        <span class="assign-browse-label">Or search items / create new</span>
        <datalist id="assign-items-datalist">
          <option v-for="item in allItems" :key="item.id" :value="item.name" />
        </datalist>
        <input
          list="assign-items-datalist"
          class="assign-browse-input"
          v-model="browseText"
          placeholder="Type to search or create…"
          autocomplete="off"
        />
        <!-- Matched existing item -->
        <div v-if="browseMatchedItem" class="assign-browse-action-row">
          <span class="assign-browse-match-info">
            <span class="assign-browse-match-cat">{{ browseMatchedItem.category }}</span>
            <span class="assign-browse-match-name">{{ browseMatchedItem.name }}</span>
          </span>
          <button class="assign-browse-apply-btn" @click="assignFromBrowse">Assign</button>
        </div>
        <!-- New item —  show category picker + Create & Assign -->
        <div v-else-if="browseIsNew" class="assign-browse-create-row">
          <select v-model="browseNewCategory" class="assign-browse-cat-select">
            <option value="">Select category…</option>
            <option v-for="cat in allCategories" :key="cat" :value="cat">{{ cat }}</option>
          </select>
          <button
            class="assign-browse-apply-btn assign-browse-apply-btn--create"
            :disabled="!browseNewCategory"
            @click="createAndAssign"
          >
            <i class="pi pi-plus" /> Create &amp; Assign
          </button>
        </div>
      </div>

      <!-- Nav row -->
      <div class="assign-nav-row">
        <button class="assign-nav-btn" :disabled="index === 0" @click="prev">
          <i class="pi pi-chevron-left" /> Prev
        </button>
        <button class="assign-skip-btn" @click="skip" :disabled="index >= unassigned.length - 1">
          Skip <i class="pi pi-chevron-right" />
        </button>
      </div>

    </template>
  </div>
</template>

<style scoped>
.assign-panel {
  border: 2px solid #e4e4e7;
  background: #ffffff;
  color: #18181b;
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 1rem;
  overflow: hidden;
}

.assign-panel.dark {
  background: #1c1c1e;
  color: #f4f4f5;
  border-color: #3f3f46;
}

.assign-panel.theme-midnight {
  background: #0f172a;
  color: #f1f5f9;
  border-color: #334155;
}

.assign-panel.theme-forest {
  background: #101f16;
  color: #e6f2e8;
  border-color: #264d36;
}

.assign-panel.theme-purple {
  background: #1a0930;
  color: #f0e6fa;
  border-color: #431f5e;
}
</style>
