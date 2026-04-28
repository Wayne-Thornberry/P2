import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Account } from '../types/transaction'
import { useTransactionStore } from './transactionStore'
import { useSettingsStore } from './settingsStore'
import { useSavingsGoalStore } from './savingsGoalStore'
import { useLoanStore } from './loanStore'
import { loadCountryScoped, useCountryScopedPersistence } from './useCountryScopedPersistence'

let _nextAccId = 10

export const useAccountStore = defineStore('accounts', () => {
  const settings = useSettingsStore()

  const _saved = loadCountryScoped('clearbook_accounts', 'p2_accounts')

  // No default accounts — user adds their own (or uses Generate Sample Data)
  const accounts = ref<Account[]>(_saved?.accounts ?? [])
  if (_saved?.nextId != null) _nextAccId = _saved.nextId

  useCountryScopedPersistence('clearbook_accounts', {
    sources: accounts,
    toBlob: () => ({ accounts: accounts.value, nextId: _nextAccId }),
    reload: (s) => { _nextAccId = s?.nextId ?? 10; accounts.value = s?.accounts ?? [] },
  })

  function addAccount(name: string, type: Account['type'] = 'asset', bankId?: string): string {
    const trimmed = name.trim()
    if (!trimmed) return ''
    const id = `acc-${_nextAccId++}`
    accounts.value.push({ id, name: trimmed, type, bankId: bankId || undefined })
    return id
  }

  function updateAccount(id: string, patch: Partial<Pick<Account, 'name' | 'type' | 'excludeFromBudget' | 'archived' | 'bankId'>>): void {
    const acc = accounts.value.find(a => a.id === id)
    if (!acc) return
    if (patch.name              !== undefined) acc.name              = patch.name.trim() || acc.name
    if (patch.type              !== undefined) acc.type              = patch.type
    if ('excludeFromBudget' in patch)          acc.excludeFromBudget = patch.excludeFromBudget
    if ('archived'          in patch)          acc.archived          = patch.archived
    if ('bankId'            in patch)          acc.bankId            = patch.bankId || undefined
  }

  function removeAccount(id: string): void {
    const idx = accounts.value.findIndex(a => a.id === id)
    if (idx === -1) return
    accounts.value.splice(idx, 1)

    // Delete all transactions linked to this account in a single reactive update
    // (avoids O(n²) cost and one localStorage write per row).
    const txStore = useTransactionStore()
    const linkedIds = new Set(
      txStore.transactions.filter(t => t.accountId === id).map(t => t.id),
    )
    txStore.bulkDeleteTransactions(linkedIds)

    // Archive savings goals linked to this account.
    const goalStore = useSavingsGoalStore()
    goalStore.goals
      .filter(g => g.linkedAccountId === id)
      .forEach(g => goalStore.updateGoal(g.id, { archived: true, linkedAccountId: '' }))

    // Archive and unlink loans and savings-account finance records.
    const loanStore = useLoanStore()
    loanStore.loans
      .filter(l => l.linkedAccountId === id)
      .forEach(l => loanStore.updateLoan(l.id, { archived: true, linkedAccountId: undefined }))
    loanStore.savings
      .filter(s => s.linkedAccountId === id)
      .forEach(s => loanStore.updateSavingsAccount(s.id, { archived: true, linkedAccountId: undefined }))
  }

  /** Detach all transactions from this account (set accountId = null) without deleting them. */
  function unlinkTransactions(id: string): void {
    const txStore = useTransactionStore()
    txStore.transactions
      .filter(t => t.accountId === id)
      .forEach(t => { t.accountId = null })
  }

  /**
   * Archive an account: marks it archived, locks all linked transactions,
   * and archives linked savings goals and finance records (preserving links).
   */
  function archiveAccount(id: string): void {
    const acc = accounts.value.find(a => a.id === id)
    if (!acc || acc.archived) return
    acc.archived = true

    // Lock all linked transactions.
    const txStore = useTransactionStore()
    const linkedIds = txStore.transactions
      .filter(t => t.accountId === id)
      .map(t => t.id)
    txStore.lockTransactions(linkedIds)

    // Archive linked savings goals (keep link so they restore on unarchive).
    const goalStore = useSavingsGoalStore()
    goalStore.goals
      .filter(g => !g.archived && g.linkedAccountId === id)
      .forEach(g => goalStore.updateGoal(g.id, { archived: true }))

    // Archive linked finance records (keep link).
    const loanStore = useLoanStore()
    loanStore.loans
      .filter(l => !l.archived && l.linkedAccountId === id)
      .forEach(l => loanStore.updateLoan(l.id, { archived: true }))
    loanStore.savings
      .filter(s => !s.archived && s.linkedAccountId === id)
      .forEach(s => loanStore.updateSavingsAccount(s.id, { archived: true }))
  }

  /**
   * Unarchive an account: unmarks it archived, unlocks linked transactions,
   * and unarchives linked savings goals and finance records.
   */
  function unarchiveAccount(id: string): void {
    const acc = accounts.value.find(a => a.id === id)
    if (!acc || !acc.archived) return
    acc.archived = false

    // Unlock all linked transactions.
    const txStore = useTransactionStore()
    const linkedIds = txStore.transactions
      .filter(t => t.accountId === id)
      .map(t => t.id)
    txStore.unlockTransactions(linkedIds)

    // Unarchive linked savings goals.
    const goalStore = useSavingsGoalStore()
    goalStore.goals
      .filter(g => g.archived && g.linkedAccountId === id)
      .forEach(g => goalStore.updateGoal(g.id, { archived: false }))

    // Unarchive linked finance records.
    const loanStore = useLoanStore()
    loanStore.loans
      .filter(l => l.archived && l.linkedAccountId === id)
      .forEach(l => loanStore.updateLoan(l.id, { archived: false }))
    loanStore.savings
      .filter(s => s.archived && s.linkedAccountId === id)
      .forEach(s => loanStore.updateSavingsAccount(s.id, { archived: false }))
  }

  function renameAccount(id: string, name: string): void {
    const acc = accounts.value.find(a => a.id === id)
    if (acc) acc.name = name.trim() || acc.name
  }


  function loadSeedData(): void {
    accounts.value = [
      { id: 'acc-s1', name: 'Checking Account',  type: 'asset'     },
      { id: 'acc-s2', name: 'Savings Account',   type: 'asset'     },
      { id: 'acc-s3', name: 'Credit Card',        type: 'liability' },
      { id: 'acc-s4', name: 'Cash',               type: 'asset'     },
      { id: 'acc-s5', name: 'Investment Account', type: 'asset'     },
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

  return { accounts, addAccount, updateAccount, archiveAccount, unarchiveAccount, removeAccount, unlinkTransactions, renameAccount, loadSeedData, $import }
})

