import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAccountStore } from '../accountStore'
import { useTransactionStore } from '../transactionStore'
import { useSettingsStore } from '../settingsStore'
import { useSavingsGoalStore } from '../savingsGoalStore'
import { useLoanStore } from '../loanStore'

function freshPinia() {
  localStorage.clear()
  const pinia = createPinia()
  setActivePinia(pinia)
  return pinia
}

describe('accountStore — addAccount', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('adds an account and returns its id', () => {
    const store = useAccountStore()
    const id = store.addAccount('Checking')
    expect(id).toBeTruthy()
    expect(store.accounts).toHaveLength(1)
    expect(store.accounts[0].name).toBe('Checking')
    expect(store.accounts[0].id).toBe(id)
  })

  it('trims whitespace from name', () => {
    const store = useAccountStore()
    store.addAccount('  Savings  ')
    expect(store.accounts[0].name).toBe('Savings')
  })

  it('returns empty string and does not add for blank name', () => {
    const store = useAccountStore()
    const id = store.addAccount('   ')
    expect(id).toBe('')
    expect(store.accounts).toHaveLength(0)
  })

  it('generates unique ids for multiple accounts', () => {
    const store = useAccountStore()
    const id1 = store.addAccount('A')
    const id2 = store.addAccount('B')
    expect(id1).not.toBe(id2)
  })
})

describe('accountStore — renameAccount', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('renames an existing account', () => {
    const store = useAccountStore()
    const id = store.addAccount('Old Name')
    store.renameAccount(id, 'New Name')
    expect(store.accounts[0].name).toBe('New Name')
  })

  it('does not rename to blank (keeps original)', () => {
    const store = useAccountStore()
    const id = store.addAccount('Original')
    store.renameAccount(id, '   ')
    expect(store.accounts[0].name).toBe('Original')
  })

  it('is a no-op for unknown id', () => {
    const store = useAccountStore()
    store.addAccount('A')
    store.renameAccount('acc-unknown', 'B')
    expect(store.accounts[0].name).toBe('A')
  })
})

describe('accountStore — removeAccount', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('removes the account', () => {
    const store = useAccountStore()
    const id = store.addAccount('Test')
    store.removeAccount(id)
    expect(store.accounts).toHaveLength(0)
  })

  it('deletes linked transactions', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const id = accStore.addAccount('Checking')
    txStore.addTransaction({ name: 'Coffee', date: '2026-01-01', type: 'out', amount: 5, itemId: null, accountId: id })
    expect(txStore.transactions).toHaveLength(1)
    accStore.removeAccount(id)
    expect(txStore.transactions).toHaveLength(0)
  })

  it('does not delete unlinked transactions', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const id = accStore.addAccount('Checking')
    txStore.addTransaction({ name: 'Other', date: '2026-01-01', type: 'out', amount: 10, itemId: null, accountId: null })
    accStore.removeAccount(id)
    expect(txStore.transactions).toHaveLength(1)
  })

  it('archives linked savings goals', () => {
    const accStore  = useAccountStore()
    const goalStore = useSavingsGoalStore()
    const id = accStore.addAccount('Savings')
    goalStore.addGoal('Holiday', 1000, undefined, id)
    accStore.removeAccount(id)
    expect(goalStore.goals).toHaveLength(1)
    expect(goalStore.goals[0].archived).toBe(true)
    expect(goalStore.goals[0].linkedAccountId).toBeUndefined()
  })

  it('archives linked loan finance records', () => {
    const accStore  = useAccountStore()
    const loanStore = useLoanStore()
    const id = accStore.addAccount('Mortgage')
    loanStore.addLoan('Home Loan', 200000, 3.5, 360, '2024-01-01', id)
    accStore.removeAccount(id)
    expect(loanStore.loans).toHaveLength(1)
    expect(loanStore.loans[0].archived).toBe(true)
    expect(loanStore.loans[0].linkedAccountId).toBeUndefined()
  })

  it('is a no-op for unknown id', () => {
    const store = useAccountStore()
    store.addAccount('A')
    store.removeAccount('acc-unknown')
    expect(store.accounts).toHaveLength(1)
  })
})

describe('accountStore — unlinkTransactions', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('sets accountId to null on linked transactions', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const id = accStore.addAccount('Checking')
    txStore.addTransaction({ name: 'Coffee', date: '2026-01-01', type: 'out', amount: 5, itemId: null, accountId: id })
    accStore.unlinkTransactions(id)
    expect(txStore.transactions[0].accountId).toBeNull()
    // Account itself is kept
    expect(accStore.accounts).toHaveLength(1)
  })

  it('does not affect transactions linked to other accounts', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const id1 = accStore.addAccount('A')
    const id2 = accStore.addAccount('B')
    txStore.addTransaction({ name: 'T1', date: '2026-01-01', type: 'out', amount: 5, itemId: null, accountId: id1 })
    txStore.addTransaction({ name: 'T2', date: '2026-01-01', type: 'out', amount: 5, itemId: null, accountId: id2 })
    accStore.unlinkTransactions(id1)
    expect(txStore.transactions.find(t => t.name === 'T1')?.accountId).toBeNull()
    expect(txStore.transactions.find(t => t.name === 'T2')?.accountId).toBe(id2)
  })
})

describe('accountStore — archiveAccount', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('marks the account as archived', () => {
    const accStore = useAccountStore()
    const id = accStore.addAccount('Old Bank')
    accStore.archiveAccount(id)
    expect(accStore.accounts.find(a => a.id === id)?.archived).toBe(true)
  })

  it('locks all transactions linked to the account', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const id = accStore.addAccount('Old Bank')
    txStore.addTransaction({ name: 'T1', date: '2026-01-01', type: 'out', amount: 10, itemId: null, accountId: id })
    txStore.addTransaction({ name: 'T2', date: '2026-01-02', type: 'in',  amount: 20, itemId: null, accountId: id })
    accStore.archiveAccount(id)
    expect(txStore.transactions.every(t => t.accountId === id ? t.locked : true)).toBe(true)
  })

  it('does not lock transactions linked to other accounts', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const id1 = accStore.addAccount('A')
    const id2 = accStore.addAccount('B')
    txStore.addTransaction({ name: 'T1', date: '2026-01-01', type: 'out', amount: 5, itemId: null, accountId: id1 })
    txStore.addTransaction({ name: 'T2', date: '2026-01-01', type: 'out', amount: 5, itemId: null, accountId: id2 })
    accStore.archiveAccount(id1)
    expect(txStore.transactions.find(t => t.name === 'T2')?.locked).toBeFalsy()
  })

  it('archives linked savings goals (keeping the link)', () => {
    const accStore  = useAccountStore()
    const goalStore = useSavingsGoalStore()
    const id = accStore.addAccount('Old Bank')
    goalStore.addGoal('Deposit', 1000, '', id)
    const gid = goalStore.goals[0].id
    accStore.archiveAccount(id)
    const goal = goalStore.goals.find(g => g.id === gid)
    expect(goal?.archived).toBe(true)
    expect(goal?.linkedAccountId).toBe(id)
  })

  it('archives linked loans (keeping the link)', () => {
    const accStore  = useAccountStore()
    const loanStore = useLoanStore()
    const id = accStore.addAccount('Old Bank')
    loanStore.addLoan('Car Loan', 5000, 5, 60, '2024-01-01', id)
    const lid = loanStore.loans[0].id
    accStore.archiveAccount(id)
    const loan = loanStore.loans.find(l => l.id === lid)
    expect(loan?.archived).toBe(true)
    expect(loan?.linkedAccountId).toBe(id)
  })

  it('is idempotent — archiving an already-archived account does nothing', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const id = accStore.addAccount('Old Bank')
    txStore.addTransaction({ name: 'T1', date: '2026-01-01', type: 'out', amount: 5, itemId: null, accountId: id })
    accStore.archiveAccount(id)
    expect(txStore.transactions[0].locked).toBe(true)
    // manually unlock then call archive again — should be no-op
    txStore.unlockTransactions([txStore.transactions[0].id])
    accStore.archiveAccount(id)
    expect(txStore.transactions[0].locked).toBe(false)
  })
})

describe('accountStore — unarchiveAccount', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('marks the account as not archived', () => {
    const accStore = useAccountStore()
    const id = accStore.addAccount('Old Bank')
    accStore.archiveAccount(id)
    accStore.unarchiveAccount(id)
    expect(accStore.accounts.find(a => a.id === id)?.archived).toBe(false)
  })

  it('unlocks all transactions linked to the account', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const id = accStore.addAccount('Old Bank')
    txStore.addTransaction({ name: 'T1', date: '2026-01-01', type: 'out', amount: 10, itemId: null, accountId: id })
    accStore.archiveAccount(id)
    expect(txStore.transactions[0].locked).toBe(true)
    accStore.unarchiveAccount(id)
    expect(txStore.transactions[0].locked).toBe(false)
  })

  it('unarchives linked savings goals', () => {
    const accStore  = useAccountStore()
    const goalStore = useSavingsGoalStore()
    const id = accStore.addAccount('Old Bank')
    goalStore.addGoal('Deposit', 1000, '', id)
    const gid = goalStore.goals[0].id
    accStore.archiveAccount(id)
    accStore.unarchiveAccount(id)
    expect(goalStore.goals.find(g => g.id === gid)?.archived).toBe(false)
  })

  it('unarchives linked loans', () => {
    const accStore  = useAccountStore()
    const loanStore = useLoanStore()
    const id = accStore.addAccount('Old Bank')
    loanStore.addLoan('Car Loan', 5000, 5, 60, '2024-01-01', id)
    const lid = loanStore.loans[0].id
    accStore.archiveAccount(id)
    accStore.unarchiveAccount(id)
    expect(loanStore.loans.find(l => l.id === lid)?.archived).toBe(false)
  })

  it('is idempotent — unarchiving an active account does nothing', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const id = accStore.addAccount('Old Bank')
    txStore.addTransaction({ name: 'T1', date: '2026-01-01', type: 'out', amount: 5, itemId: null, accountId: id })
    accStore.unarchiveAccount(id)  // not archived yet, should be no-op
    expect(txStore.transactions[0].locked).toBeFalsy()
    expect(accStore.accounts.find(a => a.id === id)?.archived).toBeFalsy()
  })
})
