// ── useFinance ─────────────────────────────────────────────────
// What the loans and savings accounts come to, as the API works it out.
//
// An amortisation schedule and a compounding balance are one calculation with several
// answers hanging off it -- what is left, what a month costs, when it ends, what it will be
// worth -- and the pages that show them used to work those out separately. They are asked
// for once now, and asked again when a save lands.

import { computed, ref, watch } from 'vue'
import { api } from '../../../shared'
import { useSettingsStore } from '../stores/settingsStore'
import { saved } from '../workspace'

export interface LoanSummary {
  id:            number
  name:          string
  color:         string
  apr:           number
  principal:     number
  remaining:     number
  pctPaid:       number
  monthlyPayment: number
  /** The month the last payment falls in, as yyyy-mm. */
  payoffMonth:   string
}

export interface SavingsSummary {
  id:             number
  name:           string
  color:          string
  apr:            number
  startBalance:   number
  projectedNow:   number
  interestEarned: number
  compoundFreq:   string
}

export interface FinanceTotals {
  monthlyPayments:  number
  loanRemaining:    number
  projectedSavings: number
  netPosition:      number
}

export interface FinanceSummary {
  loans:   LoanSummary[]
  savings: SavingsSummary[]
  totals:  FinanceTotals
}

const empty: FinanceSummary = {
  loans: [],
  savings: [],
  totals: { monthlyPayments: 0, loanRemaining: 0, projectedSavings: 0, netPosition: 0 },
}

const summary = ref<FinanceSummary | null>(null)

let inFlight: Promise<void> | null = null

async function load(): Promise<void> {
  if (inFlight) return inFlight

  const country = useSettingsStore().country
  if (!country) return

  inFlight = api
    .get<FinanceSummary>(`/api/folio/finance/summary?country=${encodeURIComponent(country)}`)
    .then((answer) => {
      summary.value = answer
    })
    .catch((error: unknown) => {
      // A summary that could not be read is not a summary of nothing; the last one stays.
      console.warn('[folio] the finance summary could not be read.', error)
    })
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

export function useFinance() {
  const settings = useSettingsStore()

  watch([() => settings.country, saved], () => void load(), { immediate: true })

  return {
    loans:          computed((): LoanSummary[] => (summary.value ?? empty).loans),
    savings:        computed((): SavingsSummary[] => (summary.value ?? empty).savings),
    totals:         computed((): FinanceTotals => (summary.value ?? empty).totals),
    hasFinance:     computed((): boolean => (summary.value?.loans.length ?? 0) > 0 || (summary.value?.savings.length ?? 0) > 0),
    /** The payoff month written the way the card shows it, e.g. "Jan 2028". */
    payoffLabel:    (month: string): string => {
      if (!month) return '—'

      const [year, at] = month.split('-').map(Number)
      if (!year || !at) return '—'

      return new Date(year, at - 1, 1).toLocaleDateString(settings.locale || undefined, { month: 'short', year: 'numeric' })
    },
  }
}
