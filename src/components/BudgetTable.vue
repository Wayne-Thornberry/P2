<script setup lang="ts">
import { ref, computed, toRef, nextTick, watch } from 'vue'
import type { BudgetItem, BudgetItemDef, BudgetRow } from '../types/budget'
import { useBudgetSelection } from '../composables/useBudgetSelection'
import { useBudgetDrag } from '../composables/useBudgetDrag'
import { useTransactionStore } from '../stores/transactionStore'
import { useMonthStore } from '../stores/monthStore'
import { useSettingsStore } from '../stores/settingsStore'
import { roundCents } from '../utils/math'
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
const monthStore       = useMonthStore()
const settings         = useSettingsStore()

const activityByItem = computed(() =>
  transactionStore.getMonthlyActivityMap(monthStore.activeYear, monthStore.activeMonth)
)

const tableItems = computed<BudgetRow[]>(() =>
  props.items.map(i => {
    const activity  = activityByItem.value.get(i.id) ?? 0
    const available = roundCents(i.assigned - activity)
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
/** Raw string tracked during cell editing — avoids cursor-clobbering reactive reformats. */
const editingRaw = ref('')

function startMoneyEdit(e: FocusEvent, initialValue: unknown) {
  editingRaw.value = (+(initialValue as number) || 0).toFixed(2)
  const el = e.target as HTMLInputElement
  setTimeout(() => el.select(), 0)
}

function onMoneyInput(e: Event, data: Record<string, unknown>, field: string) {
  const raw = (e.target as HTMLInputElement).value
  editingRaw.value = raw
  data[field] = parseFloat(raw) || 0
}

/** Blur handler for the cell editor: normalise display then update the data object. */
function moneyEditorBlur(e: FocusEvent, data: Record<string, unknown>, field: string) {
  const el = e.target as HTMLInputElement
  const parsed = parseFloat(el.value)
  const val = isNaN(parsed) ? 0 : Math.max(0, parsed)
  editingRaw.value = val.toFixed(2)
  el.value = editingRaw.value
  data[field] = val
}

// ── Spend progress bar ─────────────────────────────────────────────
function spendPct(data: BudgetRow): number {
  if (data.assigned === 0) return data.activity > 0 ? 200 : 0
  return (data.activity / data.assigned) * 100
}

/** Width (0-100) of the colored overlay bar. */
function barFillWidth(pct: number): number {
  if (pct >= 100) return Math.min(pct - 100, 100)  // red overshield fill
  return Math.max(0, Math.min(pct, 100))
}

/** Color of the overlay bar: green → yellow → red as spending increases. */
function barFillColor(pct: number): string {
  if (pct >= 100) return '#dc2626'  // dark red for overshield
  if (pct >= 80)  return '#eab308'  // yellow caution
  return '#22c55e'                   // green = under budget
}

// ── Available column / Overspend modal ───────────────────────────────────
type FundMode = 'overspend' | 'refund'
const fundingModal = ref<{
  item: BudgetRow
  mode: FundMode
} | null>(null)

function onAvailableClick(row: BudgetRow): void {
  if (row.available === 0) return
  if (row.available < 0) {
    // Overspent — offer to absorb into budget by raising assigned
    fundingModal.value = { item: row, mode: 'overspend' }
  } else {
    // Under budget — navigate to transactions for this item
    const ym = `${monthStore.activeYear}-${String(monthStore.activeMonth).padStart(2, '0')}`
    emit('viewItemTransactions', row.id, ym)
  }
}

function confirmFunding(): void {
  if (!fundingModal.value) return
  const { item, mode } = fundingModal.value
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
    // Increase assigned to match activity so available = 0
    emit('update', { ...item, assigned: roundCents(item.activity) })
    fundingModal.value = null
    return
  }
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
            :value="editingRaw"
            autofocus
            @focus="startMoneyEdit($event, data[field])"
            @input="onMoneyInput($event, data as Record<string, unknown>, field)"
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
              @click.stop="fundingModal = { item: data, mode: 'refund' }"
            >
              <i class="pi pi-undo" />
            </button>
          </div>
        </template>
      </Column>

      <Column columnKey="available" field="available" header="Available" style="width: 13rem">
        <template #body="{ data }">
          <!-- Overspent: click to absorb overspend into budget -->
          <button
            v-if="data.available < 0"
            class="activity-link available-overspend"
            @click.stop="onAvailableClick(data)"
            title="Overspent — click to increase budget to cover"
          >{{ formatMoney(-data.available) }}</button>
          <!-- Zero: balanced -->
          <span v-else-if="data.available === 0">{{ formatMoney(0) }}</span>
          <!-- Positive: under budget, click to view transactions -->
          <button
            v-else
            class="activity-link available-safe"
            @click.stop="onAvailableClick(data)"
            title="Under budget — click to view transactions for this item"
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

    <!-- ── Overspend / Unassign modal ──────────────────────────────────── -->
    <div v-if="fundingModal" class="fund-modal-overlay" @click.self="fundingModal = null">
      <div
        class="fund-modal"
        :class="{
          'fund-modal-refund':     fundingModal.mode === 'refund',
          'fund-modal--overspend': fundingModal.mode === 'overspend',
        }"
      >
        <div class="fund-modal-header">
          <i :class="fundingModal.mode === 'refund' ? 'pi pi-undo' : 'pi pi-arrow-up'" />
          <span class="fund-modal-title">{{ fundingModal.mode === 'refund' ? 'Unassign Transactions' : 'Absorb Overspend' }}</span>
        </div>

        <div class="fund-modal-body">
          <p v-if="fundingModal.mode === 'overspend'" class="fund-modal-desc">
            <strong>{{ fundingModal.item.name }}</strong> is overspent by
            <strong>{{ formatMoney(Math.abs(fundingModal.item.available)) }}</strong> for {{ monthStore.label }}.
            Increase the budget to <strong>{{ formatMoney(fundingModal.item.activity) }}</strong> to absorb this overspend?
          </p>
          <p v-else class="fund-modal-desc">
            This will unassign all transactions linked to
            <strong>{{ fundingModal.item.name }}</strong> for {{ monthStore.label }},
            returning them to the unassigned pool.
          </p>
        </div>

        <div class="fund-modal-actions">
          <button class="fund-modal-btn fund-modal-btn-cancel" @click="fundingModal = null">Cancel</button>
          <button
            class="fund-modal-btn"
            :class="fundingModal.mode === 'overspend' ? 'fund-modal-btn-green' : 'fund-modal-btn-refund'"
            @click="confirmFunding"
          >{{ fundingModal.mode === 'overspend' ? 'Absorb' : 'Unassign All' }}</button>
        </div>

      </div>
    </div>
  </div>
</template>
