<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useTransactionStore } from '../stores/transactionStore'
import { useAccountStore } from '../stores/accountStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { Transaction } from '../types/transaction'

const emit = defineEmits<{
  viewTransaction: [tx: Transaction]
}>()

const txStore = useTransactionStore()
const acctStore = useAccountStore()
const settings = useSettingsStore()

const query = ref('')
const focused = ref(false)
const activeIdx = ref(-1)
const inputRef = ref<HTMLInputElement | null>(null)
const dropdownRef = ref<HTMLElement | null>(null)

const MAX_RESULTS = 8

const results = computed<Transaction[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (q.length < 2) return []
  return txStore.transactions
    .filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.notes ?? '').toLowerCase().includes(q)
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_RESULTS)
})

const showDropdown = computed(() => focused.value && query.value.trim().length >= 2)

watch(results, () => { activeIdx.value = -1 })

function accountName(accountId: string | null): string {
  if (!accountId) return ''
  return acctStore.accounts.find(a => a.id === accountId)?.name ?? accountId
}

function formatDate(d: string): string {
  return settings.formatDate(d)
}

function formatAmount(tx: Transaction): string {
  const sign = tx.type === 'in' ? '+' : '-'
  return `${sign}${settings.formatMoney(tx.amount)}`
}

function selectResult(tx: Transaction): void {
  emit('viewTransaction', tx)
  query.value = ''
  focused.value = false
  inputRef.value?.blur()
}

function onKeydown(e: KeyboardEvent): void {
  if (!showDropdown.value) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIdx.value = Math.min(activeIdx.value + 1, results.value.length - 1)
    scrollActiveIntoView()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIdx.value = Math.max(activeIdx.value - 1, -1)
    scrollActiveIntoView()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (activeIdx.value >= 0 && results.value[activeIdx.value]) {
      selectResult(results.value[activeIdx.value])
    }
  } else if (e.key === 'Escape') {
    query.value = ''
    focused.value = false
    inputRef.value?.blur()
  }
}

function scrollActiveIntoView(): void {
  nextTick(() => {
    const el = dropdownRef.value?.querySelector(`[data-idx="${activeIdx.value}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  })
}

// Close dropdown on outside click
function onDocClick(e: MouseEvent): void {
  const target = e.target as Node
  if (!dropdownRef.value?.contains(target) && !inputRef.value?.contains(target)) {
    focused.value = false
  }
}
onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))

// Highlight matching substring
function highlight(text: string): string {
  const q = query.value.trim()
  if (!q) return escapeHtml(text)
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) return escapeHtml(text)
  return (
    escapeHtml(text.slice(0, idx)) +
    `<mark class="gs-mark">${escapeHtml(text.slice(idx, idx + q.length))}</mark>` +
    escapeHtml(text.slice(idx + q.length))
  )
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
</script>

<template>
  <div class="gs-wrap">
    <div class="gs-input-row">
      <i class="pi pi-search gs-icon" />
      <input
        ref="inputRef"
        v-model="query"
        type="text"
        class="gs-input"
        placeholder="Search transactions…"
        autocomplete="off"
        @focus="focused = true"
        @keydown="onKeydown"
      />
      <button v-if="query" class="gs-clear" @mousedown.prevent @click="query = ''" aria-label="Clear">
        <i class="pi pi-times" />
      </button>
    </div>

    <!-- Dropdown -->
    <div v-if="showDropdown" ref="dropdownRef" class="gs-dropdown">
      <template v-if="results.length">
        <button
          v-for="(tx, i) in results"
          :key="tx.id"
          :data-idx="i"
          :class="['gs-result', i === activeIdx ? 'gs-result--active' : '']"
          @mousedown.prevent
          @click="selectResult(tx)"
        >
          <span :class="['gs-result-icon', tx.type === 'in' ? 'gs-result-icon--in' : 'gs-result-icon--out']">
            <i :class="tx.type === 'in' ? 'pi pi-arrow-down-left' : 'pi pi-arrow-up-right'" />
          </span>
          <span class="gs-result-body">
            <span class="gs-result-name" v-html="highlight(tx.name)" />
            <span v-if="tx.notes" class="gs-result-notes" v-html="highlight(tx.notes)" />
          </span>
          <span class="gs-result-meta">
            <span :class="['gs-result-amount', tx.type === 'in' ? 'gs-result-amount--in' : 'gs-result-amount--out']">
              {{ formatAmount(tx) }}
            </span>
            <span class="gs-result-date">{{ formatDate(tx.date) }}</span>
            <span v-if="accountName(tx.accountId)" class="gs-result-acct">{{ accountName(tx.accountId) }}</span>
          </span>
        </button>
      </template>
      <div v-else class="gs-no-results">
        <i class="pi pi-search-minus" />
        No transactions match "{{ query.trim() }}"
      </div>
    </div>
  </div>
</template>
