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
    },
    accounts:             JSON.parse(JSON.stringify(accountStore.accounts)),
    transactions:         JSON.parse(JSON.stringify(txnStore.transactions)),
    budgetGlobalItems:    JSON.parse(JSON.stringify(budgetStore.globalItems)),
    budgetMonthlyEntries: JSON.parse(JSON.stringify(budgetStore.monthlyEntries)),
    templateItems:        JSON.parse(JSON.stringify(templateStore.items)),
  }

  return JSON.stringify(data, null, 2)
}

export function downloadExport(): void {
  const json = exportAllData()
  const blob = new Blob([json], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `budget-backup-${new Date().toISOString().slice(0, 10)}.json`
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
