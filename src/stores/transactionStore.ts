import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Transaction } from '../types/transaction'
import { generateSeedTransactions } from '../data/transactionSeedData'
import { useSettingsStore } from './settingsStore'

let _nextId = 500

export const useTransactionStore = defineStore('transactions', () => {
  const _saved = (() => {
    try {
      let raw = localStorage.getItem('clearbook_transactions')
      if (raw === null) {
        raw = localStorage.getItem('p2_transactions')
        if (raw !== null) localStorage.removeItem('p2_transactions')
      }
      return JSON.parse(raw ?? 'null')
    } catch { return null }
  })()

  const transactions = ref<Transaction[]>(_saved?.transactions ?? [])
  if (_saved?.nextId != null) _nextId = _saved.nextId

  watch(transactions, (val) => {
    localStorage.setItem('clearbook_transactions', JSON.stringify({ transactions: val, nextId: _nextId }))
  }, { deep: true })

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
  // When a cutoff date is set: totalFunds = openingBalance + sum of transactions on/after that date.
  // When no cutoff: all-time sum (original behaviour).
  const totalFunds = computed(() => {
    const settings = useSettingsStore()
    const cutoff = settings.balanceCutoffDate
    const txs = cutoff
      ? transactions.value.filter(t => t.date >= cutoff)
      : transactions.value
    const sum = Math.round(txs.reduce((s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0) * 100) / 100
    return cutoff ? Math.round((settings.openingBalance + sum) * 100) / 100 : sum
  })

  function addOpeningBalance(accountId: string, amount: number, date: string): void {
    if (amount === 0) return
    addTransaction({
      name:      'Opening Balance',
      date,
      type:      amount > 0 ? 'in' : 'out',
      amount:    Math.abs(amount),
      itemId:    null,
      accountId,
    })
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

  return { transactions, totalFunds, addTransaction, deleteTransaction, updateTransaction, addOpeningBalance, getItemActivity, getUnassignedActivity, unassignItem, loadSeedData, $import }
})
