import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '../stores/settingsStore'
import { generateDemoData } from './useDemoData'
import type { DemoConfig } from './useDemoData'

const CONFIG: DemoConfig = {
  persona:             'saver',
  startYear:           2025,
  startMonth:          1,
  endYear:             2025,
  endMonth:            12,
  monthlyIncome:       4200,
  includeSavingsGoals: true,
  includeFinance:      true,
}

function answered(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('asking for a demo budget', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.unstubAllGlobals()
  })

  it('asks the API for the country on screen, with the whole form', async () => {
    const fetchMock = vi.fn().mockResolvedValue(answered({ accountsCreated: 4, budgetMonths: 12, transactionsAdded: 300, goalsCreated: 3, loansCreated: 1, financeSavingsCreated: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    useSettingsStore().country = 'ireland'

    const result = await generateDemoData(CONFIG)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/folio/demo?country=ireland')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual(CONFIG)
    expect(result.accountsCreated).toBe(4)
  })

  it('will not ask without a country: the API would not know whose budget to replace', async () => {
    const fetchMock = vi.fn().mockResolvedValue(answered({}))
    vi.stubGlobal('fetch', fetchMock)
    useSettingsStore().country = ''

    await expect(generateDemoData(CONFIG)).rejects.toThrow(/country/i)

    // The settings store saves itself, so the assertion is about the demo request only.
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/folio/demo'))).toHaveLength(0)
  })

  it("repeats the API's own words when it refuses", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'A monthly income is between 100 and 999999.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )))
    useSettingsStore().country = 'ireland'

    await expect(generateDemoData(CONFIG)).rejects.toThrow('A monthly income is between 100 and 999999.')
  })
})
