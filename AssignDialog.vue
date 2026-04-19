<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Transaction } from '../types/transaction'
import type { BudgetItem } from '../types/budget'
import { useTransactionStore } from '../stores/transactionStore'
import { useBudgetStore } from '../stores/budgetStore'
import { useMonthStore } from '../stores/monthStore'
import { useSettingsStore } from '../stores/settingsStore'
import { suggestTopItems } from '../utils/autoCategory'

const props = defineProps<{
  visible: boolean
  year: number
  month: number
}>()

const emit = defineEmits<{
  close: []
}>()

const txStore     = useTransactionStore()
const budgetStore = useBudgetStore()
const monthStore  = useMonthStore()
const settings    = useSettingsStore()

// ── Unassigned list for this month ────────────────────────────
const unassigned = computed<Transaction[]>(() =>
  txStore.transactions.filter(t => {
    if (t.itemId !== null) return false
    const [y, m] = t.date.split('-').map(Number)
    return y === props.year && m === props.month
  })
)

// ── Current index ─────────────────────────────────────────────
const index = ref(0)
const current = computed<Transaction | null>(() => unassigned.value[index.value] ?? null)

// Reset index when dialog opens or list changes
watch(() => props.visible, (v) => { if (v) index.value = 0 })
watch(unassigned, () => {
  // If list shrinks (because we just assigned one), stay clamped
  if (index.value >= unassigned.value.length) {
    index.value = Math.max(0, unassigned.value.length - 1)
  }
})

// ── Suggestions ────────────────────────────────────────────────
const TOP_N_SUGGESTIONS = 6

const suggestions = computed<BudgetItem[]>(() => {
  if (!current.value) return []
  return suggestTopItems(current.value.name, budgetStore.items, TOP_N_SUGGESTIONS)
})

// ── All items grouped for the "browse all" dropdown ───────────
const allCategories = computed<string[]>(() => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of budgetStore.items) {
    if (!seen.has(item.category)) { seen.add(item.category); result.push(item.category) }
  }
  return result
})

function itemsInCategory(cat: string): BudgetItem[] {
  return budgetStore.items.filter(i => i.category === cat)
}

const browseItemId = ref<string>('')

// ── Actions ────────────────────────────────────────────────────
function assign(itemId: number): void {
  const tx = current.value
  if (!tx) return
  txStore.updateTransaction(tx.id, {
    name:      tx.name,
    date:      tx.date,
    type:      tx.type,
    amount:    tx.amount,
    itemId,
    accountId: tx.accountId,
  })
  browseItemId.value = ''
  // index stays the same — the assigned tx is removed from list,
  // so the next unassigned one slides into that slot automatically
}

function assignFromBrowse(): void {
  if (!browseItemId.value) return
  assign(parseInt(browseItemId.value))
}

function skip(): void {
  index.value = Math.min(index.value + 1, unassigned.value.length - 1)
  browseItemId.value = ''
}

function prev(): void {
  index.value = Math.max(0, index.value - 1)
  browseItemId.value = ''
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
  return total === 0 ? 100 : Math.round(((index.value) / total) * 100)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="assign-dialog-fade">
      <div v-if="visible" class="assign-dialog-backdrop" :class="{ dark: ['dark','midnight','forest','purple'].includes(settings.theme), 'theme-midnight': settings.theme === 'midnight', 'theme-forest': settings.theme === 'forest', 'theme-purple': settings.theme === 'purple' }" @click.self="emit('close')">
        <div class="assign-dialog" role="dialog" aria-modal="true">

          <!-- Header -->
          <div class="assign-dialog-header">
            <div class="assign-dialog-title">
              <i class="pi pi-tag" />
              Assign Transactions
              <span class="assign-dialog-month">{{ monthLabel }}</span>
            </div>
            <button class="assign-dialog-close" @click="emit('close')" title="Close">
              <i class="pi pi-times" />
            </button>
          </div>

          <!-- All done -->
          <div v-if="unassigned.length === 0" class="assign-dialog-done">
            <i class="pi pi-check-circle assign-dialog-done-icon" />
            <p class="assign-dialog-done-title">All caught up!</p>
            <p class="assign-dialog-done-sub">Every transaction for {{ monthLabel }} has been assigned.</p>
            <button class="assign-dialog-done-btn" @click="emit('close')">Close</button>
          </div>

          <!-- Active review -->
          <template v-else>

            <!-- Progress row -->
            <div class="assign-dialog-progress-row">
              <span class="assign-dialog-progress-label">
                {{ index + 1 }} of {{ unassigned.length }} unassigned
              </span>
              <div class="assign-dialog-progress-bar-wrap">
                <div class="assign-dialog-progress-bar" :style="{ width: progress + '%' }" />
              </div>
            </div>

            <!-- Transaction card -->
            <div v-if="current" class="assign-tx-card">
              <div class="assign-tx-name">{{ current.name }}</div>
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
            </div>

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

            <!-- Browse all divider -->
            <div class="assign-browse-row">
              <span class="assign-browse-label">Or choose from all items</span>
              <div class="assign-browse-controls">
                <select v-model="browseItemId" class="assign-browse-select">
                  <option value="">Select an item…</option>
                  <optgroup v-for="cat in allCategories" :key="cat" :label="cat">
                    <option
                      v-for="item in itemsInCategory(cat)"
                      :key="item.id"
                      :value="String(item.id)"
                    >
                      {{ item.name }}
                    </option>
                  </optgroup>
                </select>
                <button
                  class="assign-browse-apply-btn"
                  :disabled="!browseItemId"
                  @click="assignFromBrowse"
                >
                  Assign
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
      </div>
    </Transition>
  </Teleport>
</template>
