import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Transaction } from '../types/transaction'
import { generateSeedTransactions } from '../data/transactionSeedData'
import { useSettingsStore } from './settingsStore'
import { roundCents, txNet } from '../utils/math'
import { storageKey, loadStored } from '../utils/storeStorage'

let _nextId = 500

export const useTransactionStore = defineStore('transactions', () => {
  const settings = useSettingsStore()

  function _key(): string { return storageKey('clearbook_transactions', settings.country) }
  function _load() { return loadStored('clearbook_transactions', settings.country, 'p2_transactions') }

  const _saved = _load()

  const transactions = ref<Transaction[]>(_saved?.transactions ?? [])
  if (_saved?.nextId != null) _nextId = _saved.nextId

  watch(transactions, (val) => {
    localStorage.setItem(_key(), JSON.stringify({ transactions: val, nextId: _nextId }))
  }, { deep: true })

  // Reload when country changes
  watch(() => settings.country, (newCountry) => {
    if (!newCountry) return
    const saved = _load()
    _nextId = saved?.nextId ?? 500
    transactions.value = saved?.transactions ?? []
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

  // Running balance across all accounts, respecting optional balance cutoff setting.
  // When a cutoff tx is pinned: totalFunds = sum of transactions from that tx's date onwards.
  // When no cutoff: all-time sum (original behaviour).
  const totalFunds = computed(() => {
    const cutoffTxId = settings.balanceCutoffTxId
    const pinnedTx = cutoffTxId ? transactions.value.find(t => t.id === cutoffTxId) : null
    const txs = pinnedTx ? transactions.value.filter(t => t.date >= pinnedTx.date) : transactions.value
    return roundCents(txs.reduce((sum, transaction) => sum + txNet(transaction), 0))
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

  return { transactions, totalFunds, addTransaction, bulkAddTransactions, deleteTransaction, updateTransaction, patchTransaction, lockTransactions, unlockTransactions, lockOnOrBefore, unlockOnOrBefore, lockAll, unlockAll, addOpeningBalance, getItemActivity, getUnassignedActivity, unassignItem, loadSeedData, $import }
})
