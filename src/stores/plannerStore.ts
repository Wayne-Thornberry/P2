import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useSettingsStore } from './settingsStore'
import { storageKey, loadStored } from '../utils/storeStorage'

// ── Types ──────────────────────────────────────────────────────
export interface PlannerItem {
  id:     number
  name:   string
  amount: number   // always a positive value; treated as a deduction from income
}

let _nextId = 1

// ── Store ──────────────────────────────────────────────────────
export const usePlannerStore = defineStore('planner', () => {
  const settings = useSettingsStore()

  function _key(): string { return storageKey('clearbook_planner', settings.country) }
  function _load() { return loadStored('clearbook_planner', settings.country) }

  const _saved = _load()

  const income = ref<number>(_saved?.income ?? 0)
  const items  = ref<PlannerItem[]>(_saved?.items ?? [])
  if (_saved?.nextId != null) _nextId = _saved.nextId

  function _persist(): void {
    localStorage.setItem(_key(), JSON.stringify({
      income: income.value,
      items:  items.value,
      nextId: _nextId,
    }))
  }

  watch([income, items], _persist, { deep: true })

  // Reload when country changes
  watch(() => settings.country, () => {
    const saved = _load()
    _nextId       = saved?.nextId ?? 1
    income.value  = saved?.income ?? 0
    items.value   = saved?.items  ?? []
  })

  // ── Actions ────────────────────────────────────────────────
  function addItem(name: string, amount: number): PlannerItem {
    const item: PlannerItem = { id: _nextId++, name: name.trim(), amount }
    items.value.push(item)
    return item
  }

  function updateItem(id: number, patch: Partial<Pick<PlannerItem, 'name' | 'amount'>>): void {
    const item = items.value.find(i => i.id === id)
    if (!item) return
    if (patch.name   !== undefined) item.name   = patch.name.trim()
    if (patch.amount !== undefined) item.amount = patch.amount
  }

  function removeItem(id: number): void {
    items.value = items.value.filter(i => i.id !== id)
  }

  function moveItem(id: number, direction: 'up' | 'down'): void {
    const idx = items.value.findIndex(i => i.id === id)
    if (idx === -1) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= items.value.length) return
    const copy = [...items.value]
    ;[copy[idx], copy[swapIdx]] = [copy[swapIdx], copy[idx]]
    items.value = copy
  }

  function setIncome(value: number): void {
    income.value = value
  }

  // ── Commitment computed ────────────────────────────────────
  function runningBalances(): number[] {
    let balance = income.value
    return items.value.map(item => {
      balance -= item.amount
      return balance
    })
  }

  function totalCommitted(): number {
    return items.value.reduce((sum, i) => sum + i.amount, 0)
  }

  function remaining(): number {
    return income.value - totalCommitted()
  }

  return {
    income,
    items,
    setIncome,
    addItem,
    updateItem,
    removeItem,
    moveItem,
    runningBalances,
    totalCommitted,
    remaining,
  }
})
