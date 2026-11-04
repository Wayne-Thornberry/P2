import { ref } from 'vue'
import * as ai from '../ai/api'
import type { AnalysisResponse } from '../ai/api'

/**
 * The report on the Reports page.
 *
 * One call, on a button: a year of transactions summarised by DeepSeek takes seconds and
 * costs money, so it is never fetched on the way into the page. The answer is kept until
 * another one is asked for, because re-reading it costs nothing and asking again does.
 */
export function useAnalysis() {
  const report = ref<AnalysisResponse | null>(null)
  const loading = ref(false)
  const error = ref('')
  const available = ref(false)
  const model = ref('')

  /**
   * Whether the box has a key at all. A page with no key shows no button rather than a
   * button that can only fail.
   */
  async function check(): Promise<void> {
    try {
      const status = await ai.fetchStatus()

      available.value = status.available
      model.value = status.model
    } catch {
      available.value = false
    }
  }

  async function generate(country: string, accounts: string[], months: number): Promise<void> {
    if (!country) {
      error.value = 'Choose a country first: the report is about one budget.'
      return
    }

    loading.value = true
    error.value = ''

    try {
      report.value = await ai.generate(country, accounts, months)
    } catch (failure) {
      error.value = failure instanceof Error ? failure.message : 'The report could not be written.'
    } finally {
      loading.value = false
    }
  }

  function clear(): void {
    report.value = null
    error.value = ''
  }

  return { report, loading, error, available, model, check, generate, clear }
}
