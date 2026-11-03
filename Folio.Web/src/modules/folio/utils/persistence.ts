import type { BudgetItem, BudgetItemDef, BudgetMonthEntry } from '../types/budget'
import type { Account, Transaction } from '../types/transaction'
import { useAccountStore } from '../stores/accountStore'
import { useBudgetStore } from '../stores/budgetStore'
import { useTransactionStore } from '../stores/transactionStore'
import { useTemplateStore } from '../stores/templateStore'
import { useSettingsStore } from '../stores/settingsStore'
import { nextTick } from 'vue'
import { cloneDeep } from './math'
import { flushSaves, readCountry, savedCountries } from '../workspace'

const EXPORT_VERSION = '3'

/**
 * Versions this code knows how to import.
 *  - '1' — legacy `budgetMonthlyItems` shape (auto-migrated by budgetStore).
 *  - '2' — current `budgetGlobalItems` + `budgetMonthlyEntries` split.
 *  - '3' — added `billableMonthStart` to settings export.
 */
const SUPPORTED_VERSIONS = new Set(['1', '2', '3'])

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
    billableMonthStart?: number
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
      theme:               settings.theme,
      locale:              settings.locale,
      currency:            settings.currency,
      dateStyle:           settings.dateStyle,
      timeStyle:           settings.timeStyle,
      country:             settings.country,
      billableMonthStart:  settings.billableMonthStart,
    },
    accounts:             cloneDeep(accountStore.accounts),
    transactions:         cloneDeep(txnStore.transactions),
    budgetGlobalItems:    cloneDeep(budgetStore.globalItems),
    budgetMonthlyEntries: cloneDeep(budgetStore.monthlyEntries),
    templateItems:        cloneDeep(templateStore.items),
  }

  return JSON.stringify(data)
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
  a.download = `folio-backup-${country}-${currency}-${ts}.json`
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

  if (!SUPPORTED_VERSIONS.has(data.version)) {
    throw new Error(
      `Unsupported backup version "${data.version}". This build understands: ${[...SUPPORTED_VERSIONS].join(', ')}.`
    )
  }

  const accountStore  = useAccountStore()
  const budgetStore   = useBudgetStore()
  const txnStore      = useTransactionStore()
  const templateStore = useTemplateStore()
  const settings      = useSettingsStore()

  if (data.settings) {
    if (data.settings.theme)     settings.theme     = data.settings.theme as 'dark' | 'light' | 'midnight' | 'forest' | 'purple' | 'slate' | 'rose' | 'teal'
    if (data.settings.locale)    settings.locale    = data.settings.locale
    if (data.settings.currency)  settings.currency  = data.settings.currency
    if (data.settings.dateStyle) settings.dateStyle = data.settings.dateStyle as 'short' | 'medium' | 'long' | 'iso'
    if (data.settings.timeStyle)        settings.timeStyle         = data.settings.timeStyle as '12h' | '24h'
    if (data.settings.country)          settings.setCountry(data.settings.country)
    if (data.settings.billableMonthStart) settings.billableMonthStart = data.settings.billableMonthStart
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
 * One download per country this account has a budget for.
 *
 * The list and each country's data come from the API, because a country that has not been
 * opened in this browser is not in its storage. The browser's copy fills in anything the
 * API has nothing for, which is what a mock or an unreachable API leaves.
 */
export async function downloadAllCountries(): Promise<void> {
  const countryIds = await savedCountries()

  if (countryIds.length === 0) {
    // No country-scoped data; fall back to single current-country export
    downloadExport()
    return
  }

  const settingsRaw = (() => {
    try { return JSON.parse(localStorage.getItem('folio_settings') ?? localStorage.getItem('clearbook_settings') ?? 'null') } catch { return null }
  })()

  const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-')

  for (const countryId of countryIds) {
    const saved = await readCountry(countryId)
    const acctData   = saved['folio_accounts'] as { accounts?: unknown[] } | undefined
    const txData     = saved['folio_transactions'] as { transactions?: unknown[] } | undefined
    const budgetData = saved['folio_budget'] as { globalItems?: unknown[]; monthlyEntries?: unknown } | undefined
    const tplData    = saved['folio_template'] as { entries?: unknown[] } | undefined

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
      accounts:             (acctData?.accounts      ?? []) as AppExport['accounts'],
      transactions:         (txData?.transactions    ?? []) as AppExport['transactions'],
      budgetGlobalItems:    (budgetData?.globalItems ?? []) as AppExport['budgetGlobalItems'],
      budgetMonthlyEntries: (budgetData?.monthlyEntries ?? {}) as AppExport['budgetMonthlyEntries'],
      templateItems:        (tplData?.entries        ?? []) as unknown as AppExport['templateItems'],
    }

    const json = JSON.stringify(payload, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `folio-backup-${countryId}-${currencyForCountry}-${ts}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }
}

/**
 * Wipe all country-scoped data for the target country, restore from backup, then reload
 * the page.
 *
 * The wipe and the restore both have to reach the server before the reload: the page is
 * about to ask the API what is saved, and it would be told about the data that was just
 * replaced.
 */
export async function clearAndImport(json: string): Promise<void> {
  let data: AppExport
  try {
    data = JSON.parse(json) as AppExport
  } catch {
    throw new Error('Invalid backup file: could not parse JSON.')
  }

  const settings     = useSettingsStore()
  const targetCountry = data.settings?.country ?? settings.country

  // Must include every per-country store key. Missing one here will leave
  // orphan data in place after a restore.
  const dataSuffixes = [
    'accounts',
    'transactions',
    'budget',
    'template',
    'savings_goals',
    'import_history',
    'finance',
    'planner',
    'upcoming',
  ]
  for (const suffix of dataSuffixes) {
    if (targetCountry) localStorage.removeItem(`folio_${suffix}_${targetCountry}`)
    localStorage.removeItem(`folio_${suffix}`)
  }

  // Write settings back first so stores load with correct country key
  importData(json)

  await nextTick()
  await flushSaves()

  window.location.reload()
}
