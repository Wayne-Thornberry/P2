<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import type { Transaction } from '../types/transaction'
import { useTransactionStore } from '../stores/transactionStore'
import { useAccountStore } from '../stores/accountStore'
import { useBudgetStore } from '../stores/budgetStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useMoneyInput } from '../composables/useMoneyInput'
import { getTodayStr } from '../utils/date'
import { useImportHistoryStore } from '../stores/importHistoryStore'
import { useConfirm } from '../composables/useConfirm'

const props = defineProps<{ monthFilter?: string; accountFilter?: string; itemFilter?: number; nameFilter?: string; typeFilter?: 'all' | 'in' | 'out'; focusSearch?: boolean }>()

const store        = useTransactionStore()
const accountStore = useAccountStore()
const budgetStore  = useBudgetStore()
const settings     = useSettingsStore()
const historyStore = useImportHistoryStore()
const { confirm }  = useConfirm()

// ── Balance cutoff pin ─────────────────────────────────────────
const cutoffTxId = computed(() => settings.balanceCutoffTxId)

function setPinTx(id: number): void {
  settings.balanceCutoffTxId = settings.balanceCutoffTxId === id ? null : id
}

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

const filterSearch       = ref(props.nameFilter ?? '')
const searchInputRef     = ref<HTMLInputElement | null>(null)
const filterYear         = ref(_parseMonthFilter(props.monthFilter).year)
const filterMonthNum     = ref(_parseMonthFilter(props.monthFilter).month)
const filterType         = ref<'all' | 'in' | 'out'>(props.typeFilter ?? 'all')
const filterAccountId    = ref<string | null>(props.accountFilter ?? null)
const filterItemId       = ref<number | null>(props.itemFilter ?? null)
const filterAmountMinStr = ref('')
const filterAmountMaxStr = ref('')
const filterDateFrom     = ref('')
const filterDateTo       = ref('')

watch(() => props.accountFilter, v => { filterAccountId.value = v ?? null })
watch(() => props.itemFilter,    v => { filterItemId.value    = v ?? null })
watch(() => props.typeFilter,    v => { filterType.value      = v ?? 'all' })
watch(() => props.monthFilter,   v => {
  const p = _parseMonthFilter(v)
  filterYear.value     = p.year
  filterMonthNum.value = p.month
})
watch(() => props.nameFilter, v => { filterSearch.value = v ?? '' })
watch(() => props.focusSearch, (v) => { if (v) nextTick(() => searchInputRef.value?.focus()) })
onMounted(() => { if (props.focusSearch) nextTick(() => searchInputRef.value?.focus()) })

// ── Column resize ───────────────────────────────────────────
// px widths; null = use CSS default (column not yet resized)
const colWidths = ref<Record<string, number | null>>({
  check: null, date: null, name: null, in: null, out: null,
  balance: null, item: null, account: null, notes: null, added: null, action: null,
})

function startColResize(colKey: string, e: MouseEvent): void {
  e.preventDefault()
  e.stopPropagation()
  const startX   = e.clientX
  const thEl     = (e.target as HTMLElement).closest('th')!
  const startW   = thEl.getBoundingClientRect().width

  function onMove(ev: MouseEvent): void {
    const newW = Math.max(40, startW + ev.clientX - startX)
    colWidths.value = { ...colWidths.value, [colKey]: newW }
  }
  function onUp(): void {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function colStyle(colKey: string): string {
  const w = colWidths.value[colKey]
  return w !== null ? `width:${w}px` : ''
}

const hasActiveFilters = computed(() =>
  filterSearch.value !== '' || filterYear.value !== '' || filterMonthNum.value !== '' ||
  filterType.value !== 'all' || filterAccountId.value !== null || filterItemId.value !== null ||
  filterAmountMinStr.value !== '' || filterAmountMaxStr.value !== '' ||
  filterDateFrom.value !== '' || filterDateTo.value !== ''
)

function clearFilters(): void {
  filterSearch.value       = ''
  filterYear.value         = ''
  filterMonthNum.value     = ''
  filterType.value         = 'all'
  filterAccountId.value    = null
  filterItemId.value       = null
  filterAmountMinStr.value = ''
  filterAmountMaxStr.value = ''
  filterDateFrom.value     = ''
  filterDateTo.value       = ''
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
const pageJumpStr = ref('')

const visiblePageNumbers = computed<number[]>(() => {
  const total = totalPages.value
  const cur   = page.value
  const delta = 3
  const start = Math.max(1, cur - delta)
  const end   = Math.min(total, cur + delta)
  const pages: number[] = []
  for (let i = start; i <= end; i++) pages.push(i)
  return pages
})

function goToPage(n: number): void {
  page.value = Math.min(totalPages.value, Math.max(1, n))
}

function handlePageJump(): void {
  const n = parseInt(pageJumpStr.value, 10)
  if (!isNaN(n)) goToPage(n)
  pageJumpStr.value = ''
}

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
    list = list.filter(t => t.name.toLowerCase().includes(q) || (t.notes ?? '').toLowerCase().includes(q))
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
  const amtMin = filterAmountMinStr.value !== '' ? parseFloat(filterAmountMinStr.value) : null
  const amtMax = filterAmountMaxStr.value !== '' ? parseFloat(filterAmountMaxStr.value) : null
  if (amtMin !== null && !isNaN(amtMin)) list = list.filter(t => t.amount >= amtMin - 0.005)
  if (amtMax !== null && !isNaN(amtMax)) list = list.filter(t => t.amount <= amtMax + 0.005)
  if (filterDateFrom.value) list = list.filter(t => t.date >= filterDateFrom.value)
  if (filterDateTo.value)   list = list.filter(t => t.date <= filterDateTo.value)
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

const totalCount = computed(() => filteredTransactions.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(filteredTransactions.value.length / pageSize.value)))
const pagedTransactions = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filteredTransactions.value.slice(start, start + pageSize.value)
})

watch([filterSearch, filterYear, filterMonthNum, filterType, filterAccountId, filterItemId, filterAmountMinStr, filterAmountMaxStr, filterDateFrom, filterDateTo, pageSize, sortCol, sortDir], () => { page.value = 1 })

// ── Running balance per transaction ─────────────────────────
// Computed from the filtered set, chronological oldest→newest.
// Maps transaction id → running balance at that point in time.
// When a cutoff pin is set, only transactions on/after the pinned tx's date
// are included in the balance accumulation; earlier rows get no map entry.
const runningBalanceMap = computed<Map<number, number>>(() => {
  const pinId    = cutoffTxId.value
  let cutoffDate: string | null = null
  if (pinId !== null) {
    const pinTx = store.transactions.find(t => t.id === pinId)
    cutoffDate = pinTx?.date ?? null
  }

  // Compute running balance per account independently so mixing accounts in
  // "All accounts" view doesn't corrupt each account's balance column.
  const byAccount = new Map<string | null, (typeof filteredTransactions.value[0])[]>()
  for (const tx of filteredTransactions.value) {
    // Exclude transactions before the cutoff from balance calculation
    if (cutoffDate && tx.date < cutoffDate) continue
    if (!byAccount.has(tx.accountId)) byAccount.set(tx.accountId, [])
    byAccount.get(tx.accountId)!.push(tx)
  }

  const map = new Map<number, number>()

  for (const txs of byAccount.values()) {
    // Chronological oldest-first within this account
    const chronological = [...txs].sort((a, b) => {
      const dc = a.date.localeCompare(b.date)
      return dc !== 0 ? dc : a.createdAt.localeCompare(b.createdAt)
    })
    // Group by date so all same-day rows show end-of-day balance
    const dayGroups = new Map<string, typeof chronological>()
    for (const tx of chronological) {
      if (!dayGroups.has(tx.date)) dayGroups.set(tx.date, [])
      dayGroups.get(tx.date)!.push(tx)
    }
    let running = 0
    for (const dayTxs of dayGroups.values()) {
      for (const tx of dayTxs) {
        running = Math.round((running + (tx.type === 'in' ? tx.amount : -tx.amount)) * 100) / 100
      }
      for (const tx of dayTxs) {
        map.set(tx.id, running)
      }
    }
  }

  return map
})

// ── All-filtered stats ──────────────────────────────────────
const allInTxs  = computed(() => filteredTransactions.value.filter(t => t.type === 'in'))
const allOutTxs = computed(() => filteredTransactions.value.filter(t => t.type === 'out'))
const allIn     = computed(() => allInTxs.value.reduce((s, t) => s + t.amount, 0))
const allOut    = computed(() => allOutTxs.value.reduce((s, t) => s + t.amount, 0))
const allNet    = computed(() => allIn.value - allOut.value)
const allMaxIn  = computed<number | null>(() => allInTxs.value.length  ? Math.max(...allInTxs.value.map(t => t.amount))  : null)
const allMinIn  = computed<number | null>(() => allInTxs.value.length  ? Math.min(...allInTxs.value.map(t => t.amount))  : null)
const allMaxOut = computed<number | null>(() => allOutTxs.value.length ? Math.max(...allOutTxs.value.map(t => t.amount)) : null)
const allMinOut = computed<number | null>(() => allOutTxs.value.length ? Math.min(...allOutTxs.value.map(t => t.amount)) : null)
const allAvg    = computed<number | null>(() => filteredTransactions.value.length ? filteredTransactions.value.reduce((s, t) => s + t.amount, 0) / filteredTransactions.value.length : null)

// ── Page-scoped stats ─────────────────────────────────────────
const pageInTxs  = computed(() => pagedTransactions.value.filter(t => t.type === 'in'))
const pageOutTxs = computed(() => pagedTransactions.value.filter(t => t.type === 'out'))
const pageIn     = computed(() => pageInTxs.value.reduce((s, t) => s + t.amount, 0))
const pageOut    = computed(() => pageOutTxs.value.reduce((s, t) => s + t.amount, 0))
const pageNet    = computed(() => pageIn.value - pageOut.value)
const pageMaxIn  = computed<number | null>(() => pageInTxs.value.length  ? Math.max(...pageInTxs.value.map(t => t.amount))  : null)
const pageMinIn  = computed<number | null>(() => pageInTxs.value.length  ? Math.min(...pageInTxs.value.map(t => t.amount))  : null)
const pageMaxOut = computed<number | null>(() => pageOutTxs.value.length ? Math.max(...pageOutTxs.value.map(t => t.amount)) : null)
const pageMinOut = computed<number | null>(() => pageOutTxs.value.length ? Math.min(...pageOutTxs.value.map(t => t.amount)) : null)
const pageAvg    = computed<number | null>(() => pagedTransactions.value.length ? pagedTransactions.value.reduce((s, t) => s + t.amount, 0) / pagedTransactions.value.length : null)

// ── Shared draft type ─────────────────────────────────────────
type RowDraft = {
  name: string
  date: string
  type: 'in' | 'out'
  amount: string
  itemIdStr: string
  accountIdStr: string
  notes: string
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
    itemId:    d.itemIdStr    !== '' ? parseInt(d.itemIdStr, 10)    : null,
    accountId: d.accountIdStr !== '' ? d.accountIdStr : null,
    notes:     d.notes.trim() || undefined,
  }
}

// ── Pending (new) transaction ──────────────────────────────────
const pending       = ref<RowDraft | null>(null)
const pendingRowRef = ref<HTMLElement | null>(null)
const nameInputRef  = ref<HTMLInputElement | null>(null)

async function startTransaction(): Promise<void> {
  cancelEdit()
  pending.value = { name: '', date: getTodayStr(), type: 'out', amount: '', itemIdStr: '', accountIdStr: '', notes: '' }
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
    notes:        tx.notes ?? '',
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

// ── Export to CSV ─────────────────────────────────────────
function escapeCsv(v: string | number | undefined | null): string {
  const s = String(v ?? '')
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
}

function exportCsv(): void {
  const rows = selectedCount.value > 0
    ? filteredTransactions.value.filter(t => selectedIds.value.has(t.id))
    : filteredTransactions.value

  const header = ['Date', 'Description', 'Type', 'In', 'Out', 'Item', 'Account', 'Notes', 'Added']
  const lines  = rows.map(t => [
    t.date,
    escapeCsv(t.name),
    t.type,
    t.type === 'in'  ? t.amount : '',
    t.type === 'out' ? t.amount : '',
    escapeCsv(getItemName(t.itemId)),
    escapeCsv(getAccountName(t.accountId)),
    escapeCsv(t.notes),
    t.createdAt,
  ].join(','))

  const csv  = [header.join(','), ...lines].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
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

// All filtered selected (used for "select all" banner)
const allFilteredSelected = computed(() =>
  filteredTransactions.value.length > 0 &&
  filteredTransactions.value.every(t => selectedIds.value.has(t.id))
)

// Page-scoped selection state (drives header checkbox)
const allPageSelected = computed(() =>
  pagedTransactions.value.length > 0 &&
  pagedTransactions.value.every(t => selectedIds.value.has(t.id))
)

const somePageSelected = computed(() =>
  pagedTransactions.value.some(t => selectedIds.value.has(t.id)) && !allPageSelected.value
)

const selectedCount = computed(() =>
  filteredTransactions.value.filter(t => selectedIds.value.has(t.id)).length
)

// ── Selection-scoped stats ────────────────────────────────────
const selectedTransactions = computed(() => filteredTransactions.value.filter(t => selectedIds.value.has(t.id)))
const selIn  = computed(() => selectedTransactions.value.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0))
const selOut = computed(() => selectedTransactions.value.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0))
const selNet = computed(() => selIn.value - selOut.value)
const selInTxs   = computed(() => selectedTransactions.value.filter(t => t.type === 'in'))
const selOutTxs  = computed(() => selectedTransactions.value.filter(t => t.type === 'out'))
const selMaxIn   = computed<number | null>(() => selInTxs.value.length  ? Math.max(...selInTxs.value.map(t => t.amount))  : null)
const selMinIn   = computed<number | null>(() => selInTxs.value.length  ? Math.min(...selInTxs.value.map(t => t.amount))  : null)
const selMaxOut  = computed<number | null>(() => selOutTxs.value.length ? Math.max(...selOutTxs.value.map(t => t.amount)) : null)
const selMinOut  = computed<number | null>(() => selOutTxs.value.length ? Math.min(...selOutTxs.value.map(t => t.amount)) : null)
const selAvg     = computed<number | null>(() => selectedTransactions.value.length ? selectedTransactions.value.reduce((s, t) => s + t.amount, 0) / selectedTransactions.value.length : null)

// ── Display stats (selection row: selection > page) ───────────
const displayIn     = computed(() => selectedCount.value > 0 ? selIn.value    : pageIn.value)
const displayOut    = computed(() => selectedCount.value > 0 ? selOut.value   : pageOut.value)
const displayNet    = computed(() => selectedCount.value > 0 ? selNet.value   : pageNet.value)
const displayAvg    = computed<number | null>(() => selectedCount.value > 0 ? selAvg.value    : pageAvg.value)

// Filter to exact amount (called from summary bar stat clicks)
function filterByAmount(v: number): void {
  const s = String(Math.round(v * 100) / 100)
  filterAmountMinStr.value = s
  filterAmountMaxStr.value = s
}

// Toggle selection: deselect ALL when anything is selected, otherwise select current page
function toggleSelectPage(): void {
  if (selectedCount.value > 0) {
    selectedIds.value = new Set()
  } else {
    const next = new Set(selectedIds.value)
    pagedTransactions.value.forEach(t => next.add(t.id))
    selectedIds.value = next
  }
}

// Select every transaction matching the current filters
function selectAllFiltered(): void {
  const next = new Set(selectedIds.value)
  filteredTransactions.value.forEach(t => next.add(t.id))
  selectedIds.value = next
}

function clearSelection(): void {
  selectedIds.value = new Set()
}

async function deleteSelected(): Promise<void> {
  const n = selectedCount.value
  const ok = await confirm({
    title: 'Delete transactions?',
    message: `Permanently delete ${n} transaction${n !== 1 ? 's' : ''}? This cannot be undone.`,
    confirmLabel: 'Delete',
    danger: true,
  })
  if (!ok) return
  const ids = new Set(filteredTransactions.value.filter(t => selectedIds.value.has(t.id)).map(t => t.id))
  for (const id of ids) store.deleteTransaction(id)
  clearSelection()
}

async function confirmDeleteTx(id: number, cancelEditAfter: boolean): Promise<void> {
  const ok = await confirm({
    title: 'Delete transaction?',
    message: 'Permanently delete this transaction? This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
  })
  if (!ok) return
  store.deleteTransaction(id)
  if (cancelEditAfter) cancelEdit()
}

// ── Bulk actions ───────────────────────────────────────────────
const bulkItemIdStr    = ref('')
const bulkAccountIdStr = ref('')

function applyBulkItem(): void {
  const itemId = bulkItemIdStr.value !== '' ? parseInt(bulkItemIdStr.value, 10) : null
  const targets = filteredTransactions.value.filter(t => selectedIds.value.has(t.id))
  for (const tx of targets) {
    store.updateTransaction(tx.id, { name: tx.name, date: tx.date, type: tx.type, amount: tx.amount, itemId, accountId: tx.accountId, notes: tx.notes })
  }
  bulkItemIdStr.value = ''
  bulkAccountIdStr.value = ''
}

function applyBulkAccount(): void {
  const accountId = bulkAccountIdStr.value !== '' ? bulkAccountIdStr.value : null
  const targets = filteredTransactions.value.filter(t => selectedIds.value.has(t.id))
  for (const tx of targets) {
    store.updateTransaction(tx.id, { name: tx.name, date: tx.date, type: tx.type, amount: tx.amount, itemId: tx.itemId, accountId, notes: tx.notes })
  }
  bulkItemIdStr.value = ''
  bulkAccountIdStr.value = ''
}

// ── Import history ──────────────────────────────────────────────
const historyExpanded = ref(false)

</script>

<template>
  <div class="tx-log">
    <div class="tx-log-container">

      <!-- Summary bar -->
      <div class="tx-summary">

        <!-- Row 1: All filtered transactions -->
        <div class="tx-summary-row">
          <span class="tx-summary-scope tx-summary-scope--all">All</span>
          <span class="tx-summary-item">
            <span class="tx-summary-label">In</span>
            <button class="tx-summary-stat-btn money-positive" :class="{ 'tx-summary-stat-btn--active': filterType === 'in' }" @click="filterType = filterType === 'in' ? 'all' : 'in'" title="Filter to In transactions">{{ formatMoney(allIn) }}</button>
          </span>
          <span class="tx-summary-item">
            <span class="tx-summary-label">Out</span>
            <button class="tx-summary-stat-btn money-negative" :class="{ 'tx-summary-stat-btn--active': filterType === 'out' }" @click="filterType = filterType === 'out' ? 'all' : 'out'" title="Filter to Out transactions">{{ formatMoney(allOut) }}</button>
          </span>
          <span class="tx-summary-item">
            <span class="tx-summary-label">Net</span>
            <span :class="allNet >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(allNet) }}</span>
          </span>
          <span class="tx-summary-divider" />
          <span class="tx-summary-item" v-if="allMaxIn !== null">
            <span class="tx-summary-label">Max In</span>
            <button class="tx-summary-stat-btn money-positive" @click="filterByAmount(allMaxIn!)" title="Filter to this amount">{{ formatMoney(allMaxIn) }}</button>
          </span>
          <span class="tx-summary-item" v-if="allMinIn !== null">
            <span class="tx-summary-label">Min In</span>
            <button class="tx-summary-stat-btn money-positive" @click="filterByAmount(allMinIn!)" title="Filter to this amount">{{ formatMoney(allMinIn) }}</button>
          </span>
          <span class="tx-summary-divider" v-if="allMaxOut !== null || allMinOut !== null" />
          <span class="tx-summary-item" v-if="allMaxOut !== null">
            <span class="tx-summary-label">Max Out</span>
            <button class="tx-summary-stat-btn money-negative" @click="filterByAmount(allMaxOut!)" title="Filter to this amount">{{ formatMoney(allMaxOut) }}</button>
          </span>
          <span class="tx-summary-item" v-if="allMinOut !== null">
            <span class="tx-summary-label">Min Out</span>
            <button class="tx-summary-stat-btn money-negative" @click="filterByAmount(allMinOut!)" title="Filter to this amount">{{ formatMoney(allMinOut) }}</button>
          </span>
          <span class="tx-summary-divider" v-if="allAvg !== null" />
          <span class="tx-summary-item" v-if="allAvg !== null">
            <span class="tx-summary-label">Avg</span>
            <span class="tx-summary-value">{{ formatMoney(allAvg) }}</span>
          </span>
          <span class="tx-summary-count">{{ totalCount }} total</span>
        </div>

      </div>

      <!-- Filter bar -->
      <div class="tx-filter-bar">
        <div class="tx-filter-group">
          <label class="tx-filter-label">Search</label>
          <div class="tx-filter-search-wrap">
            <i class="pi pi-search tx-filter-search-icon" />
            <input
              ref="searchInputRef"
              type="search"
              v-model="filterSearch"
              class="tx-filter-field"
              placeholder="Name, description, notes…"
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

        <div class="tx-filter-group">
          <label class="tx-filter-label">Date — From</label>
          <input type="date" v-model="filterDateFrom" class="tx-filter-field tx-filter-date" />
        </div>
        <div class="tx-filter-group">
          <label class="tx-filter-label">Date — To</label>
          <input type="date" v-model="filterDateTo" class="tx-filter-field tx-filter-date" />
        </div>

        <div class="tx-filter-group">
          <label class="tx-filter-label">Amount — Min</label>
          <input
            type="number"
            inputmode="decimal"
            min="0"
            step="0.01"
            v-model="filterAmountMinStr"
            class="tx-filter-field tx-filter-amount"
            placeholder="0.00"
          />
        </div>
        <div class="tx-filter-group">
          <label class="tx-filter-label">Amount — Max</label>
          <input
            type="number"
            inputmode="decimal"
            min="0"
            step="0.01"
            v-model="filterAmountMaxStr"
            class="tx-filter-field tx-filter-amount"
            placeholder="0.00"
          />
        </div>

        <div class="tx-filter-clear-wrap">
          <button v-if="hasActiveFilters" class="tx-clear-btn" @click="clearFilters">
            <i class="pi pi-times" /> Clear
          </button>
        </div>
      </div>

      <!-- Bulk action bar -->
      <div v-if="selectedCount > 0" class="tx-bulk-bar">

        <!-- Selection info -->
        <div class="tx-bulk-info">
          <span class="tx-bulk-count">{{ selectedCount }} selected</span>
          <button v-if="!allFilteredSelected" class="tx-bulk-select-all-link" @click="selectAllFiltered">
            Select all {{ totalCount }}
          </button>
          <span v-else class="tx-bulk-all-selected">All {{ totalCount }} selected</span>
        </div>

        <span class="tx-bulk-sep" />

        <!-- Selection stats -->
        <div class="tx-bulk-stats">
          <span class="tx-bulk-stat">
            <span class="tx-bulk-stat-label">In</span>
            <span class="money-positive">{{ formatMoney(displayIn) }}</span>
          </span>
          <span class="tx-bulk-stat">
            <span class="tx-bulk-stat-label">Out</span>
            <span class="money-negative">{{ formatMoney(displayOut) }}</span>
          </span>
          <span class="tx-bulk-stat">
            <span class="tx-bulk-stat-label">Net</span>
            <span :class="displayNet >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(displayNet) }}</span>
          </span>
          <span class="tx-bulk-stat" v-if="displayAvg !== null">
            <span class="tx-bulk-stat-label">Avg</span>
            <span>{{ formatMoney(displayAvg) }}</span>
          </span>
          <span class="tx-bulk-stat" v-if="selMaxIn !== null">
            <span class="tx-bulk-stat-label">Max In</span>
            <button class="tx-summary-stat-btn money-positive" @click="filterByAmount(selMaxIn!)" title="Filter to this amount">{{ formatMoney(selMaxIn) }}</button>
          </span>
          <span class="tx-bulk-stat" v-if="selMinIn !== null">
            <span class="tx-bulk-stat-label">Min In</span>
            <button class="tx-summary-stat-btn money-positive" @click="filterByAmount(selMinIn!)" title="Filter to this amount">{{ formatMoney(selMinIn) }}</button>
          </span>
          <span class="tx-bulk-stat" v-if="selMaxOut !== null">
            <span class="tx-bulk-stat-label">Max Out</span>
            <button class="tx-summary-stat-btn money-negative" @click="filterByAmount(selMaxOut!)" title="Filter to this amount">{{ formatMoney(selMaxOut) }}</button>
          </span>
          <span class="tx-bulk-stat" v-if="selMinOut !== null">
            <span class="tx-bulk-stat-label">Min Out</span>
            <button class="tx-summary-stat-btn money-negative" @click="filterByAmount(selMinOut!)" title="Filter to this amount">{{ formatMoney(selMinOut) }}</button>
          </span>
        </div>

        <span class="tx-bulk-sep" />

        <!-- Assign -->
        <div class="tx-bulk-assign-group">
          <div class="tx-bulk-assign-field">
            <label class="tx-bulk-assign-label">Item</label>
            <select v-model="bulkItemIdStr" class="tx-select tx-bulk-select">
              <option value="">— None —</option>
              <option v-for="item in budgetItemsSorted" :key="item.id" :value="String(item.id)">
                {{ item.name }}
              </option>
            </select>
            <button class="tx-bulk-apply-btn" @click="applyBulkItem">Apply</button>
          </div>
          <div class="tx-bulk-assign-field">
            <label class="tx-bulk-assign-label">Account</label>
            <select v-model="bulkAccountIdStr" class="tx-select tx-bulk-select">
              <option value="">— None —</option>
              <option v-for="acc in accountStore.accounts" :key="acc.id" :value="acc.id">
                {{ acc.name }}
              </option>
            </select>
            <button class="tx-bulk-apply-btn" @click="applyBulkAccount">Apply</button>
          </div>
        </div>

        <span class="tx-bulk-sep" />

        <!-- Actions -->
        <button class="tx-bulk-delete-btn" @click="deleteSelected">
          <i class="pi pi-trash" /> Delete
        </button>
        <button class="tx-bulk-clear-btn" @click="clearSelection">
          <i class="pi pi-times" /> Deselect
        </button>

      </div>

      <!-- Table -->
      <div
        class="tx-table-scroll"
      >
        <table class="tx-table">
          <colgroup>
            <col class="tx-col-markers" />
            <col :style="colStyle('check')" />
            <col :style="colStyle('date')" />
            <col :style="colStyle('name')" />
            <col :style="colStyle('in')" />
            <col :style="colStyle('out')" />
            <col :style="colStyle('balance')" />
            <col :style="colStyle('item')" />
            <col :style="colStyle('account')" />
            <col :style="colStyle('notes')" />
            <col :style="colStyle('added')" />
            <col :style="colStyle('action')" />
          </colgroup>
          <thead>
            <tr>
              <!-- Markers (pin / flag indicators) -->
              <th class="tx-col-markers"></th>

              <!-- Select page -->
              <th class="tx-col-check" @click.stop>
                <input
                  type="checkbox"
                  class="tx-checkbox"
                  :checked="allPageSelected"
                  :indeterminate="somePageSelected"
                  @change.stop="toggleSelectPage"
                />
              </th>

              <!-- Date -->
              <th class="tx-col-date th-sortable" @click="toggleSort('date')">
                <div class="th-label">Date <i :class="sortIcon('date')" class="tx-sort-icon" /></div>
                <div class="th-resize-handle" @mousedown.stop="startColResize('date', $event)" /></th>

              <!-- Name -->
              <th class="th-sortable" @click="toggleSort('name')">
                <div class="th-label">Name / Description <i :class="sortIcon('name')" class="tx-sort-icon" /></div>
                <div class="th-resize-handle" @mousedown.stop="startColResize('name', $event)" /></th>

              <!-- In -->
              <th class="tx-col-money th-sortable" @click="toggleSort('amountIn')">
                <div class="th-label">In <i :class="sortIcon('amountIn')" class="tx-sort-icon" /></div>
                <div class="th-resize-handle" @mousedown.stop="startColResize('in', $event)" /></th>

              <!-- Out -->
              <th class="tx-col-money th-sortable" @click="toggleSort('amountOut')">
                <div class="th-label">Out <i :class="sortIcon('amountOut')" class="tx-sort-icon" /></div>
                <div class="th-resize-handle" @mousedown.stop="startColResize('out', $event)" /></th>

              <!-- Balance -->
              <th class="tx-col-balance">
                <div class="th-label">Balance</div>
                <div class="th-resize-handle" @mousedown.stop="startColResize('balance', $event)" /></th>

              <!-- Item -->
              <th class="tx-col-item th-sortable" @click="toggleSort('item')">
                <div class="th-label">Item <i :class="sortIcon('item')" class="tx-sort-icon" /></div>
                <div class="th-resize-handle" @mousedown.stop="startColResize('item', $event)" /></th>

              <!-- Account -->
              <th class="tx-col-account th-sortable" @click="toggleSort('account')">
                <div class="th-label">Account <i :class="sortIcon('account')" class="tx-sort-icon" /></div>
                <div class="th-resize-handle" @mousedown.stop="startColResize('account', $event)" /></th>

              <!-- Notes -->
              <th class="tx-col-notes">
                <div class="th-label">Notes</div>
                <div class="th-resize-handle" @mousedown.stop="startColResize('notes', $event)" /></th>

              <!-- Added -->
              <th class="tx-col-added th-sortable" @click="toggleSort('added')">
                <div class="th-label">Added <i :class="sortIcon('added')" class="tx-sort-icon" /></div>
                <div class="th-resize-handle" @mousedown.stop="startColResize('added', $event)" /></th>

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
                :class="{ 'tx-row-cutoff': tx.id === cutoffTxId }"
                @focusout="onEditFocusOut"
                @keydown.escape.prevent="cancelEdit"
              >
                <td class="tx-col-markers">
                  <button class="tx-pin-btn" :class="{ 'tx-pin-btn--active': tx.id === cutoffTxId }" :title="tx.id === cutoffTxId ? 'Remove balance cutoff pin' : 'Pin: calculate balance from here'" @click.stop="setPinTx(tx.id)">
                    <i class="pi pi-map-marker" />
                  </button>
                </td>
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
                <td class="tx-col-balance"></td>
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
                <td class="tx-col-notes">
                  <input type="text" v-model="editDraft.notes" class="tx-input" placeholder="Notes…"
                    @keydown.enter.prevent="commitEdit" />
                </td>
                <td class="tx-created-at">{{ formatCreatedAt(tx.createdAt) }}</td>
                <td class="tx-col-action">
                  <button class="tx-flag-btn" :class="{ 'tx-flag-btn--active': tx.flagged }" title="Flag / unflag" @click.stop="store.patchTransaction(tx.id, { flagged: !tx.flagged })">
                    <i class="pi" :class="tx.flagged ? 'pi-flag-fill' : 'pi-flag'" />
                  </button>
                  <button class="tx-delete-btn" title="Delete" @click.stop="confirmDeleteTx(tx.id, true)">
                    <i class="pi pi-times" />
                  </button>
                </td>
              </tr>

              <!-- Display row -->
              <tr
                v-else
                class="tx-row tx-row-clickable"
                :class="{ 'tx-row-selected': isSelected(tx.id), 'tx-row-cutoff': tx.id === cutoffTxId, 'tx-row-flagged': tx.flagged }"
                @click="startEdit(tx)"
              >
                <td class="tx-col-markers" @click.stop>
                  <button class="tx-pin-btn" :class="{ 'tx-pin-btn--active': tx.id === cutoffTxId }" :title="tx.id === cutoffTxId ? 'Remove balance cutoff pin' : 'Pin: calculate balance from here'" @click.stop="setPinTx(tx.id)">
                    <i class="pi pi-map-marker" />
                  </button>
                </td>
                <td class="tx-col-check" @click.stop="toggleSelected(tx.id)">
                  <input
                    type="checkbox"
                    class="tx-checkbox"
                    :checked="isSelected(tx.id)"
                    @click.stop="toggleSelected(tx.id)"
                  />
                </td>
                <td>{{ formatDate(tx.date) }}</td>
                <td>{{ tx.name }}</td>
                <td class="tx-col-money money-positive">{{ tx.type === 'in'  ? formatMoney(tx.amount) : '' }}</td>
                <td class="tx-col-money money-negative">{{ tx.type === 'out' ? formatMoney(tx.amount) : '' }}</td>
                <td class="tx-col-balance" :class="runningBalanceMap.has(tx.id) ? ((runningBalanceMap.get(tx.id) ?? 0) >= 0 ? 'money-positive' : 'money-negative') : 'tx-balance-hidden'">{{ runningBalanceMap.has(tx.id) ? formatMoney(runningBalanceMap.get(tx.id)!) : '—' }}</td>
                <td class="tx-col-item">{{ getItemName(tx.itemId) }}</td>
                <td class="tx-col-account">{{ getAccountName(tx.accountId) }}</td>
                <td class="tx-col-notes" :title="tx.notes">{{ tx.notes ?? '' }}</td>
                <td class="tx-created-at">{{ formatCreatedAt(tx.createdAt) }}</td>
                <td class="tx-col-action" @click.stop>
                  <button class="tx-flag-btn" :class="{ 'tx-flag-btn--active': tx.flagged }" title="Flag / unflag" @click.stop="store.patchTransaction(tx.id, { flagged: !tx.flagged })">
                    <i class="pi" :class="tx.flagged ? 'pi-flag-fill' : 'pi-flag'" />
                  </button>
                  <button class="tx-delete-btn" title="Delete" @click.stop="confirmDeleteTx(tx.id, false)">
                    <i class="pi pi-times" />
                  </button>
                </td>
              </tr>

            </template>

            <!-- Empty state -->
            <tr v-if="!pagedTransactions.length && !pending">
              <td colspan="12" class="tx-empty">
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
              <td class="tx-col-markers"></td>
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
              <td class="tx-col-balance"></td>
              <td class="tx-col-item">
                <select v-model="pending.itemIdStr" class="tx-select">
                  <option value="">None</option>
                  <option v-for="item in budgetItemsSorted" :key="item.id" :value="String(item.id)">
                    {{ item.name }}
                  </option>
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
              <td class="tx-col-notes">
                <input type="text" v-model="pending.notes" class="tx-input" placeholder="Notes…"
                  @keydown.enter.prevent="commitTransaction" />
              </td>
              <td class="tx-created-at">—</td>
              <td class="tx-col-action"></td>
            </tr>

          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div class="tx-pagination">

        <!-- Page stats row -->
        <div class="tx-page-stats" v-if="totalPages > 1">
          <span class="tx-summary-scope tx-summary-scope--page">Page {{ page }}</span>
          <span class="tx-summary-item">
            <span class="tx-summary-label">In</span>
            <span class="money-positive">{{ formatMoney(pageIn) }}</span>
          </span>
          <span class="tx-summary-item">
            <span class="tx-summary-label">Out</span>
            <span class="money-negative">{{ formatMoney(pageOut) }}</span>
          </span>
          <span class="tx-summary-item">
            <span class="tx-summary-label">Net</span>
            <span :class="pageNet >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(pageNet) }}</span>
          </span>
          <span class="tx-summary-divider" />
          <span class="tx-summary-item" v-if="pageMaxIn !== null">
            <span class="tx-summary-label">Max In</span>
            <button class="tx-summary-stat-btn money-positive" @click="filterByAmount(pageMaxIn!)" title="Filter to this amount">{{ formatMoney(pageMaxIn) }}</button>
          </span>
          <span class="tx-summary-item" v-if="pageMinIn !== null">
            <span class="tx-summary-label">Min In</span>
            <button class="tx-summary-stat-btn money-positive" @click="filterByAmount(pageMinIn!)" title="Filter to this amount">{{ formatMoney(pageMinIn) }}</button>
          </span>
          <span class="tx-summary-divider" v-if="pageMaxOut !== null || pageMinOut !== null" />
          <span class="tx-summary-item" v-if="pageMaxOut !== null">
            <span class="tx-summary-label">Max Out</span>
            <button class="tx-summary-stat-btn money-negative" @click="filterByAmount(pageMaxOut!)" title="Filter to this amount">{{ formatMoney(pageMaxOut) }}</button>
          </span>
          <span class="tx-summary-item" v-if="pageMinOut !== null">
            <span class="tx-summary-label">Min Out</span>
            <button class="tx-summary-stat-btn money-negative" @click="filterByAmount(pageMinOut!)" title="Filter to this amount">{{ formatMoney(pageMinOut) }}</button>
          </span>
          <span class="tx-summary-divider" v-if="pageAvg !== null" />
          <span class="tx-summary-item" v-if="pageAvg !== null">
            <span class="tx-summary-label">Avg</span>
            <span class="tx-summary-value">{{ formatMoney(pageAvg) }}</span>
          </span>
          <span class="tx-summary-count">{{ pagedTransactions.length }} on page</span>
        </div>

        <div class="tx-pagination-controls">
          <div class="tx-page-size-wrap">
            <span class="tx-pagination-label">Show</span>
            <select v-model="pageSize" class="tx-page-size-select">
              <option v-for="s in PAGE_SIZES" :key="s" :value="s">{{ s }}</option>
            </select>
            <span class="tx-pagination-label">per page</span>
          </div>
          <div class="tx-page-nav">
            <!-- First page -->
            <button class="tx-page-btn" :disabled="page === 1" @click="goToPage(1)" title="First page">
              <i class="pi pi-angle-double-left" />
            </button>
            <!-- Previous page -->
            <button class="tx-page-btn" :disabled="page === 1" @click="goToPage(page - 1)" title="Previous page">
              <i class="pi pi-chevron-left" />
            </button>
            <!-- Surrounding page numbers -->
            <div class="tx-page-numbers">
              <button
                v-for="n in visiblePageNumbers"
                :key="n"
                class="tx-page-btn tx-page-btn--num"
                :class="{ 'tx-page-btn--active': n === page }"
                @click="goToPage(n)"
              >{{ n }}</button>
            </div>
            <!-- Next page -->
            <button class="tx-page-btn" :disabled="page >= totalPages" @click="goToPage(page + 1)" title="Next page">
              <i class="pi pi-chevron-right" />
            </button>
            <!-- Last page -->
            <button class="tx-page-btn" :disabled="page >= totalPages" @click="goToPage(totalPages)" title="Last page">
              <i class="pi pi-angle-double-right" />
            </button>
            <!-- Jump to page -->
            <span class="tx-pagination-label">Go to</span>
            <input
              v-model="pageJumpStr"
              type="number"
              min="1"
              :max="totalPages"
              class="tx-page-jump-input"
              placeholder="#"
              @keydown.enter="handlePageJump"
              @blur="handlePageJump"
            />
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="tx-footer">
        <button class="add-item-btn" :disabled="!!pending || editingId !== null" @click="startTransaction">
          <i class="pi pi-plus" /> Add Transaction
        </button>
        <button class="tx-export-btn" @click="exportCsv" :title="selectedCount > 0 ? `Export ${selectedCount} selected` : `Export all ${totalCount} filtered`">
          <i class="pi pi-download" /> Export CSV{{ selectedCount > 0 ? ` (${selectedCount})` : '' }}
        </button>
      </div>

      <!-- Import history -->
      <div v-if="historyStore.imports.length > 0" class="tx-import-history">
        <button class="tx-import-history-toggle" @click="historyExpanded = !historyExpanded">
          <i class="pi pi-history" />
          Import History ({{ historyStore.imports.length }})
          <i :class="historyExpanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" class="tx-import-history-chevron" />
        </button>
        <div v-if="historyExpanded" class="tx-import-history-list">
          <div v-for="rec in historyStore.imports" :key="rec.id" class="tx-import-history-row">
            <span class="tx-import-history-bank">{{ rec.bankName }}</span>
            <span class="tx-import-history-file">{{ rec.fileName || '—' }}</span>
            <span class="tx-import-history-count">{{ rec.rowCount }} imported</span>
            <span class="tx-import-history-date">{{ formatCreatedAt(rec.date) }}</span>
          </div>
          <button class="tx-import-history-clear" @click="historyStore.clearHistory()">Clear history</button>
        </div>
      </div>

    </div>
  </div>
</template>
