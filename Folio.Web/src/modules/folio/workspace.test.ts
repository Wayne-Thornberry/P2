import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushSaves, loadWorkspace, queueStoreSave, savedCountries } from './workspace'

/**
 * The one part of the site that knows its data lives on a server.
 *
 * What is checked here is the contract the stores rely on: the server's copy is in the
 * keys the stores already read before the app starts, and a changed collection is sent
 * once rather than on every keystroke.
 */

/** A fetch that answers from a table of path → body. */
function serve(routes: Record<string, unknown>) {
  const calls: Array<{ method: string; url: string; body: unknown }> = []

  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, url, body: init?.body })

    const key = Object.keys(routes).find((candidate) => url.endsWith(candidate))
    if (key === undefined) return new Response('{"error":"not found"}', { status: 404 })

    const body = routes[key]
    if (body === undefined) return new Response(null, { status: 204 })

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })

  return calls
}

describe('the workspace', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('puts the saved collections where the stores look for them', async () => {

    serve({
      '/api/folio/settings': { theme: 'light', country: 'ireland', currency: 'EUR' },
      '/api/folio/workspace?country=ireland': {
        folio_transactions: { transactions: [{ id: 1, name: 'Groceries' }], nextId: 2 },
      },
    })

    await loadWorkspace()

    expect(JSON.parse(localStorage.getItem('folio_settings')!)).toMatchObject({ country: 'ireland' })
    expect(JSON.parse(localStorage.getItem('folio_transactions_ireland')!)).toEqual({
      transactions: [{ id: 1, name: 'Groceries' }],
      nextId: 2,
    })
  })

  it('forgets a collection the server no longer has', async () => {

    // Left over from an older page load, and no longer on the server.
    localStorage.setItem('folio_accounts_ireland', JSON.stringify({ accounts: [{ id: 'acc-1' }] }))

    serve({
      '/api/folio/settings': { theme: 'light', country: 'ireland' },
      '/api/folio/workspace?country=ireland': {},
    })

    await loadWorkspace()

    expect(localStorage.getItem('folio_accounts_ireland')).toBeNull()
  })

  it('sends a changed collection once, after the changes settle', async () => {
    vi.useFakeTimers()

    // A collection and a country no other test uses. The tests share one module instance
    // (`isolate: false`), so a save another file left pending is still on its timer and can
    // land in this test's fetch: what this test counts has to be its own.
    type Call = { method: string; url: string; body: unknown }
    const ours = (calls: Call[]) => calls.filter((call) => call.url.includes('country=atlantis'))

    const calls = serve({ '/api/folio/import-history?country=atlantis': undefined })

    queueStoreSave('folio_import_history', 'atlantis', { imports: [{ id: 1 }] })
    queueStoreSave('folio_import_history', 'atlantis', { imports: [{ id: 1 }, { id: 2 }] })

    expect(ours(calls)).toHaveLength(0)

    vi.advanceTimersByTime(500)
    await flushSaves()

    const puts = ours(calls).filter((call) => call.method === 'PUT')
    expect(puts).toHaveLength(1)
    expect(puts[0].body).toBe(JSON.stringify({ imports: [{ id: 1 }, { id: 2 }] }))
  })

  it('asks the server which countries have a budget', async () => {

    serve({ '/api/folio/countries': ['ireland', 'sweden'] })

    expect(await savedCountries()).toEqual(['ireland', 'sweden'])
  })
})
