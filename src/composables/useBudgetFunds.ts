import { computed } from 'vue'
import { useTransactionStore } from '../stores/transactionStore'
import { useAccountStore } from '../stores/accountStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { Account } from '../types/transaction'

function _isExcluded(acc: Account): boolean {
  if (acc.archived) return true                          // archived accounts always excluded
  if (acc.excludeFromBudget !== undefined) return acc.excludeFromBudget
  return acc.type === 'liability'
}

export function useBudgetFunds() {
  const txStore  = useTransactionStore()
  const accStore = useAccountStore()
  const settings = useSettingsStore()

  /** Set of account IDs that are excluded from the budget total. */
  const excludedAccountIds = computed(
    () => new Set(accStore.accounts.filter(_isExcluded).map(a => a.id))
  )

  /**
   * Like totalFunds, but transactions belonging to excluded accounts
   * (liabilities by default, or per-account override) are not counted.
   * Respects the balanceCutoffTxId setting.
   * Transactions with no account (accountId = null) are always included.
   */
  const budgetFunds = computed(() => {
    const excluded   = excludedAccountIds.value
    const cutoffTxId = settings.balanceCutoffTxId

    let txs = txStore.transactions.filter(t => !t.accountId || !excluded.has(t.accountId))

    if (cutoffTxId) {
      const pinnedTx = txStore.transactions.find(t => t.id === cutoffTxId)
      if (pinnedTx) txs = txs.filter(t => t.date >= pinnedTx.date)
    }

    return Math.round(
      txs.reduce((s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0) * 100,
    ) / 100
  })

  return { budgetFunds, excludedAccountIds }
}
