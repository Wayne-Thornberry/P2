import { ref } from 'vue'
import * as ai from '../ai/api'
import type { CategoriseResponse } from '../ai/api'
import { useBudgetStore } from '../stores/budgetStore'
import { useTransactionStore } from '../stores/transactionStore'
import type { Transaction } from '../types/transaction'

/**
 * Categorising a batch of transactions with the AI.
 *
 * It is a proposal first and a change second: the page asks, the answer arrives with the
 * item each transaction looks like and the reason, and nothing is written until the person
 * looking at it says so. Applying goes through the stores — the same stores every other
 * edit uses — so the change is saved the way a change is always saved.
 */
export function useCategorise() {
  const budget = useBudgetStore()
  const transactions = useTransactionStore()

  const proposal = ref<CategoriseResponse | null>(null)
  const loading = ref(false)
  const error = ref('')

  async function propose(country: string, rows: Transaction[]): Promise<void> {
    if (!country) {
      error.value = 'Choose a country first: transactions belong to one budget.'
      return
    }

    if (rows.length === 0) {
      error.value = 'There are no transactions to categorise.'
      return
    }

    loading.value = true
    error.value = ''

    try {
      proposal.value = await ai.categorise(
        country,
        rows.map(row => ({
          id: row.id,
          name: row.name,
          notes: row.notes,
          amount: row.amount,
          type: row.type,
          date: row.date,
        })),
        budget.globalItems.map(item => ({ id: item.id, name: item.name })),
      )
    } catch (failure) {
      error.value = failure instanceof Error ? failure.message : 'The AI could not answer.'
    } finally {
      loading.value = false
    }
  }

  /** Writes the proposal: new items first, so their ids exist for the assignments. */
  function apply(): { assigned: number; created: number } {
    const current = proposal.value

    if (current === null) return { assigned: 0, created: 0 }

    let created = 0

    for (const assignment of current.assignments) {
      let itemId = assignment.itemId ?? null

      if (itemId === null) {
        const before = budget.globalItems.length

        itemId = budget.getOrCreateGlobalItem(assignment.itemName)

        if (budget.globalItems.length > before) created++
      }

      transactions.patchTransaction(assignment.transactionId, { itemId })
    }

    proposal.value = null

    return { assigned: current.assignments.length, created }
  }

  function dismiss(): void {
    proposal.value = null
    error.value = ''
  }

  return { proposal, loading, error, propose, apply, dismiss }
}
