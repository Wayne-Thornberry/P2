import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { Account } from '../types/transaction'
import { useTransactionStore } from './transactionStore'

let _nextAccId = 10

export const useAccountStore = defineStore('accounts', () => {
  const _saved = (() => {
    try {
      let raw = localStorage.getItem('clearbook_accounts')
      if (raw === null) {
        raw = localStorage.getItem('p2_accounts')
        if (raw !== null) localStorage.removeItem('p2_accounts')
      }
      return JSON.parse(raw ?? 'null')
    } catch { return null }
  })()

  // No default accounts — user adds their own (or uses Generate Sample Data)
  const accounts = ref<Account[]>(_saved?.accounts ?? [])
  if (_saved?.nextId != null) _nextAccId = _saved.nextId

  watch(accounts, (val) => {
    localStorage.setItem('clearbook_accounts', JSON.stringify({ accounts: val, nextId: _nextAccId }))
  }, { deep: true })

  function addAccount(name: string): string {
    const trimmed = name.trim()
    if (!trimmed) return ''
    const id = `acc-${_nextAccId++}`
    accounts.value.push({ id, name: trimmed })
    return id
  }

  function removeAccount(id: string): void {
    const idx = accounts.value.findIndex(a => a.id === id)
    if (idx !== -1) accounts.value.splice(idx, 1)
    // Nullify accountId on any transaction linked to this account.
    const txStore = useTransactionStore()
    txStore.transactions
      .filter(t => t.accountId === id)
      .forEach(t => { t.accountId = null })
  }

  function renameAccount(id: string, name: string): void {
    const acc = accounts.value.find(a => a.id === id)
    if (acc) acc.name = name.trim() || acc.name
  }

  function loadSeedData(): void {
    accounts.value = [
      { id: 'acc-s1', name: 'Checking Account' },
      { id: 'acc-s2', name: 'Savings Account' },
      { id: 'acc-s3', name: 'Credit Card' },
      { id: 'acc-s4', name: 'Cash' },
      { id: 'acc-s5', name: 'Investment Account' },
    ]
  }

  function $import(data: Account[]): void {
    accounts.value = data
    const maxNum = data.reduce((max, a) => {
      const m = /^acc-(\d+)$/.exec(a.id)
      return m ? Math.max(max, parseInt(m[1], 10)) : max
    }, 9)
    _nextAccId = maxNum + 1
  }

  return { accounts, addAccount, removeAccount, renameAccount, loadSeedData, $import }
})

