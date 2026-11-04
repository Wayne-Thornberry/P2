// ── useHealthScore ─────────────────────────────────────────────
// The financial health score, as the API works it out.
//
// The rules -- the six-month window, the savings bands, the reserve, the adherence --
// were once here, and the Dashboard and the Performance page could only agree while
// nobody changed them. They are the API's now: this asks for the answer, and asks again
// when the budget is saved, so an edit shows the score after it rather than before.

import { computed, ref, watch } from 'vue'
import { api } from '../../../shared'
import { useMonthStore } from '../stores/monthStore'
import { useSettingsStore } from '../stores/settingsStore'
import { saved } from '../workspace'

export interface HealthGrade {
  letter: string
  label:  string
  color:  string
}

export interface BudgetAdherence {
  total:   number
  over:    number
  onTrack: number
  pct:     number   // % on-track, 0-100
}

/** What the API answers, and every part the pages show. */
export interface HealthReport {
  score:             number
  grade:             HealthGrade
  rolling3:          { income: number; expenses: number; savingsRate: number }
  reserveMonths:     number | null
  budgetAdherence:   BudgetAdherence | null
  incomeConsistency: number
}

// One report for the whole app: the Dashboard and the Performance page ask the same
// question, so they get the same answer from one request.
const report = ref<HealthReport | null>(null)

let inFlight: Promise<void> | null = null

async function load(): Promise<void> {
  if (inFlight) return inFlight

  const country = useSettingsStore().country
  if (!country) return

  const monthStore = useMonthStore()
  const month = `${monthStore.activeYear}-${String(monthStore.activeMonth).padStart(2, '0')}`

  inFlight = api
    .get<HealthReport>(`/api/folio/health?country=${encodeURIComponent(country)}&month=${month}`)
    .then((answer) => {
      report.value = answer
    })
    .catch((error: unknown) => {
      // A score that could not be fetched is not a score of zero: the last one stays on
      // screen, and the reason is in the console.
      console.warn('[folio] the health score could not be read.', error)
    })
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

export function useHealthScore() {
  const settings    = useSettingsStore()
  const monthStore  = useMonthStore()

  watch(
    [() => settings.country, () => monthStore.activeYear, () => monthStore.activeMonth, saved],
    () => void load(),
    { immediate: true },
  )

  const score = computed((): number => report.value?.score ?? 0)

  const grade = computed((): HealthGrade =>
    report.value?.grade ?? { letter: '-', label: 'Loading', color: 'var(--ink-muted)' },
  )

  const rolling3 = computed(() => report.value?.rolling3 ?? { income: 0, expenses: 0, savingsRate: 0 })

  const reserveMonths = computed((): number | null => report.value?.reserveMonths ?? null)

  const budgetAdherence = computed((): BudgetAdherence | null => report.value?.budgetAdherence ?? null)

  const incomeConsistency = computed((): number => report.value?.incomeConsistency ?? 0)

  return { score, grade, rolling3, reserveMonths, budgetAdherence, incomeConsistency }
}