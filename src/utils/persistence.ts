import type { BudgetItem, BudgetItemDef, BudgetMonthEntry } from '../types/budget'
import type { Account, Transaction } from '../types/transaction'
import { useAccountStore } from '../stores/accountStore'
import { useBudgetStore } from '../stores/budgetStore'
import { useTransactionStore } from '../stores/transactionStore'
import { useTemplateStore } from '../stores/templateStore'
import { useSettingsStore } from '../stores/settingsStore'

const EXPORT_VERSION = '1'

interface AppExport {
  version: string
  exportedAt: string
  settings: {
    theme: string
    locale: string
    currency: string
    dateStyle: string
    timeStyle: string
    country?: string
  }
  accounts: Account[]
  transactions: Transaction[]
  // v2 format
  budgetGlobalItems?: BudgetItemDef[]
  budgetMonthlyEntries?: Record<number, Record<number, BudgetMonthEntry[]>>
  // v1 format (legacy — accepted on import only)
  budgetMonthlyItems?: Record<number, Record<number, BudgetItem[]>>
  templateItems: BudgetItem[]
}

export function exportAllData(): string {
  const accountStore  = useAccountStore()
  const budgetStore   = useBudgetStore()
  const txnStore      = useTransactionStore()
  const templateStore = useTemplateStore()
  const settings      = useSettingsStore()

  const data: AppExport = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: {
      theme:     settings.theme,
      locale:    settings.locale,
      currency:  settings.currency,
      dateStyle: settings.dateStyle,
      timeStyle: settings.timeStyle,
      country:   settings.country,
    },
    accounts:             structuredClone(accountStore.accounts),
    transactions:         structuredClone(txnStore.transactions),
    budgetGlobalItems:    structuredClone(budgetStore.globalItems),
    budgetMonthlyEntries: structuredClone(budgetStore.monthlyEntries),
    templateItems:        structuredClone(templateStore.items),
  }

  return JSON.stringify(data, null, 2)
}

export function downloadExport(): void {
  const settings = useSettingsStore()
  const json = exportAllData()
  const blob = new Blob([json], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  const country  = settings.country  || 'unknown'
  const currency = settings.currency || 'XXX'
  const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-')
  a.download = `clearbook-backup-${country}-${currency}-${ts}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function importData(json: string): void {
  let data: AppExport
  try {
    data = JSON.parse(json) as AppExport
  } catch {
    throw new Error('Invalid file: could not parse JSON.')
  }

  if (!data.version || !data.exportedAt) {
    throw new Error('Invalid backup file: missing version or exportedAt fields.')
  }

  const accountStore  = useAccountStore()
  const budgetStore   = useBudgetStore()
  const txnStore      = useTransactionStore()
  const templateStore = useTemplateStore()
  const settings      = useSettingsStore()

  if (data.settings) {
    if (data.settings.theme)     settings.theme     = data.settings.theme as 'dark' | 'light' | 'midnight' | 'forest' | 'purple'
    if (data.settings.locale)    settings.locale    = data.settings.locale
    if (data.settings.currency)  settings.currency  = data.settings.currency
    if (data.settings.dateStyle) settings.dateStyle = data.settings.dateStyle as 'short' | 'medium' | 'long' | 'iso'
    if (data.settings.timeStyle) settings.timeStyle = data.settings.timeStyle as '12h' | '24h'
    if (data.settings.country)   settings.setCountry(data.settings.country)
  }

  if (Array.isArray(data.accounts)) {
    accountStore.$import(data.accounts)
  }

  if (Array.isArray(data.transactions)) {
    txnStore.$import(data.transactions)
  }

  if (Array.isArray(data.budgetGlobalItems) && data.budgetMonthlyEntries) {
    // v2 format
    budgetStore.$import({ globalItems: data.budgetGlobalItems, monthlyEntries: data.budgetMonthlyEntries })
  } else if (data.budgetMonthlyItems && typeof data.budgetMonthlyItems === 'object') {
    // v1 legacy format — migrate on import
    budgetStore.$import(data.budgetMonthlyItems)
  }

  if (Array.isArray(data.templateItems)) {
    templateStore.$import(data.templateItems)
  }
}

export async function importFromFile(file: File): Promise<void> {
  const text = await file.text()
  importData(text)
}

/**
 * Find every country that has data in localStorage and trigger one download per country.
 * Each file is built directly from localStorage so it works regardless of which country
 * is currently active in the running app.
 */
export function downloadAllCountries(): void {
  // Discover all countries that have account data
  const countryIds = new Set<string>()
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key) continue
    const match = key.match(/^clearbook_accounts_(.+)$/)
    if (match) countryIds.add(match[1])
  }

  if (countryIds.size === 0) {
    // No country-scoped data; fall back to single current-country export
    downloadExport()
    return
  }

  const settingsRaw = (() => {
    try { return JSON.parse(localStorage.getItem('clearbook_settings') ?? 'null') } catch { return null }
  })()

  const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-')

  for (const countryId of countryIds) {
    const read = (suffix: string) => {
      try { return JSON.parse(localStorage.getItem(`clearbook_${suffix}_${countryId}`) ?? 'null') } catch { return null }
    }
    const acctData   = read('accounts')
    const txData     = read('transactions')
    const budgetData = read('budget')
    const tplData    = read('template')

    const currencyForCountry: string = settingsRaw?.country === countryId
      ? (settingsRaw?.currency ?? countryId)
      : countryId  // best guess when country differs

    const payload: AppExport = {
      version:    EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      settings: {
        theme:     settingsRaw?.theme    ?? 'dark',
        locale:    settingsRaw?.locale   ?? 'en-IE',
        currency:  settingsRaw?.country === countryId ? (settingsRaw?.currency ?? '') : '',
        dateStyle: settingsRaw?.dateStyle ?? 'medium',
        timeStyle: settingsRaw?.timeStyle ?? '12h',
        country:   countryId,
      },
      accounts:             acctData?.accounts      ?? [],
      transactions:         txData?.transactions    ?? [],
      budgetGlobalItems:    budgetData?.globalItems  ?? [],
      budgetMonthlyEntries: budgetData?.monthlyEntries ?? {},
      templateItems:        tplData?.items           ?? [],
    }

    const json = JSON.stringify(payload, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `clearbook-backup-${countryId}-${currencyForCountry}-${ts}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }
}

/** Wipe all country-scoped data for the target country, restore from backup, then reload the page. */
export function clearAndImport(json: string): void {
  let data: AppExport
  try {
    data = JSON.parse(json) as AppExport
  } catch {
    throw new Error('Invalid backup file: could not parse JSON.')
  }

  const settings     = useSettingsStore()
  const targetCountry = data.settings?.country ?? settings.country

  const dataSuffixes = ['accounts', 'transactions', 'budget', 'template', 'savings_goals', 'import_history']
  for (const suffix of dataSuffixes) {
    if (targetCountry) localStorage.removeItem(`clearbook_${suffix}_${targetCountry}`)
    localStorage.removeItem(`clearbook_${suffix}`)
  }

  // Write settings back first so stores load with correct country key
  importData(json)

  window.location.reload()
}
