import { describe, it, expect } from 'vitest'
import { suggestItem, suggestItems, suggestTopItems } from '../autoCategory'
import type { BudgetItem } from '../../types/budget'

// Minimal BudgetItem factory
function item(id: number, name: string, category = ''): BudgetItem {
  return { id, name, category, assigned: 0, activity: 0 }
}

const ITEMS: BudgetItem[] = [
  item(1,  'Groceries',     'food'),
  item(2,  'Dining Out',    'food'),
  item(3,  'Coffee',        'food'),
  item(4,  'Fuel',          'transport'),
  item(5,  'Netflix',       'entertainment'),
  item(6,  'Salary',        'income'),
  item(7,  'Rent',          'housing'),
  item(8,  'Electricity',   'utilities'),
  item(9,  'Internet',      'utilities'),
  item(10, 'Gym',           'health'),
]

describe('suggestItem', () => {
  it('returns null for empty items list', () => {
    expect(suggestItem('TESCO', [])).toBeNull()
  })

  it('returns null for empty transaction name', () => {
    expect(suggestItem('', ITEMS)).toBeNull()
  })

  it('matches supermarket to Groceries', () => {
    expect(suggestItem('TESCO GALWAY', ITEMS)).toBe(1)
  })

  it('matches Lidl to Groceries', () => {
    expect(suggestItem('LIDL STORE', ITEMS)).toBe(1)
  })

  it('matches McDonald to Dining Out', () => {
    expect(suggestItem('MCDONALDS', ITEMS)).toBe(2)
  })

  it('matches Starbucks to Coffee', () => {
    expect(suggestItem('STARBUCKS GALWAY', ITEMS)).toBe(3)
  })

  it('matches BP to Fuel', () => {
    expect(suggestItem('BP PETROL STATION', ITEMS)).toBe(4)
  })

  it('matches Netflix to Netflix', () => {
    expect(suggestItem('NETFLIX', ITEMS)).toBe(5)
  })

  it('matches SALARY credit to Salary', () => {
    expect(suggestItem('PAYROLL SALARY', ITEMS)).toBe(6)
  })

  it('matches rent payment to Rent', () => {
    expect(suggestItem('RENT PAYMENT', ITEMS)).toBe(7)
  })

  it('matches electricity to Electricity', () => {
    expect(suggestItem('AIRTRICITY ELECTRICITY', ITEMS)).toBe(8)
  })

  it('strips banking prefixes before matching (POS, DDR, etc.)', () => {
    expect(suggestItem('POS TESCO GALWAY', ITEMS)).toBe(1)
    expect(suggestItem('DDR NETFLIX', ITEMS)).toBe(5)
  })
})

describe('suggestItems', () => {
  it('processes only unassigned transactions by default', () => {
    const txs = [
      { id: 1, name: 'TESCO', itemId: null },
      { id: 2, name: 'LIDL',  itemId: 99 },   // already assigned
    ]
    const result = suggestItems(txs, ITEMS)
    expect(result.has(1)).toBe(true)
    expect(result.has(2)).toBe(false)
  })

  it('processes all transactions when onlyUnassigned=false', () => {
    const txs = [
      { id: 1, name: 'TESCO', itemId: null },
      { id: 2, name: 'LIDL',  itemId: 99 },
    ]
    const result = suggestItems(txs, ITEMS, false)
    expect(result.has(1)).toBe(true)
    expect(result.has(2)).toBe(true)
  })

  it('returns empty map when no items match', () => {
    const txs = [{ id: 1, name: 'XYZXYZXYZ', itemId: null }]
    const result = suggestItems(txs, ITEMS)
    expect(result.size).toBe(0)
  })
})

describe('suggestTopItems', () => {
  it('returns empty array for empty items', () => {
    expect(suggestTopItems('TESCO', [])).toEqual([])
  })

  it('places best match first', () => {
    const top = suggestTopItems('TESCO GALWAY', ITEMS)
    expect(top[0].id).toBe(1) // Groceries
  })

  it('respects topN limit', () => {
    const top = suggestTopItems('TESCO', ITEMS, 3)
    expect(top.length).toBeLessThanOrEqual(3)
  })

  it('items with score 0 appear alphabetically after scored items', () => {
    const top = suggestTopItems('TESCO', ITEMS, ITEMS.length)
    const firstZeroScore = top.findIndex(it => !['Groceries', 'Dining Out'].includes(it.name))
    const lastPositiveScore = top.reduce((last, it, idx) =>
      ['Groceries'].includes(it.name) ? idx : last, -1)
    expect(firstZeroScore).toBeGreaterThan(lastPositiveScore)
  })
})
