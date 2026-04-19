<script setup lang="ts">
import { ref, computed, toRef, nextTick, watch } from 'vue'
import type { BudgetItem, BudgetItemDef, BudgetRow } from '../types/budget'
import { useBudgetSelection } from '../composables/useBudgetSelection'
import { useBudgetDrag } from '../composables/useBudgetDrag'
import { useMoneyInput } from '../composables/useMoneyInput'
import { useTransactionStore } from '../stores/transactionStore'
import { useAccountStore } from '../stores/accountStore'
import { useMonthStore } from '../stores/monthStore'
import { useSettingsStore } from '../stores/settingsStore'
import { getTodayStr } from '../utils/date'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import InputText from 'primevue/inputtext'
import Checkbox from 'primevue/checkbox'

const props = defineProps<{
  items: BudgetItem[]
  availableToAdd: BudgetItemDef[]
}>()

const emit = defineEmits<{
  update: [item: BudgetItem]
  reorder: [items: BudgetItem[]]
  addItem: [name: string, category: string]
  addExistingItem: [itemId: number, category: string]
  viewItemTransactions: [itemId: number, yearMonth: string]
  deleteItem: [id: number]
  deleteCategory: [category: string]
}>() 

const itemsRef = toRef(props, 'items')

const transactionStore = useTransactionStore()
const accountStore     = useAccountStore()
const monthStore       = useMonthStore()
const settings         = useSettingsStore()

// Balance per account for the modal
const accountBalanceMap = computed(() => {
  const map = new Map<string, number>()
  for (const t of transactionStore.transactions) {
    if (!t.accountId) continue
    map.set(t.accountId, (map.get(t.accountId) ?? 0) + (t.type === 'in' ? t.amount : -t.amount))
  }
  return map
})

// Running balance across all accounts (from store)
const totalFundsAvailable = computed(() => transactionStore.totalFunds)

const tableItems = computed<BudgetRow[]>(() =>
  props.items.map(i => {
    const activity  = transactionStore.getItemActivity(i.id, monthStore.activeYear, monthStore.activeMonth)
    const available = Math.round((i.assigned - activity) * 100) / 100
    return { ...i, activity, available }
  })
)

const expandedRowGroups = ref<string[]>(
  [...new Set(props.items.map(i => i.category))]
)

// Auto-expand when a new category is added (e.g. via "Add Item")
watch(
  () => [...new Set(props.items.map(i => i.category))],
  (cats) => {
    for (const cat of cats) {
      if (!expandedRowGroups.value.includes(cat))
        expandedRowGroups.value = [...expandedRowGroups.value, cat]
    }
  }
)

// ── Pending new item ───────────────────────────────────────────

const pendingCategory = ref<string | null>(null)
const pendingMode     = ref<'select' | 'create'>('select')
const pendingName     = ref('')
const newItemInputRef = ref<HTMLInputElement | null>(null)
const selectRef       = ref<HTMLSelectElement | null>(null)

async function startNewItem(category: string): Promise<void> {
  pendingCategory.value = category
  pendingName.value     = ''
  pendingMode.value     = props.availableToAdd.length > 0 ? 'select' : 'create'
  await nextTick()
  if (pendingMode.value === 'select') selectRef.value?.focus()
  else newItemInputRef.value?.focus()
}

function onSelectExistingItem(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (!value) return
  if (value === '__new__') {
    pendingMode.value = 'create'
    nextTick(() => newItemInputRef.value?.focus())
    ;(event.target as HTMLSelectElement).value = ''
    return
  }
  emit('addExistingItem', parseInt(value, 10), pendingCategory.value!)
  pendingCategory.value = null
  pendingName.value     = ''
}

function commitNewItem(): void {
  const name = pendingName.value.trim()
  if (name && pendingCategory.value)
    emit('addItem', name, pendingCategory.value)
  pendingCategory.value = null
  pendingName.value = ''
}

function cancelNewItem(): void {
  pendingCategory.value = null
  pendingName.value = ''
}

function onNewItemBlur(): void {
  if (pendingName.value.trim()) {
    commitNewItem()
  } else {
    cancelNewItem()
  }
}

const {
  itemsInCategory,
  isSelected,
  toggleItem,
  isAllSelected,
  isSomeSelected,
  toggleAll,
  isCategoryAllSelected,
  isCategoryIndeterminate,
  toggleCategorySelection,
  getRowClass,
} = useBudgetSelection(itemsRef)

const {
  hoveredCategory,
  onRowReorder,
  onTableDragStart,
  onCategoryDragStart,
  onDropToCategory,
  onWrapperMouseDown,
  onWrapperMouseUp,
  clearDrag,
} = useBudgetDrag(itemsRef, tableItems, expandedRowGroups, (items) => emit('reorder', items))

function toggleGroup(category: string): void {
  if (expandedRowGroups.value.includes(category)) {
    expandedRowGroups.value = expandedRowGroups.value.filter(c => c !== category)
  } else {
    expandedRowGroups.value = [...expandedRowGroups.value, category]
  }
}

function formatMoney(v: number): string { return settings.formatMoney(v) }

// ── Money input behaviour ──────────────────────────────────────────
const { moneyFocus } = useMoneyInput()

/** Blur handler for the cell editor: normalise display then update the data object. */
function moneyEditorBlur(e: FocusEvent, data: Record<string, unknown>, field: string) {
  const el = e.target as HTMLInputElement
  const parsed = parseFloat(el.value)
  const val = isNaN(parsed) ? 0 : Math.max(0, parsed)
  el.value = val.toFixed(2)
  data[field] = val
}

// ── Spend progress bar ─────────────────────────────────────────────
function spendPct(data: BudgetRow): number {
  if (data.assigned === 0) return data.activity > 0 ? 200 : 0
  return (data.activity / data.assigned) * 100
}

/** Width (0-100) of the colored overlay bar. */
function barFillWidth(pct: number): number {
  if (pct >= 100) return Math.min(pct - 100, 100)  // blue overshield fill
  return Math.max(0, Math.min(pct, 100))             // normal fill
}

/** Color of the overlay bar. */
function barFillColor(pct: number): string {
  if (pct >= 100) return '#3b82f6'  // blue overshield
  if (pct >= 50)  return '#eab308'  // yellow
  return '#ef4444'                   // red
}

// ── Funding / Refund modal ─────────────────────────────────────────────
type FundMode = 'fund' | 'fund-partial' | 'fund-negative' | 'overspend' | 'refund'
const fundingModal = ref<{
  item: BudgetRow
  mode: FundMode
  selectedAccountId: string
  amount: number
} | null>(null)

function onAvailableClick(row: BudgetRow): void {
  const headroom = row.available
  const funds    = totalFundsAvailable.value
  if (headroom === 0) return
  if (headroom < 0) {
    fundingModal.value = {
      item:              row,
      mode:              'overspend',
      selectedAccountId: accountStore.accounts[0]?.id ?? '',
      amount:            Math.abs(headroom),
    }
  } else if (funds > 0) {
    fundingModal.value = {
      item:              row,
      mode:              funds >= headroom ? 'fund' : 'fund-partial',
      selectedAccountId: accountStore.accounts[0]?.id ?? '',
      amount:            Math.min(headroom, funds),
    }
  } else {
    // funds <= 0: warn that this will make total funds negative
    fundingModal.value = {
      item:              row,
      mode:              'fund-negative',
      selectedAccountId: accountStore.accounts[0]?.id ?? '',
      amount:            headroom,
    }
  }
}

function confirmFunding(): void {
  if (!fundingModal.value) return
  const { item, mode, selectedAccountId, amount } = fundingModal.value
  const { activeYear, activeMonth } = monthStore

  if (mode === 'refund') {
    // Unassign all transactions linked to this item in the active month
    const targets = transactionStore.transactions.filter(t => {
      if (t.itemId !== item.id) return false
      const [y, m] = t.date.split('-').map(Number)
      return y === activeYear && m === activeMonth
    })
    for (const tx of targets) {
      transactionStore.updateTransaction(tx.id, {
        name: tx.name, date: tx.date, type: tx.type, amount: tx.amount,
        itemId: null, accountId: tx.accountId,
      })
    }
    fundingModal.value = null
    return
  }

  if (mode === 'overspend') {
    if (!selectedAccountId) return
    transactionStore.addTransaction({
      name:      `Refund: ${item.name}`,
      date:      getTodayStr(),
      type:      'in',
      amount,
      itemId:    null,
      accountId: selectedAccountId,
    })
    fundingModal.value = null
    return
  }

  // 'fund', 'fund-partial', or 'fund-negative'
  if (!selectedAccountId || amount <= 0) return
  const ym = `${activeYear}-${String(activeMonth).padStart(2, '0')}`
  transactionStore.addTransaction({
    name:      `Budget: ${item.name}`,
    date:      `${ym}-01`,
    type:      'out',
    amount,
    itemId:    item.id,
    accountId: selectedAccountId,
  })
  fundingModal.value = null
}

function categoryTotal(category: string, field: 'assigned' | 'activity' | 'available'): number {
  return tableItems.value
    .filter(i => i.category === category)
    .reduce((sum, item) => sum + item[field], 0)
}

function catSpendPct(category: string): number {
  const assigned = categoryTotal(category, 'assigned')
  const activity = categoryTotal(category, 'activity')
  if (assigned === 0) return activity > 0 ? 200 : 0
  return (activity / assigned) * 100
}

function onCellEditComplete(event: { data: BudgetItem; newData: BudgetItem; field: string; type: string }): void {
  if (event.type === 'escape') return
  emit('update', { ...event.newData })
}

</script>

<template>
  <div
    class="table-wrapper"
    @dragstart="onTableDragStart"
    @dragend="clearDrag"
    @mousedown="onWrapperMouseDown"
    @mouseup="onWrapperMouseUp"
  >
    <DataTable
      :value="tableItems"
      :rowClass="getRowClass"
      v-model:expandedRowGroups="expandedRowGroups"
      editMode="cell"
      dataKey="id"
      rowGroupMode="subheader"
      groupRowsBy="category"
      expandableRowGroups
      @cell-edit-complete="onCellEditComplete"
      @row-reorder="onRowReorder"
      resizableColumns
      columnResizeMode="fit"
      tableStyle="min-width: 40rem"
    >
      <Column columnKey="selection" style="width: 3rem" headerStyle="width: 3rem">
        <template #header>
          <Checkbox
            :modelValue="isAllSelected"
            :indeterminate="isSomeSelected"
            binary
            @change="toggleAll"
            @click.stop
          />
        </template>
        <template #body="{ data }">
          <Checkbox
            :modelValue="isSelected(data)"
            binary
            @change="toggleItem(data)"
            @click.stop
          />
        </template>
      </Column>

      <Column columnKey="name" field="name" header="Category">
        <template #body="{ data }">
          <div class="item-name-cell">
            <div class="item-name-row">
              <span>{{ data.name }}</span>
              <button
                class="item-delete-btn"
                title="Remove item from this month"
                @click.stop="emit('deleteItem', data.id)"
              ><i class="pi pi-trash" /></button>
            </div>
            <div class="item-bar" :class="{ 'item-bar--over': spendPct(data) >= 100 }">
              <div v-if="barFillWidth(spendPct(data)) > 0" class="item-bar-fill" :style="{ width: barFillWidth(spendPct(data)) + '%', background: barFillColor(spendPct(data)) }" />
            </div>
          </div>
        </template>
        <template #editor="{ data, field }">
          <InputText v-model="data[field]" fluid autofocus />
        </template>
      </Column>

      <Column columnKey="assigned" field="assigned" header="Assigned" style="width: 13rem">
        <template #body="{ data }">{{ formatMoney(data.assigned) }}</template>
        <template #editor="{ data, field }">
          <input
            type="text"
            inputmode="decimal"
            class="budget-money-editor"
            :value="(+data[field] || 0).toFixed(2)"
            autofocus
            @focus="moneyFocus"
            @input="data[field] = Math.max(0, parseFloat(($event.target as HTMLInputElement).value) || 0)"
            @blur="moneyEditorBlur($event, data as Record<string, unknown>, field)"
          />
        </template>
      </Column>

      <Column columnKey="activity" field="activity" header="Activity" style="width: 13rem">
        <template #body="{ data }">
          <div class="activity-cell">
            <button
              v-if="data.activity !== 0"
              class="activity-link"
              @click.stop="emit('viewItemTransactions', data.id, `${monthStore.activeYear}-${String(monthStore.activeMonth).padStart(2, '0')}`)"
            >{{ formatMoney(data.activity) }}</button>
            <span v-else>{{ formatMoney(data.activity) }}</span>
            <button
              v-if="data.activity !== 0"
              class="activity-unassign-btn"
              title="Unassign all transactions for this item"
              @click.stop="fundingModal = { item: data, mode: 'refund', selectedAccountId: '', amount: 0 }"
            >
              <i class="pi pi-undo" />
            </button>
          </div>
        </template>
      </Column>

      <Column columnKey="available" field="available" header="Available" style="width: 13rem">
        <template #body="{ data }">
          <!-- Overspent: activity > assigned → headroom negative, shown blue -->
          <button
            v-if="data.available < 0"
            class="activity-link available-overspend"
            @click.stop="onAvailableClick(data)"
            title="Overspent — click to create a refund transaction"
          >{{ formatMoney(-data.available) }}</button>
          <!-- Zero: neutral, not clickable -->
          <span v-else-if="data.available <= 0">{{ formatMoney(0) }}</span>
          <!-- Positive and funds fully cover it: green -->
          <button
            v-else-if="totalFundsAvailable >= data.available"
            class="activity-link available-safe"
            @click.stop="onAvailableClick(data)"
            title="Click to fully fund this item"
          >{{ formatMoney(data.available) }}</button>
          <!-- Positive, partial funds available (at least 0.01): yellow —  show what you can fund now -->
          <button
            v-else-if="totalFundsAvailable >= 0.01"
            class="activity-link available-partial"
            @click.stop="onAvailableClick(data)"
            title="Only partial funds available — click to fund what you can"
          >{{ formatMoney(totalFundsAvailable) }}</button>
          <!-- Positive but no funds left: red — clickable with warning -->
          <button
            v-else
            class="activity-link available-danger"
            @click.stop="onAvailableClick(data)"
            title="No funds available — funding this will put you into negative"
          >{{ formatMoney(data.available) }}</button>
        </template>
      </Column>

      <!-- Zero-width spacer: fixes PrimeVue colspan=columnsLength-1 on group headers -->
      <Column columnKey="__spacer" style="width: 0; min-width: 0; padding: 0; border: none; overflow: hidden" headerStyle="width: 0; min-width: 0; padding: 0; border: none" />

      <template #groupheader="{ data }">
        <div
          class="category-group-header"
          :class="{ 'category-drop-target': hoveredCategory === data.category }"
          draggable="true"
          @dragstart.stop="onCategoryDragStart(data.category)"
          @dragover.prevent
          @dragenter.prevent="hoveredCategory = data.category"
          @dragleave.self="hoveredCategory = null"
          @drop.stop.prevent="onDropToCategory(data.category)"
        >
          <Checkbox
            :modelValue="isCategoryAllSelected(data.category)"
            :indeterminate="isCategoryIndeterminate(data.category)"
            binary
            @change="toggleCategorySelection(data.category)"
            @click.stop
            class="category-checkbox"
          />
          <button type="button" class="category-toggle-btn" @click.stop="toggleGroup(data.category)">
            <i :class="expandedRowGroups.includes(data.category) ? 'pi pi-chevron-down' : 'pi pi-chevron-right'" />
          </button>
          <div class="category-name-bar">
            <span class="category-group-name">{{ data.category }}</span>
          </div>
          <span class="category-group-count">{{ itemsInCategory(data.category).length }}</span>
          <div class="category-group-totals">
            <span>{{ formatMoney(categoryTotal(data.category, 'assigned')) }}</span>
            <span>{{ formatMoney(categoryTotal(data.category, 'activity')) }}</span>
            <span :class="categoryTotal(data.category, 'available') >= 0 ? 'money-positive' : 'money-negative'">
              {{ formatMoney(categoryTotal(data.category, 'available')) }}
            </span>
          </div>
          <button
            class="category-delete-btn"
            title="Remove this category and all its items from this month"
            @click.stop="emit('deleteCategory', data.category)"
          ><i class="pi pi-trash" /></button>
          <!-- Full-width bar pinned to bottom of the row -->
          <div class="category-bar" :class="{ 'item-bar--over': catSpendPct(data.category) >= 100 }">
            <div
              v-if="barFillWidth(catSpendPct(data.category)) > 0"
              class="item-bar-fill"
              :style="{ width: barFillWidth(catSpendPct(data.category)) + '%', background: barFillColor(catSpendPct(data.category)) }"
            />
          </div>
        </div>
      </template>

      <template #groupfooter="{ data }">
        <div class="category-add-item-row">
          <div v-if="pendingCategory === data.category" class="new-item-pending">
            <span class="new-item-indent" />

            <!-- Select mode: pick an existing global item not already in this month -->
            <template v-if="pendingMode === 'select'">
              <select
                ref="selectRef"
                class="new-item-select"
                @change="onSelectExistingItem($event)"
                @keydown.escape="cancelNewItem"
              >
                <option value="">— Select existing item —</option>
                <option
                  v-for="item in availableToAdd"
                  :key="item.id"
                  :value="item.id"
                >{{ item.name }}</option>
                <option value="__new__">+ Create new item…</option>
              </select>
            </template>

            <!-- Create mode: type a new item name -->
            <template v-else>
              <input
                ref="newItemInputRef"
                v-model="pendingName"
                class="new-item-name-input"
                placeholder="New item name…"
                @keydown.enter.prevent="commitNewItem"
                @keydown.escape="cancelNewItem"
                @blur="onNewItemBlur"
              />
            </template>
          </div>
          <button
            v-else
            class="add-item-btn"
            :disabled="pendingCategory !== null"
            @click.stop="startNewItem(data.category)"
          >
            <i class="pi pi-plus" /> Add Item
          </button>
        </div>
      </template>
    </DataTable>

    <!-- ── Funding / Refund modal ──────────────────────────────────── -->
    <div v-if="fundingModal" class="fund-modal-overlay" @click.self="fundingModal = null">
      <div
        class="fund-modal"
        :class="{
          'fund-modal-refund':       fundingModal.mode === 'refund',
          'fund-modal--partial':     fundingModal.mode === 'fund-partial',
          'fund-modal--negative':    fundingModal.mode === 'fund-negative',
          'fund-modal--overspend':   fundingModal.mode === 'overspend',
        }"
      >

        <div class="fund-modal-header">
          <i :class="{
            'pi pi-send':            fundingModal.mode === 'fund',
            'pi pi-circle-fill':     fundingModal.mode === 'fund-partial',
            'pi pi-exclamation-triangle': fundingModal.mode === 'fund-negative',
            'pi pi-arrow-circle-up': fundingModal.mode === 'overspend',
            'pi pi-undo':            fundingModal.mode === 'refund',
          }" />
          <span class="fund-modal-title">{{
            fundingModal.mode === 'fund'          ? 'Fund Item' :
            fundingModal.mode === 'fund-partial'  ? 'Partial Fund' :
            fundingModal.mode === 'fund-negative' ? 'Warning — No Funds' :
            fundingModal.mode === 'overspend'     ? 'Overspent — Create Refund' :
                                                    'Unassign Transactions'
          }}</span>
        </div>

        <div class="fund-modal-body">
          <p v-if="fundingModal.mode === 'fund'" class="fund-modal-desc">
            Allocate <strong>{{ formatMoney(fundingModal.amount) }}</strong> to
            <strong>{{ fundingModal.item.name }}</strong> for {{ monthStore.label }}.
            Select which account to draw from.
          </p>
          <p v-else-if="fundingModal.mode === 'fund-negative'" class="fund-modal-desc fund-modal-warn">
            <i class="pi pi-exclamation-triangle" />
            You have no funds available. Funding <strong>{{ formatMoney(fundingModal.amount) }}</strong>
            for <strong>{{ fundingModal.item.name }}</strong> will put your total funds into negative.
            Are you sure you want to proceed?
          </p>
          <p v-else-if="fundingModal.mode === 'fund-partial'" class="fund-modal-desc">
            You only have <strong>{{ formatMoney(fundingModal.amount) }}</strong> available — not enough
            to fully cover <strong>{{ fundingModal.item.name }}</strong>.
            This will partially fund the item for {{ monthStore.label }}.
          </p>
          <p v-else-if="fundingModal.mode === 'overspend'" class="fund-modal-desc">
            <strong>{{ fundingModal.item.name }}</strong> is overspent by
            <strong>{{ formatMoney(fundingModal.amount) }}</strong> for {{ monthStore.label }}.
            A refund transaction will be created as unassigned income.
          </p>
          <p v-else class="fund-modal-desc">
            This will unassign all transactions linked to
            <strong>{{ fundingModal.item.name }}</strong> for {{ monthStore.label }},
            returning them to the unassigned pool.
          </p>

          <template v-if="fundingModal.mode !== 'refund'">
            <div class="fund-modal-field">
              <span class="fund-modal-label">Amount</span>
              <span class="fund-modal-amount">{{ formatMoney(fundingModal.amount) }}</span>
            </div>

            <div class="fund-modal-field">
              <label class="fund-modal-label" for="fund-account-select">{{
                fundingModal.mode === 'overspend' ? 'Credit to account' : 'Draw from account'
              }}</label>
              <div v-if="accountStore.accounts.length === 0" class="fund-modal-no-accounts">
                No accounts defined. Add accounts in the Accounts page first.
              </div>
              <template v-else>
                <select id="fund-account-select" v-model="fundingModal.selectedAccountId" class="fund-modal-select">
                  <option v-for="acc in accountStore.accounts" :key="acc.id" :value="acc.id">
                    {{ acc.name }}
                  </option>
                </select>
                <span
                  v-if="fundingModal.selectedAccountId"
                  class="fund-modal-account-bal"
                  :class="(accountBalanceMap.get(fundingModal.selectedAccountId) ?? 0) >= 0 ? 'money-positive' : 'money-negative'"
                >
                  Balance: {{ formatMoney(accountBalanceMap.get(fundingModal.selectedAccountId) ?? 0) }}
                </span>
              </template>
            </div>
          </template>
        </div>

        <div class="fund-modal-actions">
          <button class="fund-modal-btn fund-modal-btn-cancel" @click="fundingModal = null">Cancel</button>
          <button
            class="fund-modal-btn"
            :class="{
              'fund-modal-btn-fund':    fundingModal.mode === 'fund',
              'fund-modal-btn-partial': fundingModal.mode === 'fund-partial',
              'fund-modal-btn-danger':  fundingModal.mode === 'fund-negative',
              'fund-modal-btn-green':   fundingModal.mode === 'overspend',
              'fund-modal-btn-refund':  fundingModal.mode === 'refund',
            }"
            :disabled="fundingModal.mode !== 'refund' && (!fundingModal.selectedAccountId || accountStore.accounts.length === 0)"
            @click="confirmFunding"
          >{{
            fundingModal.mode === 'fund'          ? 'Fund Item' :
            fundingModal.mode === 'fund-partial'  ? 'Partially Fund' :
            fundingModal.mode === 'fund-negative' ? 'Fund Anyway' :
            fundingModal.mode === 'overspend'     ? 'Create Refund' :
                                                    'Unassign All'
          }}</button>
        </div>

      </div>
    </div>
  </div>
</template>
