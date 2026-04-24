<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
import { useBudgetStore } from '../stores/budgetStore'
import { useTransactionStore } from '../stores/transactionStore'
import { useMonthStore } from '../stores/monthStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { BudgetItem, BudgetRow } from '../types/budget'
import { useToast } from 'primevue/usetoast'
import Toast from 'primevue/toast'
import BudgetTable from './BudgetTable.vue'
import AssignPanel from './AssignPanel.vue'
import { useConfirm } from '../composables/useConfirm'
import { useBudgetFunds } from '../composables/useBudgetFunds'
import { usePlannerStore } from '../stores/plannerStore'
import { roundCents, txNet } from '../utils/math'
const store        = useBudgetStore()
const txStore      = useTransactionStore()
const monthStore   = useMonthStore()
const settings     = useSettingsStore()
const toast        = useToast()
const { confirm }  = useConfirm()
const { budgetFunds, excludedAccountIds } = useBudgetFunds()
const plannerStore = usePlannerStore()
const isMonthEmpty = computed(() => store.items.length === 0)

// ── Add category ──────────────────────────────────────────────
const addingCategory  = ref(false)
const newCategoryName = ref('')
const newCatInputRef  = ref<HTMLInputElement | null>(null)

async function startAddCategory(): Promise<void> {
  addingCategory.value  = true
  newCategoryName.value = ''
  await nextTick()
  newCatInputRef.value?.focus()
}

function commitAddCategory(): void {
  const name = newCategoryName.value.trim()
  if (name) store.addItem('New Item', name)
  addingCategory.value = false
}

function cancelAddCategory(): void {
  addingCategory.value = false
}

async function handlePopulateTemplate(): Promise<void> {
  if (!isMonthEmpty.value) {
    const ok = await confirm({
      title: 'Apply template?',
      message: `This will replace all ${store.items.length} item(s) for ${monthStore.label} with the default template.`,
      confirmLabel: 'Apply',
      danger: true,
    })
    if (!ok) return
  }
  store.populateFromTemplate()
  toast.add({ severity: 'success', summary: 'Template applied', detail: `Budget populated for ${monthStore.label}.`, life: 3000 })
}

const copyFromMonthKey = ref('')

function handleCopyFromMonth(): void {
  if (!copyFromMonthKey.value) return
  const [y, m] = copyFromMonthKey.value.split('-').map(Number)
  store.populateFromMonth(y, m)
  const src = store.monthsWithData.find(x => x.year === y && x.month === m)
  toast.add({ severity: 'success', summary: 'Budget copied', detail: `Copied from ${src?.label ?? copyFromMonthKey.value}.`, life: 3000 })
  copyFromMonthKey.value = ''
}

const emit = defineEmits<{
  navigate: [page: string]
  viewTransactions: [yearMonth: string]
  viewItemTransactions: [itemId: number, yearMonth: string]
  viewTransaction: [txName: string, yearMonth: string]
}>()

const totalFundsAvailable = computed(() => budgetFunds.value)
const excludedAccountCount = computed(() => excludedAccountIds.value.size)

const _monthStats = computed(() => {
  const y = monthStore.activeYear
  const m = monthStore.activeMonth
  const excluded = excludedAccountIds.value
  let net = 0, unassignedAct = 0, unassignedCnt = 0
  for (const t of txStore.transactions) {
    const [ty, tm] = t.date.split('-').map(Number)
    if (ty !== y || tm !== m) continue
    const delta = txNet(t)
    if (!t.accountId || !excluded.has(t.accountId)) net += delta
    if (t.itemId === null) {
      unassignedAct += (t.type === 'out' ? t.amount : -t.amount)
      unassignedCnt++
    }
  }
  return { net, unassignedAct, unassignedCnt }
})

const monthlyNet        = computed(() => _monthStats.value.net)
const unassignedActivity = computed(() => _monthStats.value.unassignedAct)
const unassignedCount   = computed(() => _monthStats.value.unassignedCnt)

function formatMoney(v: number): string { return settings.formatMoney(v) }

// ── Month/year picker ─────────────────────────────────────────
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const pickerOpen    = ref(false)
const pickerYear    = ref(monthStore.activeYear)

function openPicker(): void {
  pickerYear.value = monthStore.activeYear
  pickerOpen.value = true
}

function selectMonth(month: number): void {
  monthStore.activeYear  = pickerYear.value
  monthStore.activeMonth = month
  pickerOpen.value = false
}

// ── YNAB-style quick funding ───────────────────────────────────
const budgetRows = computed<BudgetRow[]>(() => {
  const activityMap = txStore.getMonthlyActivityMap(monthStore.activeYear, monthStore.activeMonth)
  return store.items.map(i => {
    const activity  = activityMap.get(i.id) ?? 0
    const available = roundCents(i.assigned - activity)
    return { ...i, activity, available }
  })
})

const overspentRows  = computed(() => budgetRows.value.filter(r => r.available < 0))
const underBudgetRows = computed(() => budgetRows.value.filter(r => r.available > 0))
const onTargetCount  = computed(() => budgetRows.value.filter(r => r.available === 0).length)
const totalOverspent = computed(() =>
  roundCents(overspentRows.value.reduce((sum, row) => sum + Math.abs(row.available), 0))
)
const totalUnderBudget = computed(() =>
  roundCents(underBudgetRows.value.reduce((sum, row) => sum + row.available, 0))
)

// ── Budget vs Actual ──────────────────────────────────────────
const viewMode = ref<'budget' | 'actual' | 'ideal'>('budget')

const budgetRowsByCategory = computed(() => {
  const groups = new Map<string, { rows: BudgetRow[]; assigned: number; activity: number; available: number }>()
  for (const row of budgetRows.value) {
    const cat = row.category || 'Uncategorised'
    if (!groups.has(cat)) groups.set(cat, { rows: [], assigned: 0, activity: 0, available: 0 })
    const g = groups.get(cat)!
    g.rows.push(row)
    g.assigned   = roundCents(g.assigned + row.assigned)
    g.activity   = roundCents(g.activity + row.activity)
    g.available  = roundCents(g.available + row.available)
  }
  return [...groups.entries()].map(([category, g]) => ({ category, ...g }))
})

const budgetTotals = computed(() => ({
  assigned:  roundCents(budgetRows.value.reduce((sum, row) => sum + row.assigned, 0)),
  activity:  roundCents(budgetRows.value.reduce((sum, row) => sum + row.activity, 0)),
  available: roundCents(budgetRows.value.reduce((sum, row) => sum + row.available, 0)),
}))

function usagePct(assigned: number, activity: number): number {
  if (assigned === 0) return activity > 0 ? 100 : 0
  return Math.min(999, Math.round((activity / assigned) * 100))
}
function usageColor(pct: number): string {
  if (pct >= 100) return 'rgb(239,68,68)'
  if (pct >= 80)  return 'rgb(245,158,11)'
  return 'rgb(34,197,94)'
}

async function handleDeleteItem(id: number): Promise<void> {
  const item = store.items.find(i => i.id === id)
  if (!item) return
  const ok = await confirm({
    title: 'Remove item?',
    message: `Remove "${item.name}" from ${monthStore.label}? This only affects this month.`,
    confirmLabel: 'Remove',
    danger: true,
  })
  if (!ok) return
  store.deleteItem(id)
  toast.add({ severity: 'info', summary: 'Item removed', detail: `"${item.name}" removed from ${monthStore.label}.`, life: 3000 })
}

async function handleDeleteCategory(category: string): Promise<void> {
  const count = store.items.filter(i => i.category === category).length
  const ok = await confirm({
    title: 'Remove category?',
    message: `Remove the "${category}" category and all ${count} item${count !== 1 ? 's' : ''} from ${monthStore.label}? This only affects this month.`,
    confirmLabel: 'Remove',
    danger: true,
  })
  if (!ok) return
  store.deleteCategory(category)
  toast.add({ severity: 'info', summary: 'Category removed', detail: `"${category}" and ${count} item${count !== 1 ? 's' : ''} removed from ${monthStore.label}.`, life: 3000 })
}

function absorbOverspend(): void {
  const rows = [...overspentRows.value]
  if (rows.length === 0) return
  for (const row of rows) {
    store.updateItem({ ...row, assigned: roundCents(row.activity) })
  }
  toast.add({ severity: 'success', summary: 'Budget adjusted', detail: `${rows.length} item${rows.length !== 1 ? 's' : ''} budget increased to match spending.`, life: 3000 })
}
</script>

<template>
  <div class="custom-tabs">
    <Toast />
    <div class="budget-layout">
    <div class="budget-main">

    <!-- Monthly funds card -->
    <button class="budget-funds-card" @click="emit('navigate', 'accounts')">
      <div class="budget-funds-card-header">
        <span class="budget-funds-card-label">
          <i class="pi pi-wallet" />
          Total Funds Available
        </span>
        <span class="budget-funds-card-link">
          Accounts <i class="pi pi-arrow-right" />
        </span>
      </div>
      <div class="budget-funds-card-amount" :class="Math.round(totalFundsAvailable * 100) >= 0 ? 'money-positive' : 'money-negative'">
        {{ formatMoney(totalFundsAvailable) }}
      </div>
      <div v-if="excludedAccountCount > 0" class="budget-funds-card-excluded">
        <i class="pi pi-eye-slash" />
        {{ excludedAccountCount }} liability account{{ excludedAccountCount !== 1 ? 's' : '' }} excluded
      </div>
      <div class="budget-funds-card-footer">
        <span class="budget-funds-card-net">
          <span class="budget-funds-card-net-label">{{ monthStore.label }}</span>
          <span :class="Math.round(monthlyNet * 100) >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(monthlyNet) }}</span>
        </span>
        <span v-if="unassignedActivity !== 0" class="budget-funds-card-unassigned">
          <i class="pi pi-exclamation-circle" />
          {{ formatMoney(unassignedActivity) }} unassigned
        </span>
      </div>
    </button>


    <!-- Month navigation -->
    <div class="budget-month-nav">
      <button class="budget-month-btn" @click="monthStore.prevMonth()" title="Previous month">
        <i class="pi pi-chevron-left" />
      </button>
      <button class="budget-month-label budget-month-label-btn" @click="openPicker" title="Pick month & year">
        {{ monthStore.label }}
        <i class="pi pi-calendar" style="font-size:0.65rem; opacity:0.6; margin-left:0.3rem" />
      </button>
      <button class="budget-month-btn" @click="monthStore.nextMonth()" title="Next month">
        <i class="pi pi-chevron-right" />
      </button>
    </div>

    <!-- Month/year picker popover -->
    <div v-if="pickerOpen" class="month-picker-overlay" @click.self="pickerOpen = false">
      <div class="month-picker">
        <div class="month-picker-year-row">
          <button class="month-picker-yr-btn" @click="pickerYear--"><i class="pi pi-chevron-left" /></button>
          <span class="month-picker-year">{{ pickerYear }}</span>
          <button class="month-picker-yr-btn" @click="pickerYear++"><i class="pi pi-chevron-right" /></button>
        </div>
        <div class="month-picker-grid">
          <button
            v-for="(name, i) in MONTH_SHORT"
            :key="i"
            class="month-picker-cell"
            :class="{
              'month-picker-cell-active': pickerYear === monthStore.activeYear && i + 1 === monthStore.activeMonth,
              'month-picker-cell-today': pickerYear === new Date().getFullYear() && i + 1 === new Date().getMonth() + 1,
            }"
            @click="selectMonth(i + 1)"
          >{{ name }}</button>
        </div>
      </div>
    </div>

    <!-- Empty-month prompt -->
    <div v-if="isMonthEmpty" class="budget-empty-prompt">
      <i class="pi pi-table budget-empty-icon" />
      <p class="budget-empty-title">No budget set for {{ monthStore.label }}</p>
      <p class="budget-empty-sub">Start from the default template or add items manually below.</p>
      <div class="budget-empty-actions">
        <button class="budget-empty-cta" @click="handlePopulateTemplate">
          <i class="pi pi-table" /> Populate from Template
        </button>
        <div v-if="store.monthsWithData.length > 0" class="budget-copy-from">
          <select v-model="copyFromMonthKey" class="budget-copy-from-select">
            <option value="" disabled>Copy from month…</option>
            <option v-for="m in store.monthsWithData" :key="`${m.year}-${m.month}`" :value="`${m.year}-${m.month}`">
              {{ m.label }}
            </option>
          </select>
          <button
            class="budget-empty-cta budget-copy-from-btn"
            :disabled="!copyFromMonthKey"
            @click="handleCopyFromMonth"
          >
            <i class="pi pi-copy" /> Copy
          </button>
        </div>
        <template v-if="addingCategory">
          <input
            ref="newCatInputRef"
            v-model="newCategoryName"
            class="budget-add-cat-input"
            placeholder="Category name…"
            @keydown.enter.prevent="commitAddCategory"
            @keydown.escape.prevent="cancelAddCategory"
            @blur="commitAddCategory"
          />
        </template>
        <button v-else class="budget-empty-cta budget-empty-cta--ghost" @click="startAddCategory">
          <i class="pi pi-plus" /> Add Category
        </button>
      </div>
    </div>

    <!-- View transactions shortcut + view mode toggle -->
    <div v-if="!isMonthEmpty" class="budget-view-toggle-row">
      <button
        class="budget-view-tx-btn"
        @click="emit('viewTransactions', `${monthStore.activeYear}-${String(monthStore.activeMonth).padStart(2, '0')}`)"
      >
        <i class="pi pi-list" />
        View Transactions for {{ monthStore.label }}
      </button>
      <div class="budget-view-mode">
        <button class="budget-view-mode-btn" :class="{ 'budget-view-mode-btn--active': viewMode === 'budget' }"   @click="viewMode = 'budget'">Budget</button>
        <button class="budget-view-mode-btn" :class="{ 'budget-view-mode-btn--active': viewMode === 'actual' }" @click="viewMode = 'actual'">vs Actual</button>
        <button v-if="plannerStore.idealSimulation" class="budget-view-mode-btn" :class="{ 'budget-view-mode-btn--active': viewMode === 'ideal' }" @click="viewMode = 'ideal'">vs Ideal</button>
      </div>
    </div>

    <!-- Budget table -->
    <BudgetTable
      v-if="!isMonthEmpty && viewMode === 'budget'"
      :items="store.items"
      :availableToAdd="store.availableToAdd"
      @update="(item: BudgetItem) => { store.updateItem(item); toast.add({ severity: 'success', summary: 'Saved', detail: item.name + ' updated.', life: 2000 }) }"
      @reorder="(items: BudgetItem[]) => store.reorderItems(items)"
      @addItem="(name: string, category: string) => store.addItem(name, category)"
      @addExistingItem="(id: number, cat: string) => store.addExistingItem(id, cat)"
      @viewItemTransactions="(id: number, ym: string) => emit('viewItemTransactions', id, ym)"
      @deleteItem="handleDeleteItem"
      @deleteCategory="handleDeleteCategory"
    />

    <!-- Budget vs Ideal (planner simulation) -->
    <BudgetTable
      v-else-if="!isMonthEmpty && viewMode === 'ideal'"
      :items="store.items"
      :availableToAdd="store.availableToAdd"
      :idealMode="true"
      @update="(item: BudgetItem) => { store.updateItem(item); toast.add({ severity: 'success', summary: 'Saved', detail: item.name + ' updated.', life: 2000 }) }"
      @reorder="(items: BudgetItem[]) => store.reorderItems(items)"
      @addItem="(name: string, category: string) => store.addItem(name, category)"
      @addExistingItem="(id: number, cat: string) => store.addExistingItem(id, cat)"
      @viewItemTransactions="(id: number, ym: string) => emit('viewItemTransactions', id, ym)"
      @deleteItem="handleDeleteItem"
      @deleteCategory="handleDeleteCategory"
    />

    <!-- Budget vs Actual comparison table -->
    <div v-if="!isMonthEmpty && viewMode === 'actual'" class="bva-wrap">
      <table class="bva-table">
        <thead>
          <tr>
            <th class="bva-th-name">Item</th>
            <th class="bva-th-num">Assigned</th>
            <th class="bva-th-num">Actual</th>
            <th class="bva-th-num">Available</th>
            <th class="bva-th-bar">Usage</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="group in budgetRowsByCategory" :key="group.category">
            <!-- Category header row -->
            <tr class="bva-cat-row">
              <td class="bva-cat-name" colspan="5">{{ group.category }}</td>
            </tr>
            <!-- Item rows -->
            <tr v-for="row in group.rows" :key="row.id" class="bva-item-row">
              <td class="bva-item-name">{{ row.name }}</td>
              <td class="bva-num">{{ formatMoney(row.assigned) }}</td>
              <td class="bva-num">{{ formatMoney(row.activity) }}</td>
              <td class="bva-num" :class="row.available < 0 ? 'bva-over' : (row.assigned > 0 ? 'bva-ok' : '')">{{ formatMoney(row.available) }}</td>
              <td class="bva-bar-cell">
                <div class="bva-bar-wrap">
                  <div class="bva-bar" :style="{ width: Math.min(100, usagePct(row.assigned, row.activity)) + '%', background: usageColor(usagePct(row.assigned, row.activity)) }" />
                </div>
                <span class="bva-bar-pct" :class="usagePct(row.assigned, row.activity) >= 100 ? 'bva-over' : ''">{{ usagePct(row.assigned, row.activity) }}%</span>
              </td>
            </tr>
            <!-- Category subtotal -->
            <tr class="bva-subtotal-row">
              <td class="bva-subtotal-label">{{ group.category }} total</td>
              <td class="bva-num bva-subtotal-val">{{ formatMoney(group.assigned) }}</td>
              <td class="bva-num bva-subtotal-val">{{ formatMoney(group.activity) }}</td>
              <td class="bva-num bva-subtotal-val" :class="group.available < 0 ? 'bva-over' : 'bva-ok'">{{ formatMoney(group.available) }}</td>
              <td />
            </tr>
          </template>
        </tbody>
        <tfoot>
          <tr class="bva-total-row">
            <td class="bva-total-label">Total</td>
            <td class="bva-num bva-total-val">{{ formatMoney(budgetTotals.assigned) }}</td>
            <td class="bva-num bva-total-val">{{ formatMoney(budgetTotals.activity) }}</td>
            <td class="bva-num bva-total-val" :class="budgetTotals.available < 0 ? 'bva-over' : 'bva-ok'">{{ formatMoney(budgetTotals.available) }}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- Add category (budget mode only) -->
    <div v-if="!isMonthEmpty && viewMode === 'budget'" class="budget-add-category">
      <template v-if="addingCategory">
        <input
          ref="newCatInputRef"
          v-model="newCategoryName"
          class="budget-add-cat-input"
          placeholder="Category name…"
          @keydown.enter.prevent="commitAddCategory"
          @keydown.escape.prevent="cancelAddCategory"
          @blur="commitAddCategory"
        />
      </template>
      <button v-else class="budget-add-cat-btn" @click="startAddCategory">
        <i class="pi pi-plus" /> Add Category
      </button>
    </div>

    </div><!-- /budget-main -->

    <!-- Right panel: always visible when month has items -->
    <div v-if="!isMonthEmpty" class="budget-right-panel">

      <!-- Assign unassigned transactions -->
      <AssignPanel
        v-if="unassignedCount > 0"
        :year="monthStore.activeYear"
        :month="monthStore.activeMonth"
        @viewTransaction="(name, ym) => emit('viewTransaction', name, ym)"
      />

      <!-- Quick budget overview -->
      <div class="quick-funding-panel">
        <div class="quick-funding-header">
          <i class="pi pi-chart-bar" />
          Budget Overview
        </div>

        <!-- Budget status summary -->
        <div class="quick-funding-stats">
          <div class="quick-funding-stat quick-funding-stat--good" :class="{ 'quick-funding-stat--dim': onTargetCount === 0 }">
            <span class="quick-funding-stat-num">{{ onTargetCount }}</span>
            <span class="quick-funding-stat-lbl">on target</span>
          </div>
          <div class="quick-funding-stat quick-funding-stat--warn" :class="{ 'quick-funding-stat--dim': underBudgetRows.length === 0 }">
            <span class="quick-funding-stat-num">{{ underBudgetRows.length }}</span>
            <span class="quick-funding-stat-lbl">under budget · {{ formatMoney(totalUnderBudget) }}</span>
          </div>
          <div class="quick-funding-stat quick-funding-stat--danger" :class="{ 'quick-funding-stat--dim': overspentRows.length === 0 }">
            <span class="quick-funding-stat-num">{{ overspentRows.length }}</span>
            <span class="quick-funding-stat-lbl">overspent · {{ formatMoney(totalOverspent) }}</span>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="quick-funding-actions">
          <button
            class="quick-funding-btn quick-funding-btn--cover"
            :disabled="overspentRows.length === 0"
            title="Raise each overspent item's budget to match its actual spending"
            @click="absorbOverspend"
          >
            <i class="pi pi-arrow-up" />
            Absorb Overspend
          </button>
        </div>
      </div>

    </div><!-- /budget-right-panel -->

    </div><!-- /budget-layout -->
  </div><!-- /custom-tabs -->
</template>

