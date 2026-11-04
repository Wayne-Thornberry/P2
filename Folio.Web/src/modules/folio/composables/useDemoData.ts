// ── useDemoData ────────────────────────────────────────────────
// A box with an empty database needs something to look at.
//
// The budget is the API's to make: which accounts a persona has, how often a bill is paid
// and how much of the budget is really spent are rules, and they were rules living in a
// download. This asks for one and leaves the count it answers with to the page.

import { api } from '../../../shared'
import { useSettingsStore } from '../stores/settingsStore'

export type DemoPersona = 'saver' | 'balanced' | 'indebted'

export interface DemoConfig {
  persona:             DemoPersona
  startYear:           number
  startMonth:          number
  endYear:             number
  endMonth:            number
  monthlyIncome:       number
  includeSavingsGoals: boolean
  includeFinance:      boolean
}

/** How much of each thing was made, which is what the page says afterwards. */
export interface DemoResult {
  accountsCreated:       number
  budgetMonths:          number
  transactionsAdded:     number
  goalsCreated:          number
  loansCreated:          number
  financeSavingsCreated: number
}

/**
 * Replaces this country's budget with demo data and answers what was made.
 *
 * The app reads its stores once, at startup, so a page cannot show a budget that arrived
 * afterwards: the caller reloads, and the reload primes the stores from what was just
 * saved.
 */
export async function generateDemoData(config: DemoConfig): Promise<DemoResult> {
  const country = useSettingsStore().country

  if (!country) throw new Error('A country is needed before demo data can be made.')

  return api.post<DemoResult>(`/api/folio/demo?country=${encodeURIComponent(country)}`, config)
}
