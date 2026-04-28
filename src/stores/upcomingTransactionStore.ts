import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { useSettingsStore } from './settingsStore'
import { storageKey, loadStored } from '../utils/storeStorage'
import type { UpcomingTransaction } from '../types/transaction'

let _nextId = 1

/** Advance a YYYY-MM-DD date by one recurrence period. */
function _nextDate(date: string, period: NonNullable<UpcomingTransaction['recurring']>): string {
  const d = new Date(date + 'T00:00:00')
  if (period === 'weekly')  d.setDate(d.getDate() + 7)
  if (period === 'monthly') d.setMonth(d.getMonth() + 1)
  if (period === 'yearly')  d.setFullYear(d.getFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

export const useUpcomingTransactionStore = defineStore('upcomingTransactions', () => {
  const settings = useSettingsStore()

  function _key(): string { return storageKey('clearbook_upcoming', settings.country) }
  function _load() { return loadStored('clearbook_upcoming', settings.country) }

  const _saved = _load()

  const items = ref<UpcomingTransaction[]>(_saved?.items ?? [])
  if (_saved?.nextId != null) _nextId = _saved.nextId

  watch(items, () => {
    localStorage.setItem(_key(), JSON.stringify({ items: items.value, nextId: _nextId }))
  }, { deep: true })

  // Reload when country changes
  watch(() => settings.country, (newCountry) => {
    if (!newCountry) return
    const saved = _load()
    _nextId     = saved?.nextId ?? 1
    items.value = saved?.items  ?? []
  })

  function addItem(data: Omit<UpcomingTransaction, 'id' | 'createdAt'>): void {
    items.value.push({
      ...data,
      id:        _nextId++,
      createdAt: new Date().toISOString(),
    })
  }

  function updateItem(id: number, fields: Partial<Omit<UpcomingTransaction, 'id' | 'createdAt'>>): void {
    const idx = items.value.findIndex(i => i.id === id)
    if (idx !== -1) {
      items.value[idx] = { ...items.value[idx], ...fields }
    }
  }

  function deleteItem(id: number): void {
    items.value = items.value.filter(i => i.id !== id)
  }

  /**
   * Mark an upcoming transaction as done. If it is recurring, a new occurrence
   * is automatically created at the next date in the series.
   */
  function markDone(id: number, linkedTransactionId?: number): void {
    updateItem(id, { done: true, linkedTransactionId })
    const item = items.value.find(i => i.id === id)
    if (item?.recurring) {
      addItem({
        title:     item.title,
        amount:    item.amount,
        type:      item.type,
        date:      _nextDate(item.date, item.recurring),
        notes:     item.notes,
        done:      false,
        recurring: item.recurring,
      })
    }
  }

  /** Pending (not done) upcoming transactions sorted by date ascending. */
  const pending = computed(() =>
    items.value
      .filter(i => !i.done)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
  )

  return { items, pending, addItem, updateItem, deleteItem, markDone }
})
