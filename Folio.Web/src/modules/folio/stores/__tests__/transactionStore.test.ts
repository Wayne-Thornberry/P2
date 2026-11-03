import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTransactionStore } from '../transactionStore'
import { useSettingsStore } from '../settingsStore'

// Stub localStorage for isolation between tests
function freshPinia() {
  localStorage.clear()
  const pinia = createPinia()
  setActivePinia(pinia)
  return pinia
}

describe('transactionStore — addTransaction', () => {
  beforeEach(() => {
    freshPinia()
    const settings = useSettingsStore()
    settings.country = 'IE'
  })

  it('adds a transaction and it appears in transactions', () => {
    const store = useTransactionStore()
    store.addTransaction({ name: 'Coffee', date: '2026-01-01', type: 'out', amount: 5, itemId: null, accountId: 'acc-1' })
    expect(store.transactions).toHaveLength(1)
    expect(store.transactions[0].name).toBe('Coffee')
  })

  it('assigns incrementing ids', () => {
    const store = useTransactionStore()
    store.addTransaction({ name: 'A', date: '2026-01-01', type: 'out', amount: 1, itemId: null, accountId: null })
    store.addTransaction({ name: 'B', date: '2026-01-02', type: 'out', amount: 2, itemId: null, accountId: null })
    const ids = store.transactions.map(t => t.id)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('prepends (newest first in array)', () => {
    const store = useTransactionStore()
    store.addTransaction({ name: 'First',  date: '2026-01-01', type: 'out', amount: 1, itemId: null, accountId: null })
    store.addTransaction({ name: 'Second', date: '2026-01-02', type: 'out', amount: 2, itemId: null, accountId: null })
    expect(store.transactions[0].name).toBe('Second')
  })
})

describe('transactionStore — deleteTransaction', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('removes the transaction by id', () => {
    const store = useTransactionStore()
    store.addTransaction({ name: 'X', date: '2026-01-01', type: 'out', amount: 10, itemId: null, accountId: null })
    const id = store.transactions[0].id
    store.deleteTransaction(id)
    expect(store.transactions).toHaveLength(0)
  })

  it('is a no-op for unknown id', () => {
    const store = useTransactionStore()
    store.addTransaction({ name: 'X', date: '2026-01-01', type: 'out', amount: 10, itemId: null, accountId: null })
    store.deleteTransaction(99999)
    expect(store.transactions).toHaveLength(1)
  })
})

describe('transactionStore — addOpeningBalance', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('creates an "Opening Balance" transaction', () => {
    const store = useTransactionStore()
    store.addOpeningBalance('acc-1', 500, '2026-01-01')
    const ob = store.transactions.find(t => t.name === 'Opening Balance')
    expect(ob).toBeDefined()
    expect(ob!.amount).toBe(500)
    expect(ob!.type).toBe('in')
    expect(ob!.accountId).toBe('acc-1')
  })

  it('creates an OB for amount = 0 (type = in)', () => {
    const store = useTransactionStore()
    store.addOpeningBalance('acc-1', 0, '2026-01-01')
    const ob = store.transactions.find(t => t.name === 'Opening Balance')
    expect(ob).toBeDefined()
    expect(ob!.amount).toBe(0)
    expect(ob!.type).toBe('in')
  })

  it('creates an "out" OB for negative amount', () => {
    const store = useTransactionStore()
    store.addOpeningBalance('acc-1', -200, '2026-01-01')
    const ob = store.transactions.find(t => t.name === 'Opening Balance')
    expect(ob!.type).toBe('out')
    expect(ob!.amount).toBe(200)
  })
})

describe('transactionStore — totalFunds', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('sums all ins minus outs', () => {
    const store = useTransactionStore()
    store.addTransaction({ name: 'Salary', date: '2026-01-01', type: 'in',  amount: 1000, itemId: null, accountId: null })
    store.addTransaction({ name: 'Rent',   date: '2026-01-02', type: 'out', amount: 400,  itemId: null, accountId: null })
    expect(store.totalFunds).toBe(600)
  })
})

describe('transactionStore — getItemActivity', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('returns total spend for item across all time', () => {
    const store = useTransactionStore()
    store.addTransaction({ name: 'Groceries', date: '2026-01-10', type: 'out', amount: 50, itemId: 1, accountId: null })
    store.addTransaction({ name: 'Groceries', date: '2026-02-10', type: 'out', amount: 30, itemId: 1, accountId: null })
    store.addTransaction({ name: 'Rent',      date: '2026-02-01', type: 'out', amount: 800, itemId: 2, accountId: null })
    expect(store.getItemActivity(1)).toBe(80)
  })

  it('filters by year and month', () => {
    const store = useTransactionStore()
    store.addTransaction({ name: 'G1', date: '2026-01-10', type: 'out', amount: 50, itemId: 1, accountId: null })
    store.addTransaction({ name: 'G2', date: '2026-02-10', type: 'out', amount: 30, itemId: 1, accountId: null })
    expect(store.getItemActivity(1, 2026, 1)).toBe(50)
    expect(store.getItemActivity(1, 2026, 2)).toBe(30)
  })

  it('in-type transactions (refunds) reduce activity', () => {
    const store = useTransactionStore()
    store.addTransaction({ name: 'Buy',    date: '2026-01-10', type: 'out', amount: 100, itemId: 1, accountId: null })
    store.addTransaction({ name: 'Refund', date: '2026-01-15', type: 'in',  amount: 20,  itemId: 1, accountId: null })
    expect(store.getItemActivity(1, 2026, 1)).toBe(80)
  })
})

describe('transactionStore — lock/unlock', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('lockTransactions marks transactions as locked', () => {
    const store = useTransactionStore()
    store.addTransaction({ name: 'X', date: '2026-01-01', type: 'out', amount: 1, itemId: null, accountId: null })
    const id = store.transactions[0].id
    store.lockTransactions([id])
    expect(store.transactions[0].locked).toBe(true)
  })

  it('unlockTransactions removes locked status', () => {
    const store = useTransactionStore()
    store.addTransaction({ name: 'X', date: '2026-01-01', type: 'out', amount: 1, itemId: null, accountId: null })
    const id = store.transactions[0].id
    store.lockTransactions([id])
    store.unlockTransactions([id])
    expect(store.transactions[0].locked).toBe(false)
  })

  it('lockOnOrBefore locks all transactions up to cutoff date', () => {
    const store = useTransactionStore()
    store.addTransaction({ name: 'Jan', date: '2026-01-15', type: 'out', amount: 1, itemId: null, accountId: null })
    store.addTransaction({ name: 'Mar', date: '2026-03-01', type: 'out', amount: 1, itemId: null, accountId: null })
    store.lockOnOrBefore('2026-02-01')
    const jan = store.transactions.find(t => t.name === 'Jan')
    const mar = store.transactions.find(t => t.name === 'Mar')
    expect(jan!.locked).toBe(true)
    expect(mar!.locked).toBeFalsy()
  })
})

describe('transactionStore — unassignItem', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('sets itemId to null for all linked transactions', () => {
    const store = useTransactionStore()
    store.addTransaction({ name: 'A', date: '2026-01-01', type: 'out', amount: 10, itemId: 5, accountId: null })
    store.addTransaction({ name: 'B', date: '2026-01-02', type: 'out', amount: 20, itemId: 5, accountId: null })
    store.addTransaction({ name: 'C', date: '2026-01-03', type: 'out', amount: 30, itemId: 6, accountId: null })
    store.unassignItem(5)
    expect(store.transactions.find(t => t.name === 'A')!.itemId).toBeNull()
    expect(store.transactions.find(t => t.name === 'B')!.itemId).toBeNull()
    expect(store.transactions.find(t => t.name === 'C')!.itemId).toBe(6)
  })
})
