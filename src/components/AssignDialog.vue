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
      <div v-if="visible" class="assign-dialog-backdrop" :class="{ dark: settings.theme === 'dark' }" @click.self="emit('close')">
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

<style>
/* ── Backdrop & dialog ───────────────────────────────────────── */
.assign-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.assign-dialog {
  background: #ffffff;
  color: #18181b;
  width: 100%;
  max-width: 28rem;
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0;
  box-shadow: 0 20px 60px rgba(0,0,0,0.35);
}

.dark .assign-dialog {
  background: #1c1c1e;
  color: #f4f4f5;
}

/* ── Transition ─────────────────────────────────────────────── */
.assign-dialog-fade-enter-active,
.assign-dialog-fade-leave-active {
  transition: opacity 0.18s ease;
}
.assign-dialog-fade-enter-from,
.assign-dialog-fade-leave-to {
  opacity: 0;
}
.assign-dialog-fade-enter-active .assign-dialog,
.assign-dialog-fade-leave-active .assign-dialog {
  transition: transform 0.18s ease;
}
.assign-dialog-fade-enter-from .assign-dialog,
.assign-dialog-fade-leave-to .assign-dialog {
  transform: translateY(12px);
}
</style>
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.assign-dialog {
  background: #ffffff;
  color: #18181b;
  width: 100%;
  max-width: 28rem;
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0;
  box-shadow: 0 20px 60px rgba(0,0,0,0.35);
}

.dark .assign-dialog {
  background: #1c1c1e;
  color: #f4f4f5;
}

/* ── Transition ─────────────────────────────────────────────── */
.assign-dialog-fade-enter-active,
.assign-dialog-fade-leave-active {
  transition: opacity 0.18s ease;
}
.assign-dialog-fade-enter-from,
.assign-dialog-fade-leave-to {
  opacity: 0;
}
.assign-dialog-fade-enter-active .assign-dialog,
.assign-dialog-fade-leave-active .assign-dialog {
  transition: transform 0.18s ease;
}
.assign-dialog-fade-enter-from .assign-dialog,
.assign-dialog-fade-leave-to .assign-dialog {
  transform: translateY(12px);
}

/* ── Header ─────────────────────────────────────────────────── */
.assign-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 1rem 0.75rem;
  border-bottom: 2px solid #e4e4e7;
  flex-shrink: 0;
}

.dark .assign-dialog-header {
  border-bottom-color: #3f3f46;
}

.assign-dialog-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.assign-dialog-month {
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  font-size: 0.75rem;
  color: #71717a;
  margin-left: 0.2rem;
}

.dark .assign-dialog-month {
  color: #a1a1aa;
}

.assign-dialog-close {
  background: none;
  border: none;
  cursor: pointer;
  color: #71717a;
  font-size: 0.85rem;
  padding: 0.3rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.1s;
}
.assign-dialog-close:hover { color: #18181b; }
.dark .assign-dialog-close:hover { color: #f4f4f5; }

/* ── Progress ───────────────────────────────────────────────── */
.assign-dialog-progress-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 1rem 0.5rem;
  border-bottom: 1px solid #e4e4e7;
}

.dark .assign-dialog-progress-row {
  border-bottom-color: #3f3f46;
}

.assign-dialog-progress-label {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #71717a;
  white-space: nowrap;
}

.dark .assign-dialog-progress-label {
  color: #a1a1aa;
}

.assign-dialog-progress-bar-wrap {
  flex: 1;
  height: 4px;
  background: #e4e4e7;
}

.dark .assign-dialog-progress-bar-wrap {
  background: #3f3f46;
}

.assign-dialog-progress-bar {
  height: 100%;
  background: #3b82f6;
  transition: width 0.25s ease;
}

/* ── Transaction card ───────────────────────────────────────── */
.assign-tx-card {
  padding: 1rem 1rem 0.85rem;
  border-bottom: 1px solid #e4e4e7;
  background: #f4f4f5;
}

.dark .assign-tx-card {
  background: #27272a;
  border-bottom-color: #3f3f46;
}

.assign-tx-name {
  font-size: 0.95rem;
  font-weight: 700;
  margin-bottom: 0.45rem;
  word-break: break-word;
}

.assign-tx-meta {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex-wrap: wrap;
}

.assign-tx-date {
  font-size: 0.7rem;
  color: #71717a;
}

.dark .assign-tx-date {
  color: #a1a1aa;
}

.assign-tx-amount {
  font-size: 0.9rem;
  font-weight: 700;
  font-family: monospace;
}

.assign-tx-type-badge {
  font-size: 0.6rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0.1rem 0.4rem;
  border-radius: 2px;
}

.badge-in {
  background: #dcfce7;
  color: #166534;
}

.badge-out {
  background: #fee2e2;
  color: #991b1b;
}

.dark .badge-in {
  background: #14532d;
  color: #86efac;
}

.dark .badge-out {
  background: #450a0a;
  color: #fca5a5;
}

/* ── Suggestions ────────────────────────────────────────────── */
.assign-suggestions-label {
  padding: 0.65rem 1rem 0.35rem;
  font-size: 0.6rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #71717a;
}

.dark .assign-suggestions-label {
  color: #a1a1aa;
}

.assign-suggestions-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
  padding: 0 1rem 0.75rem;
}

.assign-suggestion-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  padding: 0.55rem 0.7rem;
  background: none;
  border: 2px solid #d4d4d8;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.12s, background-color 0.12s;
}

.assign-suggestion-btn:hover {
  border-color: #3b82f6;
  background-color: #eff6ff;
}

.dark .assign-suggestion-btn {
  border-color: #52525b;
}

.dark .assign-suggestion-btn:hover {
  border-color: #3b82f6;
  background-color: #1e3a5f;
}

.assign-suggestion-name {
  font-size: 0.75rem;
  font-weight: 700;
  color: #18181b;
  line-height: 1.2;
}

.dark .assign-suggestion-name {
  color: #f4f4f5;
}

.assign-suggestion-cat {
  font-size: 0.6rem;
  color: #71717a;
  font-weight: 500;
}

.dark .assign-suggestion-cat {
  color: #a1a1aa;
}

/* ── Browse all ─────────────────────────────────────────────── */
.assign-browse-row {
  padding: 0.5rem 1rem 0.75rem;
  border-top: 1px solid #e4e4e7;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.dark .assign-browse-row {
  border-top-color: #3f3f46;
}

.assign-browse-label {
  font-size: 0.6rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #71717a;
}

.dark .assign-browse-label {
  color: #a1a1aa;
}

.assign-browse-controls {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.assign-browse-select {
  flex: 1;
  font-size: 0.75rem;
  padding: 0.3rem 0.45rem;
  border: 2px solid #d4d4d8;
  background: #ffffff;
  color: #18181b;
  outline: none;
  cursor: pointer;
}

.dark .assign-browse-select {
  background: #3f3f46;
  color: #f4f4f5;
  border-color: #52525b;
}

.assign-browse-apply-btn {
  font-size: 0.7rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0.3rem 0.8rem;
  background: #18181b;
  color: #f4f4f5;
  border: none;
  cursor: pointer;
  transition: background-color 0.12s;
  white-space: nowrap;
}

.assign-browse-apply-btn:hover:not(:disabled) {
  background: #3f3f46;
}

.assign-browse-apply-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.dark .assign-browse-apply-btn {
  background: #e4e4e7;
  color: #18181b;
}

.dark .assign-browse-apply-btn:hover:not(:disabled) {
  background: #f4f4f5;
}

/* ── Nav row ─────────────────────────────────────────────────── */
.assign-nav-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.65rem 1rem;
  border-top: 2px solid #e4e4e7;
}

.dark .assign-nav-row {
  border-top-color: #3f3f46;
}

.assign-nav-btn,
.assign-skip-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.65rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  padding: 0.3rem 0.75rem;
  border: 2px solid #d4d4d8;
  background: none;
  color: #52525b;
  cursor: pointer;
  transition: border-color 0.12s, background-color 0.12s;
}

.assign-nav-btn:hover:not(:disabled),
.assign-skip-btn:hover:not(:disabled) {
  border-color: #a1a1aa;
  background: #f4f4f5;
}

.dark .assign-nav-btn,
.dark .assign-skip-btn {
  border-color: #52525b;
  color: #a1a1aa;
}

.dark .assign-nav-btn:hover:not(:disabled),
.dark .assign-skip-btn:hover:not(:disabled) {
  background: #27272a;
  border-color: #71717a;
}

.assign-nav-btn:disabled,
.assign-skip-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

/* ── All done state ─────────────────────────────────────────── */
.assign-dialog-done {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2.5rem 1.5rem;
  gap: 0.65rem;
  text-align: center;
}

.assign-dialog-done-icon {
  font-size: 2.5rem;
  color: #22c55e;
}

.assign-dialog-done-title {
  font-size: 1rem;
  font-weight: 900;
}

.assign-dialog-done-sub {
  font-size: 0.8rem;
  color: #71717a;
}

.dark .assign-dialog-done-sub {
  color: #a1a1aa;
}

.assign-dialog-done-btn {
  margin-top: 0.75rem;
  font-size: 0.7rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  padding: 0.4rem 1.5rem;
  background: #18181b;
  color: #f4f4f5;
  border: none;
  cursor: pointer;
  transition: background-color 0.12s;
}

.assign-dialog-done-btn:hover {
  background: #3f3f46;
}

.dark .assign-dialog-done-btn {
  background: #e4e4e7;
  color: #18181b;
}

.dark .assign-dialog-done-btn:hover {
  background: #f4f4f5;
}
</style>
