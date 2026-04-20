<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue'
import { useBudgetStore } from '../stores/budgetStore'
import { useTransactionStore } from '../stores/transactionStore'
import { useMonthStore } from '../stores/monthStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useAccountStore } from '../stores/accountStore'
import type { BudgetItem, BudgetRow } from '../types/budget'
import { useToast } from 'primevue/usetoast'
import { getTodayStr } from '../utils/date'
import Toast from 'primevue/toast'
import BudgetTable from './BudgetTable.vue'
import AssignPanel from './AssignPanel.vue'
import { useConfirm } from '../composables/useConfirm'

const store        = useBudgetStore()
const txStore      = useTransactionStore()
const monthStore   = useMonthStore()
const settings     = useSettingsStore()
const accountStore = useAccountStore()
const toast        = useToast()
const { confirm }  = useConfirm()

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
}>()

const totalFundsAvailable = computed(() => txStore.totalFunds)

const monthlyNet = computed(() =>
  txStore.transactions
    .filter(t => monthStore.matchesActive(t.date))
    .reduce((sum, t) => sum + (t.type === 'in' ? t.amount : -t.amount), 0)
)

const unassignedActivity = computed(() =>
  txStore.getUnassignedActivity(monthStore.activeYear, monthStore.activeMonth)
)

const unassignedCount = computed(() =>
  txStore.transactions.filter(t => {
    if (t.itemId !== null) return false
    const [y, m] = t.date.split('-').map(Number)
    return y === monthStore.activeYear && m === monthStore.activeMonth
  }).length
)

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
const budgetRows = computed<BudgetRow[]>(() =>
  store.items.map(i => {
    const activity  = txStore.getItemActivity(i.id, monthStore.activeYear, monthStore.activeMonth)
    const available = Math.round((i.assigned - activity) * 100) / 100
    return { ...i, activity, available }
  })
)

const overspentRows  = computed(() => budgetRows.value.filter(r => r.available < 0))
const fundableRows   = computed(() => budgetRows.value.filter(r => r.available > 0))
const fullyFundedCount = computed(() => budgetRows.value.filter(r => r.available === 0).length)
const totalOverspent = computed(() =>
  Math.round(overspentRows.value.reduce((s, r) => s + Math.abs(r.available), 0) * 100) / 100
)
const totalFundable  = computed(() =>
  Math.round(fundableRows.value.reduce((s, r) => s + r.available, 0) * 100) / 100
)

// ── Budget vs Actual ──────────────────────────────────────────
const viewMode = ref<'budget' | 'actual'>('budget')

const budgetRowsByCategory = computed(() => {
  const groups = new Map<string, { rows: BudgetRow[]; assigned: number; activity: number; available: number }>()
  for (const row of budgetRows.value) {
    const cat = row.category || 'Uncategorised'
    if (!groups.has(cat)) groups.set(cat, { rows: [], assigned: 0, activity: 0, available: 0 })
    const g = groups.get(cat)!
    g.rows.push(row)
    g.assigned   = Math.round((g.assigned  + row.assigned)  * 100) / 100
    g.activity   = Math.round((g.activity  + row.activity)  * 100) / 100
    g.available  = Math.round((g.available + row.available) * 100) / 100
  }
  return [...groups.entries()].map(([category, g]) => ({ category, ...g }))
})

const budgetTotals = computed(() => ({
  assigned:  Math.round(budgetRows.value.reduce((s, r) => s + r.assigned,  0) * 100) / 100,
  activity:  Math.round(budgetRows.value.reduce((s, r) => s + r.activity,  0) * 100) / 100,
  available: Math.round(budgetRows.value.reduce((s, r) => s + r.available, 0) * 100) / 100,
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

const fundingAccountId = ref(accountStore.accounts[0]?.id ?? '')

// Keep in sync if accounts change
watch(() => accountStore.accounts, (accs) => {
  if (!fundingAccountId.value && accs.length > 0) fundingAccountId.value = accs[0].id
}, { immediate: true })

function coverOverspent(): void {
  const rows = [...overspentRows.value]
  if (!fundingAccountId.value || rows.length === 0) return
  for (const row of rows) {
    txStore.addTransaction({
      name:      `Refund: ${row.name}`,
      date:      getTodayStr(),
      type:      'in',
      amount:    Math.abs(row.available),
      itemId:    null,
      accountId: fundingAccountId.value,
    })
  }
  toast.add({ severity: 'warn', summary: 'Overspend covered', detail: `${rows.length} item${rows.length !== 1 ? 's' : ''} covered.`, life: 3000 })
}

function fundFully(): void {
  const rows = [...fundableRows.value]
  if (!fundingAccountId.value || rows.length === 0) return
  const ym = `${monthStore.activeYear}-${String(monthStore.activeMonth).padStart(2, '0')}`
  for (const row of rows) {
    txStore.addTransaction({
      name:      `Budget: ${row.name}`,
      date:      `${ym}-01`,
      type:      'out',
      amount:    row.available,
      itemId:    row.id,
      accountId: fundingAccountId.value,
    })
  }
  toast.add({ severity: 'success', summary: 'Funded', detail: `${rows.length} item${rows.length !== 1 ? 's' : ''} fully funded.`, life: 3000 })
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

function fundPartially(): void {
  const rows = [...fundableRows.value]
  if (!fundingAccountId.value || rows.length === 0) return
  let remaining = totalFundsAvailable.value
  if (remaining <= 0) return
  const total = totalFundable.value
  const ym    = `${monthStore.activeYear}-${String(monthStore.activeMonth).padStart(2, '0')}`
  for (const row of rows) {
    if (remaining <= 0) break
    const share  = total > 0 ? row.available / total : 1 / rows.length
    const amount = Math.min(row.available, Math.round(remaining * share * 100) / 100)
    if (amount <= 0) continue
    txStore.addTransaction({
      name:      `Budget: ${row.name}`,
      date:      `${ym}-01`,
      type:      'out',
      amount,
      itemId:    row.id,
      accountId: fundingAccountId.value,
    })
    remaining -= amount
  }
  toast.add({ severity: 'info', summary: 'Partially funded', detail: `Available funds distributed across ${rows.length} item${rows.length !== 1 ? 's' : ''}.`, life: 3000 })
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
      />

      <!-- YNAB-style quick funding -->
      <div class="quick-funding-panel">
        <div class="quick-funding-header">
          <i class="pi pi-bolt" />
          Quick Funding
        </div>

        <!-- Account selector -->
        <div class="quick-funding-field">
          <label class="quick-funding-label">From account</label>
          <select v-model="fundingAccountId" class="quick-funding-select">
            <option v-if="accountStore.accounts.length === 0" value="" disabled>No accounts — add one first</option>
            <option v-for="acc in accountStore.accounts" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
          </select>
        </div>

        <!-- Budget status summary -->
        <div class="quick-funding-stats">
          <div class="quick-funding-stat quick-funding-stat--good">
            <span class="quick-funding-stat-num">{{ fullyFundedCount }}</span>
            <span class="quick-funding-stat-lbl">on target</span>
          </div>
          <div class="quick-funding-stat quick-funding-stat--warn" :class="{ 'quick-funding-stat--dim': fundableRows.length === 0 }">
            <span class="quick-funding-stat-num">{{ fundableRows.length }}</span>
            <span class="quick-funding-stat-lbl">available · {{ formatMoney(totalFundable) }}</span>
          </div>
          <div class="quick-funding-stat quick-funding-stat--danger" :class="{ 'quick-funding-stat--dim': overspentRows.length === 0 }">
            <span class="quick-funding-stat-num">{{ overspentRows.length }}</span>
            <span class="quick-funding-stat-lbl">overspent · {{ formatMoney(totalOverspent) }}</span>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="quick-funding-actions">
          <button
            class="quick-funding-btn quick-funding-btn--fund"
            :disabled="fundableRows.length === 0 || !fundingAccountId || totalFundsAvailable < totalFundable"
            :title="totalFundsAvailable < totalFundable ? 'Not enough funds — use Fund Partially instead' : 'Commit full available budget for every item'"
            @click="fundFully"
          >
            <i class="pi pi-send" />
            Fund Fully
          </button>
          <button
            class="quick-funding-btn quick-funding-btn--partial"
            :disabled="fundableRows.length === 0 || !fundingAccountId || totalFundsAvailable <= 0"
            title="Distribute available funds proportionally across all items"
            @click="fundPartially"
          >
            <i class="pi pi-circle-fill" />
            Fund Partially
          </button>
          <button
            class="quick-funding-btn quick-funding-btn--cover"
            :disabled="overspentRows.length === 0 || !fundingAccountId"
            title="Create refund transactions to balance all overspent items"
            @click="coverOverspent"
          >
            <i class="pi pi-arrow-circle-up" />
            Cover Overspent
          </button>
        </div>

        <p class="quick-funding-hint">
          Total funds: <strong :class="totalFundsAvailable >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(totalFundsAvailable) }}</strong>
        </p>
      </div>

    </div><!-- /budget-right-panel -->

    </div><!-- /budget-layout -->
  </div><!-- /custom-tabs -->
</template>

