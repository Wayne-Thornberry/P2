import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSettingsStore } from '../../stores/settingsStore'
import { useAccountStore } from '../../stores/accountStore'
import { useTransactionStore } from '../../stores/transactionStore'
import { useTemplateStore } from '../../stores/templateStore'
import { exportAllData, importData } from '../persistence'

// Suppress jsdom location.reload warnings — clearAndImport is not exercised here.
beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  const settings = useSettingsStore()
  settings.country = 'IE'
})

describe('persistence — round trip', () => {
  it('exports v2 and re-imports the same data', () => {
    const txStore  = useTransactionStore()
    const accStore = useAccountStore()
    const tplStore = useTemplateStore()

    const accId = accStore.addAccount('Checking', 'asset')
    txStore.addTransaction({ name: 'Lunch', date: '2026-04-15', type: 'out', amount: 12.5, itemId: null, accountId: accId })
    tplStore.$import([{ id: 1, name: 'Groceries', assigned: 100, category: 'Food', activity: 0 }])

    const json = exportAllData()
    const parsed = JSON.parse(json)
    expect(parsed.version).toBe('2')
    expect(parsed.accounts).toHaveLength(1)
    expect(parsed.transactions).toHaveLength(1)

    // Wipe and re-import on a fresh pinia
    setActivePinia(createPinia())
    useSettingsStore().country = 'IE'
    importData(json)

    expect(useAccountStore().accounts).toHaveLength(1)
    expect(useAccountStore().accounts[0].name).toBe('Checking')
    expect(useTransactionStore().transactions).toHaveLength(1)
    expect(useTransactionStore().transactions[0].amount).toBe(12.5)
    expect(useTemplateStore().items).toHaveLength(1)
  })

  it('rejects payloads with no version field', () => {
    expect(() => importData('{"accounts":[]}')).toThrow(/missing version/i)
  })

  it('rejects an unsupported future version', () => {
    const payload = JSON.stringify({ version: '99', exportedAt: new Date().toISOString(), accounts: [], transactions: [], templateItems: [] })
    expect(() => importData(payload)).toThrow(/unsupported backup version/i)
  })

  it('accepts legacy v1 payloads (budgetMonthlyItems)', () => {
    const payload = JSON.stringify({
      version: '1',
      exportedAt: new Date().toISOString(),
      settings: { theme: 'dark', locale: 'en-IE', currency: 'EUR', dateStyle: 'medium', timeStyle: '12h', country: 'IE' },
      accounts: [],
      transactions: [],
      budgetMonthlyItems: { 2025: { 1: [{ id: 1, name: 'Rent', assigned: 1200, category: 'Housing' }] } },
      templateItems: [],
    })
    expect(() => importData(payload)).not.toThrow()
  })

  it('rejects malformed JSON', () => {
    expect(() => importData('not-json{{')).toThrow(/could not parse/i)
  })
})
