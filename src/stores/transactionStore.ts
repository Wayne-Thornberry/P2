import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Transaction } from '../types/transaction'
import { generateSeedTransactions } from '../data/transactionSeedData'
import { useSettingsStore } from './settingsStore'
import { sumNet } from '../utils/math'
import { loadCountryScoped, useCountryScopedPersistence } from './useCountryScopedPersistence'

let _nextId = 500

export const useTransactionStore = defineStore('transactions', () => {
  const settings = useSettingsStore()

  const _saved = loadCountryScoped('clearbook_transactions', 'p2_transactions')

  const transactions = ref<Transaction[]>(_saved?.transactions ?? [])
  if (_saved?.nextId != null) _nextId = _saved.nextId

  useCountryScopedPersistence('clearbook_transactions', {
    sources: transactions,
    toBlob: () => ({ transactions: transactions.value, nextId: _nextId }),
    reload: (s) => { _nextId = s?.nextId ?? 500; transactions.value = s?.transactions ?? [] },
  })

  function addTransaction(t: Omit<Transaction, 'id' | 'createdAt'>): void {
    transactions.value.unshift({
      ...t,
      notes: t.notes?.trim() || undefined,
      id: _nextId++,
      createdAt: new Date().toISOString(),
    })
  }

  function deleteTransaction(id: number): void {
    transactions.value = transactions.value.filter(t => t.id !== id)
  }

  /**
   * Delete multiple transactions in a single reactive update.
   * Avoids O(n²) cost and N localStorage writes when deleting many rows at once.
   */
  function bulkDeleteTransactions(ids: Set<number>): void {
    if (ids.size === 0) return
    transactions.value = transactions.value.filter(t => !ids.has(t.id))
  }

  function updateTransaction(id: number, fields: Omit<Transaction, 'id' | 'createdAt'>): void {
    const idx = transactions.value.findIndex(t => t.id === id)
    if (idx !== -1) {
      transactions.value[idx] = { ...transactions.value[idx], ...fields }
    }
  }

  function getItemActivity(itemId: number, year?: number, month?: number): number {
    return transactions.value
      .filter(t => {
        if (t.itemId !== itemId) return false
        if (year !== undefined && month !== undefined) {
          const [y, m] = t.date.split('-').map(Number)
          return y === year && m === month
        }
        return true
      })
      // Net spending: out transactions increase activity, in transactions (refunds) reduce it
      .reduce((sum, t) => sum + (t.type === 'out' ? t.amount : -t.amount), 0)
  }

  function getUnassignedActivity(year?: number, month?: number): number {
    return transactions.value
      .filter(t => {
        if (t.itemId !== null) return false
        if (year !== undefined && month !== undefined) {
          const [y, m] = t.date.split('-').map(Number)
          return y === year && m === month
        }
        return true
      })
      .reduce((sum, t) => sum + (t.type === 'out' ? t.amount : -t.amount), 0)
  }

  /**
   * Build a Map<itemId → activity> for a given month in a single pass.
   * Use this instead of calling getItemActivity per item to avoid O(items × transactions) cost.
   */
  function getMonthlyActivityMap(year: number, month: number): Map<number, number> {
    const map = new Map<number, number>()
    for (const t of transactions.value) {
      if (t.itemId === null) continue
      const [y, m] = t.date.split('-').map(Number)
      if (y !== year || m !== month) continue
      map.set(t.itemId, (map.get(t.itemId) ?? 0) + (t.type === 'out' ? t.amount : -t.amount))
    }
    return map
  }

  // Running balance across all accounts, respecting optional balance cutoff setting.
  // When a cutoff tx is pinned: totalFunds = sum of transactions from that tx's date onwards.
  // When no cutoff: all-time sum (original behaviour).
  const totalFunds = computed(() => {
    const cutoffTxId = settings.balanceCutoffTxId
    const pinnedTx = cutoffTxId ? transactions.value.find(t => t.id === cutoffTxId) : null
    const txs = pinnedTx ? transactions.value.filter(t => t.date >= pinnedTx.date) : transactions.value
    return sumNet(txs)
  })

  function patchTransaction(id: number, patch: Partial<Omit<Transaction, 'id' | 'createdAt'>>): void {
    const tx = transactions.value.find(t => t.id === id)
    if (tx) Object.assign(tx, patch)
  }

  // ── Lock / unlock ─────────────────────────────────────────────

  function lockTransactions(ids: Set<number> | number[]): void {
    const set = ids instanceof Set ? ids : new Set(ids)
    for (const t of transactions.value) {
      if (set.has(t.id)) t.locked = true
    }
  }

  function unlockTransactions(ids: Set<number> | number[]): void {
    const set = ids instanceof Set ? ids : new Set(ids)
    for (const t of transactions.value) {
      if (set.has(t.id)) t.locked = false
    }
  }

  /** Lock all transactions with date <= cutoffDate (YYYY-MM-DD) */
  function lockOnOrBefore(cutoffDate: string): void {
    for (const t of transactions.value) {
      if (t.date <= cutoffDate) t.locked = true
    }
  }

  /** Unlock all transactions with date <= cutoffDate (YYYY-MM-DD) */
  function unlockOnOrBefore(cutoffDate: string): void {
    for (const t of transactions.value) {
      if (t.date <= cutoffDate) t.locked = false
    }
  }

  function lockAll(): void {
    for (const t of transactions.value) t.locked = true
  }

  function unlockAll(): void {
    for (const t of transactions.value) t.locked = false
  }

  function addOpeningBalance(accountId: string, amount: number, date: string): void {
    addTransaction({
      name:      'Opening Balance',
      date,
      type:      amount >= 0 ? 'in' : 'out',
      amount:    Math.abs(amount),
      itemId:    null,
      accountId,
    })
  }

  /**
   * Insert multiple transactions in a single reactive update.
   * Use this for CSV imports to avoid O(n²) unshift cost and batch the
   * localStorage write into one operation instead of one per row.
   */
  function bulkAddTransactions(rows: Array<Omit<Transaction, 'id' | 'createdAt'>>): void {
    if (rows.length === 0) return
    const now = new Date().toISOString()
    const newTxs: Transaction[] = rows.map(t => ({
      ...t,
      notes:     t.notes?.trim() || undefined,
      id:        _nextId++,
      createdAt: now,
    }))
    // Single prepend — one reactive mutation → one watch firing → one localStorage write
    transactions.value = [...newTxs, ...transactions.value]
  }

  function loadSeedData(): void {
    transactions.value = generateSeedTransactions()
  }

  function $import(data: Transaction[]): void {
    transactions.value = data
    const maxId = data.reduce((max, t) => Math.max(max, t.id), 499)
    _nextId = maxId + 1
  }

  /** Unlink all transactions from a deleted item */
  function unassignItem(itemId: number): void {
    for (const t of transactions.value) {
      if (t.itemId === itemId) t.itemId = null
    }
  }

  return { transactions, totalFunds, addTransaction, bulkAddTransactions, deleteTransaction, bulkDeleteTransactions, updateTransaction, patchTransaction, lockTransactions, unlockTransactions, lockOnOrBefore, unlockOnOrBefore, lockAll, unlockAll, addOpeningBalance, getItemActivity, getUnassignedActivity, getMonthlyActivityMap, unassignItem, loadSeedData, $import }
})
