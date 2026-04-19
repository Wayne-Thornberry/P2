<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
import { useBudgetStore } from '../stores/budgetStore'
import { useTransactionStore } from '../stores/transactionStore'
import { useMonthStore } from '../stores/monthStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { BudgetItem } from '../types/budget'
import { useToast } from 'primevue/usetoast'
import Toast from 'primevue/toast'
import BudgetTable from './BudgetTable.vue'
import AssignPanel from './AssignPanel.vue'

const store      = useBudgetStore()
const txStore    = useTransactionStore()
const monthStore = useMonthStore()
const settings   = useSettingsStore()
const toast      = useToast()

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

function handlePopulateTemplate(): void {
  if (!isMonthEmpty.value) {
    if (!confirm(`This will replace all ${store.items.length} item(s) for ${monthStore.label} with the default template. Continue?`)) return
  }
  store.populateFromTemplate()
  toast.add({ severity: 'success', summary: 'Template applied', detail: `Budget populated for ${monthStore.label}.`, life: 3000 })
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
  txStore.getUnassignedActivity()
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
</script>

<template>
  <div class="custom-tabs">
    <Toast />
    <div class="budget-layout">
    <div class="budget-main">

    <!-- Monthly funds card -->
    <button class="budget-funds-card" @click="emit('navigate', 'accounts')">
      <div class="budget-funds-card-top">
        <span class="budget-funds-card-label">
          <i class="pi pi-credit-card" />
          Total Funds Available
        </span>
      </div>
      <div class="budget-funds-card-amount" :class="Math.round(totalFundsAvailable * 100) >= 0 ? 'money-positive' : 'money-negative'">
        {{ formatMoney(totalFundsAvailable) }}
      </div>
      <div class="budget-funds-card-unassigned">
        <i class="pi pi-exclamation-circle" />
        Unassigned: {{ formatMoney(unassignedActivity) }}
      </div>
      <div class="budget-funds-card-sub">Running balance across all accounts · <span class="budget-funds-card-hint">View Accounts <i class="pi pi-arrow-right" /></span></div>
      <div class="budget-funds-card-net">
        {{ monthStore.label }} net:
        <span :class="Math.round(monthlyNet * 100) >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(monthlyNet) }}</span>
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
      <button
        class="budget-template-btn"
        :title="isMonthEmpty ? 'Populate budget from template' : 'Reset to template'"
        @click="handlePopulateTemplate"
      >
        <i class="pi pi-table" />
        {{ isMonthEmpty ? 'From Template' : 'Reset Template' }}
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
      <button class="budget-empty-cta" @click="handlePopulateTemplate">
        <i class="pi pi-check" /> Populate from template
      </button>
    </div>

    <!-- View transactions shortcut -->
    <button
      class="budget-view-tx-btn"
      @click="emit('viewTransactions', `${monthStore.activeYear}-${String(monthStore.activeMonth).padStart(2, '0')}`)"
    >
      <i class="pi pi-list" />
      View Transactions for {{ monthStore.label }}
    </button>

    <!-- Budget table -->
    <BudgetTable
      :items="store.items"
      :availableToAdd="store.availableToAdd"
      @update="(item: BudgetItem) => { store.updateItem(item); toast.add({ severity: 'success', summary: 'Saved', detail: item.name + ' updated.', life: 2000 }) }"
      @reorder="(items: BudgetItem[]) => store.reorderItems(items)"
      @addItem="(name: string, category: string) => store.addItem(name, category)"
      @addExistingItem="(id: number, cat: string) => store.addExistingItem(id, cat)"
      @viewItemTransactions="(id: number, ym: string) => emit('viewItemTransactions', id, ym)"
    />

    <!-- Add category -->
    <div class="budget-add-category">
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

    <!-- Right panel: Assign transactions -->
    <div v-if="unassignedCount > 0" class="budget-right-panel">
      <AssignPanel
        :year="monthStore.activeYear"
        :month="monthStore.activeMonth"
      />
    </div>

    </div><!-- /budget-layout -->
  </div>
</template>

