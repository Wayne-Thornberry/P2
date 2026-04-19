<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import type { Transaction } from '../types/transaction'
import { useTransactionStore } from '../stores/transactionStore'
import { useAccountStore } from '../stores/accountStore'
import { useBudgetStore } from '../stores/budgetStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useMoneyInput } from '../composables/useMoneyInput'
import { getTodayStr } from '../utils/date'
import CsvImportDialog from './CsvImportDialog.vue'

const props = defineProps<{ monthFilter?: string; accountFilter?: string; itemFilter?: number; nameFilter?: string; typeFilter?: 'all' | 'in' | 'out' }>()

const store        = useTransactionStore()
const accountStore = useAccountStore()
const budgetStore  = useBudgetStore()
const settings     = useSettingsStore()

const { moneyFocus, moneyBlur } = useMoneyInput()

// -- Formatting (delegated to settingsStore) --
function formatMoney(v: number): string { return settings.formatMoney(v) }
function formatDate(iso: string): string { return settings.formatDate(iso) }
function formatCreatedAt(iso: string): string { return settings.formatCreatedAt(iso) }

// ── Lookups (Map-based for O(1) access in sort + display) ───────
// Use globalItems so transactions assigned to items from any month show the correct name
const itemNameMap    = computed(() => new Map(budgetStore.globalItems.map(i => [i.id, i.name])))
const accountNameMap = computed(() => new Map(accountStore.accounts.map(a => [a.id, a.name])))

// Flat sorted list of all global items for dropdowns
const budgetItemsSorted = computed(() =>
  [...budgetStore.globalItems].sort((a, b) => a.name.localeCompare(b.name))
)

function getItemName(itemId: number | null): string {
  return itemId === null ? '—' : (itemNameMap.value.get(itemId) ?? '—')
}

function getAccountName(accountId: string | null): string {
  return !accountId ? '—' : (accountNameMap.value.get(accountId) ?? '—')
}

// ── Filters ────────────────────────────────────────────────────
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

const availableYears = computed(() => {
  const seen = new Set<string>()
  for (const t of store.transactions) seen.add(t.date.slice(0, 4))
  return [...seen].sort((a, b) => b.localeCompare(a))
})

function _parseMonthFilter(v: string | undefined): { year: string; month: string } {
  if (!v) return { year: '', month: '' }
  const [y, m] = v.split('-')
  return { year: y ?? '', month: m ? String(parseInt(m, 10)) : '' }
}

const filterSearch    = ref(props.nameFilter ?? '')
const filterYear      = ref(_parseMonthFilter(props.monthFilter).year)
const filterMonthNum  = ref(_parseMonthFilter(props.monthFilter).month)
const filterType      = ref<'all' | 'in' | 'out'>(props.typeFilter ?? 'all')
const filterAccountId = ref<string | null>(props.accountFilter ?? null)
const filterItemId    = ref<number | null>(props.itemFilter ?? null)

watch(() => props.accountFilter, v => { filterAccountId.value = v ?? null })
watch(() => props.itemFilter,    v => { filterItemId.value    = v ?? null })
watch(() => props.typeFilter,    v => { filterType.value      = v ?? 'all' })
watch(() => props.monthFilter,   v => {
  const p = _parseMonthFilter(v)
  filterYear.value     = p.year
  filterMonthNum.value = p.month
})
watch(() => props.nameFilter, v => { filterSearch.value = v ?? '' })

const hasActiveFilters = computed(() =>
  filterSearch.value !== '' || filterYear.value !== '' || filterMonthNum.value !== '' ||
  filterType.value !== 'all' ||
  filterAccountId.value !== null || filterItemId.value !== null
)

function clearFilters(): void {
  filterSearch.value    = ''
  filterYear.value      = ''
  filterMonthNum.value  = ''
  filterType.value      = 'all'
  filterAccountId.value = null
  filterItemId.value    = null
}

// ── Sort ───────────────────────────────────────────────────────
type SortCol = 'date' | 'name' | 'amountIn' | 'amountOut' | 'item' | 'account' | 'added'
const sortCol = ref<SortCol | null>(null)
const sortDir = ref<'asc' | 'desc'>('asc')

function toggleSort(col: SortCol): void {
  if (sortCol.value !== col) {
    sortCol.value = col
    sortDir.value = col === 'date' ? 'desc' : 'asc'
  } else if (sortDir.value === (col === 'date' ? 'desc' : 'asc')) {
    sortDir.value = col === 'date' ? 'asc' : 'desc'
  } else {
    sortCol.value = null
  }
}

function sortIcon(col: SortCol): string {
  if (sortCol.value !== col) return 'pi pi-sort'
  return sortDir.value === 'desc' ? 'pi pi-sort-amount-down' : 'pi pi-sort-amount-up-alt'
}

// ── Pagination ─────────────────────────────────────────────────
const PAGE_SIZES = [25, 50, 100]
const pageSize   = ref(25)
const page       = ref(1)

// ── Filtered + sorted list ─────────────────────────────────────
const filteredTransactions = computed(() => {
  let list = [...store.transactions]
  if (filterYear.value) {
    list = list.filter(t => t.date.startsWith(filterYear.value))
  }
  if (filterMonthNum.value) {
    const mm = filterMonthNum.value.padStart(2, '0')
    list = list.filter(t => t.date.slice(5, 7) === mm)
  }
  const q = filterSearch.value.trim().toLowerCase()
  if (q) {
    list = list.filter(t => t.name.toLowerCase().includes(q))
  }
  if (filterType.value !== 'all') {
    list = list.filter(t => t.type === filterType.value)
  }
  if (filterAccountId.value !== null) {
    list = list.filter(t => t.accountId === filterAccountId.value)
  }
  if (filterItemId.value !== null) {
    if (filterItemId.value === -1) list = list.filter(t => t.itemId === null)
    else list = list.filter(t => t.itemId === filterItemId.value)
  }
  list.sort((a, b) => {
    const col = sortCol.value
    // Default: newest date first when no sort column active
    if (!col) {
      const dc = b.date.localeCompare(a.date)
      return dc !== 0 ? dc : b.createdAt.localeCompare(a.createdAt)
    }
    let cmp = 0
    if (col === 'date') {
      cmp = b.date.localeCompare(a.date)
      if (cmp === 0) cmp = b.createdAt.localeCompare(a.createdAt)
    } else if (col === 'name') {
      cmp = a.name.localeCompare(b.name)
    } else if (col === 'amountIn') {
      cmp = (b.type === 'in' ? b.amount : 0) - (a.type === 'in' ? a.amount : 0)
    } else if (col === 'amountOut') {
      cmp = (b.type === 'out' ? b.amount : 0) - (a.type === 'out' ? a.amount : 0)
    } else if (col === 'item') {
      cmp = getItemName(a.itemId).localeCompare(getItemName(b.itemId))
    } else if (col === 'account') {
      cmp = getAccountName(a.accountId).localeCompare(getAccountName(b.accountId))
    } else if (col === 'added') {
      cmp = a.createdAt.localeCompare(b.createdAt)
    }
    return sortDir.value === 'asc' ? -cmp : cmp
  })
  return list
})

const totalIn    = computed(() => filteredTransactions.value.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0))
const totalOut   = computed(() => filteredTransactions.value.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0))
const net        = computed(() => totalIn.value - totalOut.value)
const totalCount = computed(() => filteredTransactions.value.length)
const txMin      = computed(() => filteredTransactions.value.length ? Math.min(...filteredTransactions.value.map(t => t.amount)) : null)
const txMax      = computed(() => filteredTransactions.value.length ? Math.max(...filteredTransactions.value.map(t => t.amount)) : null)
const txAvg      = computed(() => filteredTransactions.value.length ? filteredTransactions.value.reduce((s, t) => s + t.amount, 0) / filteredTransactions.value.length : null)
const totalPages = computed(() => Math.max(1, Math.ceil(filteredTransactions.value.length / pageSize.value)))
const pagedTransactions = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filteredTransactions.value.slice(start, start + pageSize.value)
})

watch([filterSearch, filterYear, filterMonthNum, filterType, filterAccountId, filterItemId, pageSize, sortCol, sortDir], () => { page.value = 1 })

// ── Shared draft type ─────────────────────────────────────────
type RowDraft = {
  name: string
  date: string
  type: 'in' | 'out'
  amount: string
  itemIdStr: string
  accountIdStr: string
}

// ── Shared draft parser ────────────────────────────────────────
function parseDraft(d: RowDraft): Omit<Transaction, 'id' | 'createdAt'> | null {
  const name = d.name.trim()
  if (!name) return null
  return {
    name,
    date:      d.date,
    type:      d.type,
    amount:    Math.max(0, parseFloat(d.amount) || 0),
    itemId:    d.itemIdStr    !== '' ? parseInt(d.itemIdStr)    : null,
    accountId: d.accountIdStr !== '' ? d.accountIdStr : null,
  }
}

// ── Pending (new) transaction ──────────────────────────────────
const pending       = ref<RowDraft | null>(null)
const pendingRowRef = ref<HTMLElement | null>(null)
const nameInputRef  = ref<HTMLInputElement | null>(null)

async function startTransaction(): Promise<void> {
  cancelEdit()
  pending.value = { name: '', date: getTodayStr(), type: 'out', amount: '', itemIdStr: '', accountIdStr: '' }
  await nextTick()
  nameInputRef.value?.focus()
}

function commitTransaction(): void {
  if (!pending.value) return
  const parsed = parseDraft(pending.value)
  if (!parsed) { cancelTransaction(); return }
  store.addTransaction(parsed)
  pending.value = null
}

function cancelTransaction(): void {
  pending.value = null
}

function onPendingFocusOut(e: FocusEvent): void {
  const related = e.relatedTarget as HTMLElement | null
  if (!related || !pendingRowRef.value?.contains(related)) {
    if (pending.value?.name.trim()) {
      commitTransaction()
    } else {
      cancelTransaction()
    }
  }
}

function switchType(type: 'in' | 'out'): void {
  if (!pending.value) return
  pending.value.type = type
}

// ── Edit existing transaction ──────────────────────────────────
const editingId  = ref<number | null>(null)
const editDraft  = ref<RowDraft | null>(null)
const editRowRef = ref<HTMLElement | null>(null)

async function startEdit(tx: Transaction): Promise<void> {
  cancelTransaction()
  editingId.value = tx.id
  editDraft.value = {
    name:         tx.name,
    date:         tx.date,
    type:         tx.type,
    amount:       String(tx.amount),
    itemIdStr:    tx.itemId   === null ? '' : String(tx.itemId),
    accountIdStr: tx.accountId ?? '',
  }
  await nextTick()
  editRowRef.value?.querySelector<HTMLInputElement>('input')?.focus()
}

function commitEdit(): void {
  if (!editDraft.value || editingId.value === null) return
  const parsed = parseDraft(editDraft.value)
  if (!parsed) { cancelEdit(); return }
  store.updateTransaction(editingId.value, parsed)
  editingId.value = null
  editDraft.value = null
}

function cancelEdit(): void {
  editingId.value = null
  editDraft.value = null
}

function onEditFocusOut(e: FocusEvent): void {
  const related = e.relatedTarget as HTMLElement | null
  if (!related || !editRowRef.value?.contains(related)) {
    if (editDraft.value?.name.trim()) {
      commitEdit()
    } else {
      cancelEdit()
    }
  }
}

function switchEditType(type: 'in' | 'out'): void {
  if (!editDraft.value) return
  editDraft.value.type = type
}

// ── CSV Drag-and-Drop ──────────────────────────────────────────
const isDraggingOver      = ref(false)
const csvImportCount      = ref(0)
const csvImportMsg        = ref('')
const csvDialogVisible    = ref(false)
const pendingCsvText      = ref('')
let dragCounter = 0

function onDragEnter(e: DragEvent): void {
  e.preventDefault()
  dragCounter++
  if (e.dataTransfer?.types.includes('Files')) {
    isDraggingOver.value = true
  }
}

function onDragOver(e: DragEvent): void {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

function onDragLeave(): void {
  dragCounter--
  if (dragCounter <= 0) {
    dragCounter = 0
    isDraggingOver.value = false
  }
}

function onDrop(e: DragEvent): void {
  e.preventDefault()
  dragCounter = 0
  isDraggingOver.value = false
  const file = e.dataTransfer?.files[0]
  if (!file) return
  if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv' && file.type !== 'application/vnd.ms-excel') {
    csvImportMsg.value = 'Please drop a CSV file.'
    setTimeout(() => { csvImportMsg.value = '' }, 3000)
    return
  }
  const reader = new FileReader()
  reader.onload = (ev) => {
    const text = ev.target?.result as string
    if (text) {
      pendingCsvText.value = text
      csvDialogVisible.value = true
    }
  }
  reader.readAsText(file)
}

function onCsvDone(count: number): void {
  csvImportMsg.value   = count > 0 ? `Imported ${count} transaction${count !== 1 ? 's' : ''}.` : 'No valid transactions found in file.'
  csvImportCount.value = count
  setTimeout(() => { csvImportMsg.value = ''; csvImportCount.value = 0 }, 4000)
}

// ── Row selection ──────────────────────────────────────────────
const selectedIds = ref<Set<number>>(new Set())

function isSelected(id: number): boolean {
  return selectedIds.value.has(id)
}

function toggleSelected(id: number): void {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

const allFilteredSelected = computed(() =>
  filteredTransactions.value.length > 0 &&
  filteredTransactions.value.every(t => selectedIds.value.has(t.id))
)

const someFilteredSelected = computed(() =>
  filteredTransactions.value.some(t => selectedIds.value.has(t.id)) && !allFilteredSelected.value
)

const selectedCount = computed(() =>
  filteredTransactions.value.filter(t => selectedIds.value.has(t.id)).length
)

function toggleSelectAll(): void {
  if (allFilteredSelected.value) {
    const next = new Set(selectedIds.value)
    filteredTransactions.value.forEach(t => next.delete(t.id))
    selectedIds.value = next
  } else {
    const next = new Set(selectedIds.value)
    filteredTransactions.value.forEach(t => next.add(t.id))
    selectedIds.value = next
  }
}

function clearSelection(): void {
  selectedIds.value = new Set()
}

function deleteSelected(): void {
  const n = selectedCount.value
  if (!confirm(`Permanently delete ${n} transaction${n !== 1 ? 's' : ''}? This cannot be undone.`)) return
  const ids = new Set(filteredTransactions.value.filter(t => selectedIds.value.has(t.id)).map(t => t.id))
  for (const id of ids) store.deleteTransaction(id)
  clearSelection()
}

// ── Bulk actions ───────────────────────────────────────────────
const bulkItemIdStr    = ref('')
const bulkAccountIdStr = ref('')

function applyBulkItem(): void {
  const itemId = bulkItemIdStr.value !== '' ? parseInt(bulkItemIdStr.value) : null
  const targets = filteredTransactions.value.filter(t => selectedIds.value.has(t.id))
  for (const tx of targets) {
    store.updateTransaction(tx.id, { name: tx.name, date: tx.date, type: tx.type, amount: tx.amount, itemId, accountId: tx.accountId })
  }
  bulkItemIdStr.value = ''
  bulkAccountIdStr.value = ''
}

function applyBulkAccount(): void {
  const accountId = bulkAccountIdStr.value !== '' ? bulkAccountIdStr.value : null
  const targets = filteredTransactions.value.filter(t => selectedIds.value.has(t.id))
  for (const tx of targets) {
    store.updateTransaction(tx.id, { name: tx.name, date: tx.date, type: tx.type, amount: tx.amount, itemId: tx.itemId, accountId })
  }
  bulkItemIdStr.value = ''
  bulkAccountIdStr.value = ''
}

</script>

<template>
  <div class="tx-log">
    <div class="tx-log-container">

      <!-- Summary bar -->
      <div class="tx-summary">
        <span class="tx-summary-item">
          <span class="tx-summary-label">Total In</span>
          <span class="money-positive">{{ formatMoney(totalIn) }}</span>
        </span>
        <span class="tx-summary-item">
          <span class="tx-summary-label">Total Out</span>
          <span class="money-negative">{{ formatMoney(totalOut) }}</span>
        </span>
        <span class="tx-summary-item">
          <span class="tx-summary-label">Net</span>
          <span :class="net >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(net) }}</span>
        </span>
        <span class="tx-summary-divider" />
        <span class="tx-summary-item" v-if="txMin !== null">
          <span class="tx-summary-label">Min</span>
          <span class="tx-summary-value">{{ formatMoney(txMin) }}</span>
        </span>
        <span class="tx-summary-item" v-if="txMax !== null">
          <span class="tx-summary-label">Max</span>
          <span class="tx-summary-value">{{ formatMoney(txMax) }}</span>
        </span>
        <span class="tx-summary-item" v-if="txAvg !== null">
          <span class="tx-summary-label">Avg</span>
          <span class="tx-summary-value">{{ formatMoney(txAvg) }}</span>
        </span>
        <span class="tx-summary-count">{{ totalCount }} result{{ totalCount !== 1 ? 's' : '' }}</span>
      </div>

      <!-- Filter bar -->
      <div class="tx-filter-bar">
        <div class="tx-filter-group">
          <label class="tx-filter-label">Search</label>
          <div class="tx-filter-search-wrap">
            <i class="pi pi-search tx-filter-search-icon" />
            <input
              type="search"
              v-model="filterSearch"
              class="tx-filter-field"
              placeholder="Name / description…"
            />
          </div>
        </div>

        <div class="tx-filter-group">
          <label class="tx-filter-label">Year</label>
          <select v-model="filterYear" class="tx-filter-field tx-filter-select">
            <option value="">All years</option>
            <option v-for="y in availableYears" :key="y" :value="y">{{ y }}</option>
          </select>
        </div>

        <div class="tx-filter-group">
          <label class="tx-filter-label">Month</label>
          <select v-model="filterMonthNum" class="tx-filter-field tx-filter-select">
            <option value="">All months</option>
            <option v-for="(name, i) in MONTH_NAMES" :key="i + 1" :value="String(i + 1)">{{ name }}</option>
          </select>
        </div>

        <div class="tx-filter-group">
          <label class="tx-filter-label">Type</label>
          <div class="toggle-group">
            <button :class="['toggle-btn', filterType === 'all' && 'toggle-btn-active']" @click="filterType = 'all'">All</button>
            <button :class="['toggle-btn', filterType === 'in'  && 'toggle-btn-active']" @click="filterType = 'in'">
              <i class="pi pi-arrow-up-right text-xs" /> In
            </button>
            <button :class="['toggle-btn', filterType === 'out' && 'toggle-btn-active']" @click="filterType = 'out'">
              <i class="pi pi-arrow-down-left text-xs" /> Out
            </button>
          </div>
        </div>

        <div class="tx-filter-group tx-filter-group-grow">
          <label class="tx-filter-label">Budget Item</label>
          <select v-model="filterItemId" class="tx-filter-field tx-filter-select">
            <option :value="null">All items</option>
            <option :value="-1">— Unassigned —</option>
            <option v-for="item in budgetItemsSorted" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
          </select>
        </div>

        <div class="tx-filter-group tx-filter-group-grow">
          <label class="tx-filter-label">Account</label>
          <select v-model="filterAccountId" class="tx-filter-field tx-filter-select">
            <option :value="null">All accounts</option>
            <option v-for="acc in accountStore.accounts" :key="acc.id" :value="acc.id">
              {{ acc.name }}
            </option>
          </select>
        </div>

        <div class="tx-filter-clear-wrap">
          <button v-if="hasActiveFilters" class="tx-clear-btn" @click="clearFilters">
            <i class="pi pi-times" /> Clear
          </button>
        </div>
      </div>

      <!-- Bulk action bar -->
      <div v-if="selectedCount > 0" class="tx-bulk-bar">
        <span class="tx-bulk-count">{{ selectedCount }} selected</span>
        <div class="tx-bulk-action">
          <label class="tx-bulk-label">Set Item</label>
          <select v-model="bulkItemIdStr" class="tx-select tx-bulk-select">
            <option value="">— None —</option>
            <option v-for="item in budgetItemsSorted" :key="item.id" :value="String(item.id)">
              {{ item.name }}
            </option>
          </select>
          <button class="tx-bulk-apply-btn" @click="applyBulkItem">Set Item</button>
        </div>
        <div class="tx-bulk-action">
          <label class="tx-bulk-label">Set Account</label>
          <select v-model="bulkAccountIdStr" class="tx-select tx-bulk-select">
            <option value="">— None —</option>
            <option v-for="acc in accountStore.accounts" :key="acc.id" :value="acc.id">
              {{ acc.name }}
            </option>
          </select>
          <button class="tx-bulk-apply-btn" @click="applyBulkAccount">Set Account</button>
        </div>
        <button class="tx-bulk-delete-btn" @click="deleteSelected">
          <i class="pi pi-trash" /> Delete selected
        </button>
        <button class="tx-bulk-clear-btn" @click="clearSelection">
          <i class="pi pi-times" /> Deselect all
        </button>
      </div>

      <!-- Table -->
      <div
        class="tx-table-scroll"
        :class="{ 'tx-drag-over': isDraggingOver }"
        @dragenter="onDragEnter"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
      >
        <div v-if="isDraggingOver" class="tx-drop-overlay">
          <i class="pi pi-upload" />
          <span>Drop CSV to import transactions</span>
        </div>
        <table class="tx-table">
          <thead>
            <tr>
              <!-- Select all -->
              <th class="tx-col-check" @click.stop>
                <input
                  type="checkbox"
                  class="tx-checkbox"
                  :checked="allFilteredSelected"
                  :indeterminate="someFilteredSelected"
                  @change.stop="toggleSelectAll"
                />
              </th>

              <!-- Date -->
              <th class="tx-col-date th-sortable" @click="toggleSort('date')">
                <div class="th-label">Date <i :class="sortIcon('date')" class="tx-sort-icon" /></div>
              </th>

              <!-- Name -->
              <th class="th-sortable" @click="toggleSort('name')">
                <div class="th-label">Name / Description <i :class="sortIcon('name')" class="tx-sort-icon" /></div>
              </th>

              <!-- In -->
              <th class="tx-col-money th-sortable" @click="toggleSort('amountIn')">
                <div class="th-label">In <i :class="sortIcon('amountIn')" class="tx-sort-icon" /></div>
              </th>

              <!-- Out -->
              <th class="tx-col-money th-sortable" @click="toggleSort('amountOut')">
                <div class="th-label">Out <i :class="sortIcon('amountOut')" class="tx-sort-icon" /></div>
              </th>

              <!-- Item -->
              <th class="tx-col-item th-sortable" @click="toggleSort('item')">
                <div class="th-label">Item <i :class="sortIcon('item')" class="tx-sort-icon" /></div>
              </th>

              <!-- Account -->
              <th class="tx-col-account th-sortable" @click="toggleSort('account')">
                <div class="th-label">Account <i :class="sortIcon('account')" class="tx-sort-icon" /></div>
              </th>

              <!-- Added -->
              <th class="tx-col-added th-sortable" @click="toggleSort('added')">
                <div class="th-label">Added <i :class="sortIcon('added')" class="tx-sort-icon" /></div>
              </th>

              <th class="tx-col-action"></th>
            </tr>
          </thead>
          <tbody>

            <!-- Transaction rows -->
            <template v-for="tx in pagedTransactions" :key="tx.id">

              <!-- Editing row -->
              <tr
                v-if="tx.id === editingId && editDraft"
                :ref="(el) => { if (tx.id === editingId) editRowRef = el as HTMLElement | null }"
                class="tx-pending-row"
                @focusout="onEditFocusOut"
                @keydown.escape.prevent="cancelEdit"
              >
                <td class="tx-col-check"></td>
                <td>
                  <input type="date" v-model="editDraft.date" class="tx-input"
                    @keydown.enter.prevent="commitEdit" />
                </td>
                <td>
                  <input type="text" v-model="editDraft.name" class="tx-input"
                    @keydown.enter.prevent="commitEdit" />
                </td>
                <td class="tx-col-money">
                  <input
                    v-if="editDraft.type === 'in'"
                    type="text" inputmode="decimal"
                    v-model="editDraft.amount"
                    class="tx-input tx-money-input tx-in-input"
                    @focus="moneyFocus"
                    @blur="moneyBlur"
                    @keydown.enter.prevent="commitEdit"
                  />
                  <button v-else tabindex="0" class="tx-switch-btn" @click="switchEditType('in')">↑ In</button>
                </td>
                <td class="tx-col-money">
                  <input
                    v-if="editDraft.type === 'out'"
                    type="text" inputmode="decimal"
                    v-model="editDraft.amount"
                    class="tx-input tx-money-input tx-out-input"
                    @focus="moneyFocus"
                    @blur="moneyBlur"
                    @keydown.enter.prevent="commitEdit"
                  />
                  <button v-else tabindex="0" class="tx-switch-btn" @click="switchEditType('out')">↓ Out</button>
                </td>
                <td class="tx-col-item">
                  <select v-model="editDraft.itemIdStr" class="tx-select">
                    <option value="">None</option>
                    <option v-for="item in budgetItemsSorted" :key="item.id" :value="String(item.id)">
                      {{ item.name }}
                    </option>
                  </select>
                </td>
                <td class="tx-col-account">
                  <select v-model="editDraft.accountIdStr" class="tx-select">
                    <option value="">None</option>
                    <option v-for="acc in accountStore.accounts" :key="acc.id" :value="acc.id">
                      {{ acc.name }}
                    </option>
                  </select>
                </td>
                <td class="tx-created-at">{{ formatCreatedAt(tx.createdAt) }}</td>
                <td class="tx-col-action">
                  <button class="tx-delete-btn" title="Delete" @click.stop="store.deleteTransaction(tx.id); cancelEdit()">
                    <i class="pi pi-times" />
                  </button>
                </td>
              </tr>

              <!-- Display row -->
              <tr
                v-else
                class="tx-row tx-row-clickable"
                :class="{ 'tx-row-selected': isSelected(tx.id) }"
                @click="startEdit(tx)"
              >
                <td class="tx-col-check" @click.stop="toggleSelected(tx.id)">
                  <input
                    type="checkbox"
                    class="tx-checkbox"
                    :checked="isSelected(tx.id)"
                    @click.stop
                  />
                </td>
                <td>{{ formatDate(tx.date) }}</td>
                <td>{{ tx.name }}</td>
                <td class="tx-col-money money-positive">{{ tx.type === 'in'  ? formatMoney(tx.amount) : '' }}</td>
                <td class="tx-col-money money-negative">{{ tx.type === 'out' ? formatMoney(tx.amount) : '' }}</td>
                <td class="tx-col-item">{{ getItemName(tx.itemId) }}</td>
                <td class="tx-col-account">{{ getAccountName(tx.accountId) }}</td>
                <td class="tx-created-at">{{ formatCreatedAt(tx.createdAt) }}</td>
                <td class="tx-col-action">
                  <button class="tx-delete-btn" title="Delete" @click.stop="store.deleteTransaction(tx.id)">
                    <i class="pi pi-times" />
                  </button>
                </td>
              </tr>

            </template>

            <!-- Empty state -->
            <tr v-if="!pagedTransactions.length && !pending">
              <td colspan="9" class="tx-empty">
                <span v-if="hasActiveFilters">No transactions match the current filters.</span>
                <span v-else>No transactions yet. Click + Add Transaction below to get started.</span>
              </td>
            </tr>

            <!-- Pending new row -->
            <tr
              v-if="pending"
              ref="pendingRowRef"
              class="tx-pending-row"
              @focusout="onPendingFocusOut"
              @keydown.escape.prevent="cancelTransaction"
            >
              <td class="tx-col-check"></td>
              <td>
                <input type="date" v-model="pending.date" class="tx-input"
                  @keydown.enter.prevent="commitTransaction" />
              </td>
              <td>
                <input
                  ref="nameInputRef"
                  type="text"
                  v-model="pending.name"
                  class="tx-input"
                  placeholder="Description…"
                  @keydown.enter.prevent="commitTransaction"
                />
              </td>
              <!-- In column: amount input when type=in, switch button otherwise -->
              <td class="tx-col-money">
                <input
                  v-if="pending.type === 'in'"
                  type="text" inputmode="decimal"
                  v-model="pending.amount"
                  class="tx-input tx-money-input tx-in-input"
                  placeholder="0.00"
                  @focus="moneyFocus"
                  @blur="moneyBlur"
                  @keydown.enter.prevent="commitTransaction"
                />
                <button v-else tabindex="0" class="tx-switch-btn" @click="switchType('in')">↑ In</button>
              </td>
              <!-- Out column: amount input when type=out, switch button otherwise -->
              <td class="tx-col-money">
                <input
                  v-if="pending.type === 'out'"
                  type="text" inputmode="decimal"
                  v-model="pending.amount"
                  class="tx-input tx-money-input tx-out-input"
                  placeholder="0.00"
                  @focus="moneyFocus"
                  @blur="moneyBlur"
                  @keydown.enter.prevent="commitTransaction"
                />
                <button v-else tabindex="0" class="tx-switch-btn" @click="switchType('out')">↓ Out</button>
              </td>
              <td class="tx-col-item">
                <select v-model="pending.itemIdStr" class="tx-select">
                  <option value="">None</option>
                  <optgroup v-for="cat in budgetItemCategories" :key="cat" :label="cat">
                    <option v-for="item in (budgetItemsByCategory.get(cat) ?? [])" :key="item.id" :value="String(item.id)">
                      {{ item.name }}
                    </option>
                  </optgroup>
                </select>
              </td>
              <td class="tx-col-account">
                <select v-model="pending.accountIdStr" class="tx-select">
                  <option value="">None</option>
                  <option v-for="acc in accountStore.accounts" :key="acc.id" :value="acc.id">
                    {{ acc.name }}
                  </option>
                </select>
              </td>
              <td class="tx-created-at">—</td>
              <td class="tx-col-action"></td>
            </tr>

          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div class="tx-pagination">
        <div class="tx-page-size-wrap">
          <span class="tx-pagination-label">Show</span>
          <select v-model="pageSize" class="tx-page-size-select">
            <option v-for="s in PAGE_SIZES" :key="s" :value="s">{{ s }}</option>
          </select>
          <span class="tx-pagination-label">per page</span>
        </div>
        <div class="tx-page-nav">
          <button class="tx-page-btn" :disabled="page === 1" @click="page--">
            <i class="pi pi-chevron-left" />
          </button>
          <span class="tx-page-info">{{ page }} / {{ totalPages }}</span>
          <button class="tx-page-btn" :disabled="page >= totalPages" @click="page++">
            <i class="pi pi-chevron-right" />
          </button>
        </div>
      </div>

      <!-- Footer -->
      <div class="tx-footer">
        <button class="add-item-btn" :disabled="!!pending || editingId !== null" @click="startTransaction">
          <i class="pi pi-plus" /> Add Transaction
        </button>
        <span class="tx-csv-hint"><i class="pi pi-upload" /> Drop a CSV file onto the table to import</span>
        <span v-if="csvImportMsg" class="tx-csv-msg" :class="csvImportCount > 0 ? 'tx-csv-msg-ok' : 'tx-csv-msg-warn'">
          {{ csvImportMsg }}
        </span>
      </div>

    </div>
  </div>

  <!-- CSV Import Dialog -->
  <CsvImportDialog
    :visible="csvDialogVisible"
    :csvText="pendingCsvText"
    @close="csvDialogVisible = false"
    @done="onCsvDone"
  />
</template>
