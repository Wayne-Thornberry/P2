import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { loadCountryScoped, useCountryScopedPersistence } from './useCountryScopedPersistence'
import type { UpcomingTransaction } from '../types/transaction'

let _nextId = 1

export const useUpcomingTransactionStore = defineStore('upcomingTransactions', () => {
  const _saved = loadCountryScoped('clearbook_upcoming')

  const items = ref<UpcomingTransaction[]>(_saved?.items ?? [])
  if (_saved?.nextId != null) _nextId = _saved.nextId

  useCountryScopedPersistence('clearbook_upcoming', {
    sources: items,
    toBlob: () => ({ items: items.value, nextId: _nextId }),
    reload: (s) => { _nextId = s?.nextId ?? 1; items.value = s?.items ?? [] },
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

  function markDone(id: number, linkedTransactionId?: number): void {
    updateItem(id, { done: true, linkedTransactionId })
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
