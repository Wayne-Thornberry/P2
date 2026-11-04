import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCategorise } from './useCategorise'
import { useBudgetStore } from '../stores/budgetStore'
import { useTransactionStore } from '../stores/transactionStore'
import type { Transaction } from '../types/transaction'

function answered(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function proposal(groups: unknown[], extra: Record<string, unknown> = {}): Response {
  return answered({
    groups,
    newItems: [],
    considered: 0,
    payees: groups.length,
    fromHistory: 0,
    unreadable: 0,
    covered: 0,
    items: [],
    ...extra,
  })
}

function spending(id: number, name: string): Transaction {
  return {
    id,
    name,
    date: '2026-02-01',
    createdAt: '2026-02-01T10:00:00.000Z',
    amount: 10,
    type: 'out',
    itemId: null,
    accountId: null,
  }
}

describe('categorising with the AI', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.unstubAllGlobals()
  })

  it('asks about payees, and with nothing selected leaves the rows to the API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(proposal([]))
    vi.stubGlobal('fetch', fetchMock)

    await useCategorise().propose('ireland', [])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/folio/categorise?country=ireland')

    // No rows on the wire: "all of them" is a question the API answers for itself.
    expect(JSON.parse(init.body).transactions).toBeUndefined()
  })

  it('applies one payee to every transaction behind it', () => {
    const store = useTransactionStore()
    store.transactions = [spending(1, 'TESCO STORES'), spending(2, 'Tesco Stores'), spending(3, 'NETFLIX')]

    const budget = useBudgetStore()
    const itemId = budget.getOrCreateGlobalItem('Groceries')

    const categorise = useCategorise()

    categorise.proposal.value = {
      groups: [
        {
          payee: 'TESCO STORES',
          itemId,
          itemName: 'Groceries',
          isNew: false,
          confidence: 0.9,
          why: 'supermarket',
          transactionIds: [1, 2],
          fromHistory: false,
        },
      ],
      newItems: ['Subscriptions'],
      considered: 3,
      payees: 2,
      fromHistory: 0,
      unreadable: 0,
      covered: 2,
      items: [],
    }

    expect(categorise.apply()).toEqual({ assigned: 2, created: 0 })
    expect(store.transactions.map(row => row.itemId)).toEqual([itemId, itemId, null])
  })

  it('creates a new item once, however many payees ask for it', () => {
    const store = useTransactionStore()
    store.transactions = [spending(1, 'NETFLIX'), spending(2, 'DISNEY'), spending(3, 'SPOTIFY')]

    const before = useBudgetStore().globalItems.length

    const categorise = useCategorise()

    categorise.proposal.value = {
      groups: ['NETFLIX', 'DISNEY', 'SPOTIFY'].map((payee, index) => ({
        payee,
        itemId: null,
        itemName: 'Subscriptions',
        isNew: true,
        confidence: 0.8,
        why: 'monthly streaming',
        transactionIds: [index + 1],
        fromHistory: false,
      })),
      newItems: ['Subscriptions'],
      considered: 3,
      payees: 3,
      fromHistory: 0,
      unreadable: 0,
      covered: 3,
      items: [],
    }

    expect(categorise.apply()).toEqual({ assigned: 3, created: 1 })
    expect(useBudgetStore().globalItems.length).toBe(before + 1)

    const itemId = useBudgetStore().globalItems.find(item => item.name === 'Subscriptions')?.id
    expect(store.transactions.map(row => row.itemId)).toEqual([itemId, itemId, itemId])
  })

  it('will not ask without a country: transactions belong to one budget', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const categorise = useCategorise()
    await categorise.propose('', [spending(1, 'TESCO')])

    expect(fetchMock).not.toHaveBeenCalled()
    expect(categorise.error.value).toContain('country')
  })
})
