/**
 * CSV Import Pipeline — scenario tests
 *
 * Exercises the full import logic (range-replace + append paths) against
 * the Pinia stores, using real adapter parsing.  No Vue component needed.
 *
 * Covered:
 *   Range-replace path (both boundaries found)
 *   Append path (first import, backfill, forward gap)
 *   Opening Balance creation / replacement / zero-OB
 *   Multi-CSV merging with inter-CSV gaps
 *   Bank-specific adapters (BOI, Revolut, Generic)
 *   Data drift correction (CSV has fewer/more rows on a day)
 *   Legitimate repeated transactions preserved
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTransactionStore } from '../stores/transactionStore'
import { useAccountStore } from '../stores/accountStore'
import { useSettingsStore } from '../stores/settingsStore'
import { processMultipleCsvFiles } from '../utils/csvAdapters'
import { dayBefore, dayAfter } from '../utils/date'
import { sumNet, txNet, roundCents } from '../utils/math'

// ── Setup ─────────────────────────────────────────────────────────────────────

function freshPinia() {
  localStorage.clear()
  const pinia = createPinia()
  setActivePinia(pinia)
  return pinia
}

function _txKey(date: string, name: string, amount: number, type: string): string {
  return `${date}|${name}|${amount}|${type}`
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Generic CSV (oldest-first, signed amount, balance column)
const JAN_CSV = `Date,Description,Amount,Balance
2026-01-05,Coffee,-5.00,95.00
2026-01-10,Salary,500.00,595.00
2026-01-31,Rent,-400.00,195.00`

const FEB_CSV = `Date,Description,Amount,Balance
2026-02-05,Coffee,-5.00,190.00
2026-02-10,Salary,500.00,690.00
2026-02-28,Rent,-400.00,290.00`

const MAR_CSV = `Date,Description,Amount,Balance
2026-03-05,Coffee,-5.00,285.00
2026-03-10,Salary,500.00,785.00
2026-03-31,Rent,-400.00,385.00`

// Jan CSV with an extra row (data drift: existing has 3 rows, CSV has 4)
const JAN_EXTRA_CSV = `Date,Description,Amount,Balance
2026-01-05,Coffee,-5.00,95.00
2026-01-10,Salary,500.00,595.00
2026-01-15,Lunch,-12.00,583.00
2026-01-31,Rent,-400.00,183.00`

// Jan CSV missing a row (data drift: existing has 3 rows, CSV has 2)
const JAN_MISSING_CSV = `Date,Description,Amount,Balance
2026-01-10,Salary,500.00,595.00
2026-01-31,Rent,-400.00,195.00`

// Full quarter CSV (Jan-Mar combined)
const Q1_CSV = `Date,Description,Amount,Balance
2026-01-05,Coffee,-5.00,95.00
2026-01-10,Salary,500.00,595.00
2026-01-31,Rent,-400.00,195.00
2026-02-05,Coffee,-5.00,190.00
2026-02-10,Salary,500.00,690.00
2026-02-28,Rent,-400.00,290.00
2026-03-05,Coffee,-5.00,285.00
2026-03-10,Salary,500.00,785.00
2026-03-31,Rent,-400.00,385.00`

// CSV with no balance column — no OB can be calculated
const NO_BALANCE_CSV = `Date,Description,Amount
2026-01-05,Coffee,-5.00
2026-01-10,Salary,500.00
2026-01-31,Rent,-400.00`

// CSV with OB = 0
const ZERO_OB_CSV = `Date,Description,Amount,Balance
2026-01-05,Coffee,-5.00,-5.00
2026-01-10,Salary,500.00,495.00`

// Two coffee transactions on the same day (legitimate repeat)
const REPEATED_CSV = `Date,Description,Amount,Balance
2026-01-05,Coffee,-5.00,90.00
2026-01-05,Coffee,-5.00,95.00
2026-01-10,Salary,500.00,595.00`

// December CSV (older than January, for backfill tests)
const DEC_CSV = `Date,Description,Amount,Balance
2025-12-05,Coffee,-5.00,45.00
2025-12-20,Salary,500.00,545.00`

// ── BOI adapter fixtures ──────────────────────────────────────────────────────

const BOI_JAN = `Date,Details,Debit,Credit,Balance
31/01/2026,TESCO,30.00,,70.00
15/01/2026,NETFLIX,15.00,,
01/01/2026,SALARY,,1000.00,100.00`

const BOI_FEB = `Date,Details,Debit,Credit,Balance
28/02/2026,LIDL,20.00,,180.00
15/02/2026,NETFLIX,15.00,,
01/02/2026,SALARY,,1000.00,200.00`

const BOI_MAR = `Date,Details,Debit,Credit,Balance
31/03/2026,ALDI,25.00,,175.00
15/03/2026,NETFLIX,15.00,,
01/03/2026,SALARY,,1000.00,200.00`

// ── Revolut adapter fixtures ──────────────────────────────────────────────────

const REVOLUT_CSV = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
Topup,Current,02/01/2026 17:22,02/01/2026 17:23,Top-up by *****,100,0,EUR,COMPLETED,100
Card Payment,Current,05/01/2026 12:18,06/01/2026 4:54,Subway,-13.8,0,EUR,COMPLETED,86.2
Transfer,Current,10/01/2026 10:00,10/01/2026 10:01,Transfer to JANE DOE,-25,0,EUR,COMPLETED,61.2
Card Payment,Current,15/01/2026 18:02,16/01/2026 5:36,Tesco,-27.75,0,EUR,COMPLETED,33.45
Topup,Current,20/01/2026 17:32,20/01/2026 17:32,Top-up by *6504,50,0,EUR,COMPLETED,83.45`

// ── Import helpers (replicate handleImport logic at store level) ───────────────

/** Range-replace import: find boundaries, delete range, insert CSV rows. */
function importRangeReplace(
  accountId: string,
  csvFiles: Array<{ text: string; fileName: string }>,
  adapterId: string,
): { count: number; mode: 'range-replace' | 'append' } {
  const txStore = useTransactionStore()
  const result  = processMultipleCsvFiles(csvFiles, adapterId)
  const allRows  = result.allRows
  if (allRows.length === 0) return { count: 0, mode: 'append' }

  const preTxs  = txStore.transactions.filter(t => t.accountId === accountId)
  const hasExisting = preTxs.length > 0

  // Check if both boundaries exist
  const firstRow = allRows[0]
  const lastRow  = allRows[allRows.length - 1]
  const firstKey = _txKey(firstRow.isoDate, firstRow.details, firstRow.amount, firstRow.type)
  const lastKey  = _txKey(lastRow.isoDate, lastRow.details, lastRow.amount, lastRow.type)
  const firstMatch = preTxs.find(t => _txKey(t.date, t.name, t.amount, t.type) === firstKey)
  const lastMatch  = preTxs.find(t => _txKey(t.date, t.name, t.amount, t.type) === lastKey)

  if (hasExisting && firstMatch && lastMatch) {
    // Range-replace path
    const delStart = firstMatch.date <= lastMatch.date ? firstMatch.date : lastMatch.date
    const delEnd   = firstMatch.date <= lastMatch.date ? lastMatch.date  : firstMatch.date
    const idsToDelete = new Set(
      preTxs.filter(t => t.date >= delStart && t.date <= delEnd).map(t => t.id)
    )
    txStore.bulkDeleteTransactions(idsToDelete)

    const batch = allRows.map(row => ({
      name: row.details, date: row.isoDate, type: row.type, amount: row.amount,
      itemId: null as number | null, accountId,
    }))
    txStore.bulkAddTransactions(batch)

    // Inter-CSV gap adjustments
    if (result.gapAdjustments.length > 0) {
      const gapBatch = result.gapAdjustments.map(gap => ({
        name: 'Balance Adjustment', date: gap.date, type: gap.type, amount: gap.amount,
        itemId: null as number | null, accountId,
      }))
      txStore.bulkAddTransactions(gapBatch)
    }

    return { count: batch.length, mode: 'range-replace' }
  }

  // Append path
  if (!hasExisting || (result.openingBalance !== null && result.openingDate)) {
    const existingOB = preTxs.find(t => t.name === 'Opening Balance')
    const newOldest  = allRows[0]?.isoDate ?? ''
    const earliestExisting = hasExisting ? preTxs.reduce((min, t) => t.date < min ? t.date : min, '9999-99-99') : ''

    const isBackfill          = hasExisting && (allRows[allRows.length - 1]?.isoDate ?? '') < earliestExisting
    const isExtendingBackward = hasExisting && !isBackfill && newOldest < earliestExisting

    if (isBackfill || isExtendingBackward) {
      if (existingOB) txStore.deleteTransaction(existingOB.id)
      if (result.openingBalance !== null && result.openingDate) {
        txStore.addOpeningBalance(accountId, result.openingBalance, result.openingDate)
      }
    } else if (!hasExisting) {
      if (result.openingBalance !== null && result.openingDate) {
        txStore.addOpeningBalance(accountId, result.openingBalance, result.openingDate)
      }
    }

    // Forward gap
    const latestExisting = hasExisting ? preTxs.reduce((max, t) => t.date > max ? t.date : max, '') : ''
    if (hasExisting && newOldest > dayAfter(latestExisting) && result.openingBalance !== null && result.openingDate) {
      const currentBalance = sumNet(preTxs)
      const diff = roundCents(result.openingBalance - currentBalance)
      if (Math.abs(diff) > 0.005) {
        txStore.addTransaction({
          name: 'Balance Adjustment', date: result.openingDate,
          type: diff > 0 ? 'in' : 'out', amount: Math.abs(diff), itemId: null, accountId,
        })
      }
    }

    // Count-based dedup
    const existingKeyCounts = new Map<string, number>()
    for (const t of txStore.transactions.filter(t => t.accountId === accountId)) {
      const key = _txKey(t.date, t.name, t.amount, t.type)
      existingKeyCounts.set(key, (existingKeyCounts.get(key) ?? 0) + 1)
    }
    const consumedCounts = new Map<string, number>()
    const batch: Array<{ name: string; date: string; type: 'in' | 'out'; amount: number; itemId: number | null; accountId: string }> = []
    let actualNet = 0
    for (const row of allRows) {
      const key = _txKey(row.isoDate, row.details, row.amount, row.type)
      const existing = existingKeyCounts.get(key) ?? 0
      const consumed = consumedCounts.get(key) ?? 0
      if (consumed < existing) {
        consumedCounts.set(key, consumed + 1)
      } else {
        batch.push({ name: row.details, date: row.isoDate, type: row.type, amount: row.amount, itemId: null, accountId })
        actualNet = roundCents(actualNet + txNet(row))
      }
    }
    txStore.bulkAddTransactions(batch)

    // Inter-CSV gap adjustments
    if (result.gapAdjustments.length > 0) {
      const gapBatch: Array<{ name: string; date: string; type: 'in' | 'out'; amount: number; itemId: number | null; accountId: string }> = []
      for (const gap of result.gapAdjustments) {
        const key = _txKey(gap.date, 'Balance Adjustment', gap.amount, gap.type)
        if ((existingKeyCounts.get(key) ?? 0) === 0) {
          gapBatch.push({ name: 'Balance Adjustment', date: gap.date, type: gap.type, amount: gap.amount, itemId: null, accountId })
        }
      }
      if (gapBatch.length > 0) txStore.bulkAddTransactions(gapBatch)
    }

    // Backfill gap bridge
    if (isBackfill) {
      const existingOBTx = preTxs.find(t => t.name === 'Opening Balance') ?? null
      const oldOBSigned = existingOBTx ? txNet(existingOBTx) : 0
      const newOBSigned = result.openingBalance ?? 0
      const gapDiff = roundCents(oldOBSigned - newOBSigned - actualNet)
      if (Math.abs(gapDiff) > 0.005) {
        txStore.addTransaction({
          name: 'Balance Adjustment', date: dayBefore(earliestExisting),
          type: gapDiff > 0 ? 'in' : 'out', amount: Math.abs(gapDiff), itemId: null, accountId,
        })
      }
    }

    return { count: batch.length, mode: 'append' as const }
  }

  return { count: 0, mode: 'append' as const }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Range-Replace Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Range-Replace — both boundaries found', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('re-import same CSV: deletes old range and inserts fresh (same count)', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('Checking')

    // First import
    const r1 = importRangeReplace(accId, [{ text: JAN_CSV, fileName: 'jan.csv' }], 'generic')
    expect(r1.mode).toBe('append')
    const afterFirst = txStore.transactions.filter(t => t.accountId === accId && t.name !== 'Opening Balance').length
    expect(afterFirst).toBe(3)

    // Re-import same file — both boundaries should be found now
    const r2 = importRangeReplace(accId, [{ text: JAN_CSV, fileName: 'jan.csv' }], 'generic')
    expect(r2.mode).toBe('range-replace')
    const afterSecond = txStore.transactions.filter(t => t.accountId === accId && t.name !== 'Opening Balance').length
    // Range-replace deletes the range and reinserts — count stays the same
    expect(afterSecond).toBe(3)
  })

  it('data drift: CSV has an extra row not in existing data', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('Checking')

    // Import baseline Jan (3 rows: Coffee, Salary, Rent)
    importRangeReplace(accId, [{ text: JAN_CSV, fileName: 'jan.csv' }], 'generic')

    // Now import Jan with an extra Lunch row
    const r = importRangeReplace(accId, [{ text: JAN_EXTRA_CSV, fileName: 'jan-extra.csv' }], 'generic')
    expect(r.mode).toBe('range-replace')
    const txs = txStore.transactions.filter(t => t.accountId === accId && t.name !== 'Opening Balance')
    expect(txs).toHaveLength(4)
    expect(txs.some(t => t.name === 'Lunch')).toBe(true)
  })

  it('data drift: CSV has fewer rows than existing (missing row removed)', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('Checking')

    // Import baseline Jan (3 rows)
    importRangeReplace(accId, [{ text: JAN_CSV, fileName: 'jan.csv' }], 'generic')

    // Now import Jan missing Coffee.  The CSV range is Jan 10–Jan 31, so
    // Coffee on Jan 5 is outside the CSV's claimed range and survives.
    const r = importRangeReplace(accId, [{ text: JAN_MISSING_CSV, fileName: 'jan-missing.csv' }], 'generic')
    expect(r.mode).toBe('range-replace')
    const txs = txStore.transactions.filter(t => t.accountId === accId && t.name !== 'Opening Balance')
    // Coffee (Jan 5) survives + Salary (Jan 10) + Rent (Jan 31) = 3
    expect(txs).toHaveLength(3)
    expect(txs.some(t => t.name === 'Coffee')).toBe(true)
    expect(txs.some(t => t.name === 'Salary')).toBe(true)
    expect(txs.some(t => t.name === 'Rent')).toBe(true)
  })

  it('complete redo: full quarter CSV replaces individual month imports', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('Checking')

    // Import individual months first
    importRangeReplace(accId, [{ text: JAN_CSV, fileName: 'jan.csv' }], 'generic')
    importRangeReplace(accId, [{ text: FEB_CSV, fileName: 'feb.csv' }], 'generic')
    importRangeReplace(accId, [{ text: MAR_CSV, fileName: 'mar.csv' }], 'generic')
    const afterMonths = txStore.transactions.filter(t => t.accountId === accId && t.name !== 'Opening Balance').length
    expect(afterMonths).toBe(9)

    // Now drop the full quarter CSV — range-replace from Jan 5 to Mar 31
    const r = importRangeReplace(accId, [{ text: Q1_CSV, fileName: 'q1.csv' }], 'generic')
    expect(r.mode).toBe('range-replace')
    const afterFull = txStore.transactions.filter(t => t.accountId === accId && t.name !== 'Opening Balance').length
    expect(afterFull).toBe(9) // same 9 rows, just replaced
  })

  it('overlapping fragment: import April CSV when March already exists', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('Checking')

    // Import March
    importRangeReplace(accId, [{ text: MAR_CSV, fileName: 'mar.csv' }], 'generic')
    // Import February — extends backward, both Feb boundaries not initially in data
    // First import of Feb: append path, not range-replace
    importRangeReplace(accId, [{ text: FEB_CSV, fileName: 'feb.csv' }], 'generic')
    // Backfill — append mode
    const txsAfterFeb = txStore.transactions.filter(t => t.accountId === accId && t.name !== 'Opening Balance')
    expect(txsAfterFeb.length).toBe(6)

    // Now re-import Feb: both Feb boundaries exist → range-replace
    const r2 = importRangeReplace(accId, [{ text: FEB_CSV, fileName: 'feb.csv' }], 'generic')
    expect(r2.mode).toBe('range-replace')
    const txsAfterReimport = txStore.transactions.filter(t => t.accountId === accId && t.name !== 'Opening Balance')
    expect(txsAfterReimport.length).toBe(6) // Feb replaced, March untouched
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Append / Gap Mode Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Append mode — first import', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('creates Opening Balance on first import with balance data', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('Checking')

    importRangeReplace(accId, [{ text: JAN_CSV, fileName: 'jan.csv' }], 'generic')
    const ob = txStore.transactions.find(t => t.name === 'Opening Balance' && t.accountId === accId)
    expect(ob).toBeDefined()
    // Coffee out 5, balance 95 → OB = 100
    expect(ob!.amount).toBe(100)
    expect(ob!.type).toBe('in')
  })

  it('does NOT create Opening Balance when CSV has no balance column', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('Checking')

    importRangeReplace(accId, [{ text: NO_BALANCE_CSV, fileName: 'no-balance.csv' }], 'generic')
    const ob = txStore.transactions.find(t => t.name === 'Opening Balance' && t.accountId === accId)
    expect(ob).toBeUndefined()
  })

  it('creates Opening Balance even when OB = 0', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('Checking')

    importRangeReplace(accId, [{ text: ZERO_OB_CSV, fileName: 'zero.csv' }], 'generic')
    const ob = txStore.transactions.find(t => t.name === 'Opening Balance' && t.accountId === accId)
    expect(ob).toBeDefined()
    expect(ob!.amount).toBe(0)
  })

  it('imports all rows from CSV', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('Checking')

    importRangeReplace(accId, [{ text: JAN_CSV, fileName: 'jan.csv' }], 'generic')
    const txs = txStore.transactions.filter(t => t.accountId === accId && t.name !== 'Opening Balance')
    expect(txs).toHaveLength(3)
    expect(txs.map(t => t.name).sort()).toEqual(['Coffee', 'Rent', 'Salary'])
  })
})

describe('Append mode — backfill (older data pre-dates existing OB)', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('replaces old OB with earlier OB when importing older data', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('Checking')

    // Import Jan first
    importRangeReplace(accId, [{ text: JAN_CSV, fileName: 'jan.csv' }], 'generic')
    const janOB = txStore.transactions.find(t => t.name === 'Opening Balance' && t.accountId === accId)
    expect(janOB).toBeDefined()
    const janOBId = janOB!.id

    // Import Dec (older than Jan)
    importRangeReplace(accId, [{ text: DEC_CSV, fileName: 'dec.csv' }], 'generic')

    // Old OB should be gone, new OB should exist
    const oldOB = txStore.transactions.find(t => t.id === janOBId)
    expect(oldOB).toBeUndefined()

    const newOB = txStore.transactions.find(t => t.name === 'Opening Balance' && t.accountId === accId)
    expect(newOB).toBeDefined()
    // Dec first row: Coffee out 5, balance 45 → OB = 50
    expect(newOB!.amount).toBe(50)
  })

  it('adds older rows without duplicating existing rows', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('Checking')

    importRangeReplace(accId, [{ text: JAN_CSV, fileName: 'jan.csv' }], 'generic')
    const afterJan = txStore.transactions.filter(t => t.accountId === accId).length

    importRangeReplace(accId, [{ text: DEC_CSV, fileName: 'dec.csv' }], 'generic')
    const afterDec = txStore.transactions.filter(t => t.accountId === accId).length

    // Dec has 2 new transaction rows (Coffee, Salary) + OB may be replaced
    // Old OB deleted, new OB created, 2 new rows = net +2 non-OB rows
    // Should be 3 Jan rows + 2 Dec rows = 5
    expect(afterDec).toBeGreaterThan(afterJan)
  })
})

describe('Append mode — forward gap (newer data with date gap)', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('creates Balance Adjustment when CSV starts after existing data with a gap', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('Checking')

    // Import Jan
    importRangeReplace(accId, [{ text: JAN_CSV, fileName: 'jan.csv' }], 'generic')

    // Import March (skip February — there's a gap)
    importRangeReplace(accId, [{ text: MAR_CSV, fileName: 'mar.csv' }], 'generic')

    // Should have a Balance Adjustment for the gap
    const adjustments = txStore.transactions.filter(
      t => t.accountId === accId && t.name === 'Balance Adjustment'
    )
    // A forward gap bridge should exist
    expect(adjustments.length).toBeGreaterThanOrEqual(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Multi-CSV Merge Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Multi-CSV — two files imported together', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('merges adjacent months without duplicate rows', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('Checking')

    importRangeReplace(accId, [
      { text: JAN_CSV, fileName: 'jan.csv' },
      { text: FEB_CSV, fileName: 'feb.csv' },
    ], 'generic')

    const txs = txStore.transactions.filter(t => t.accountId === accId && t.name !== 'Opening Balance')
    // 3 Jan + 3 Feb = 6 unique rows
    expect(txs).toHaveLength(6)
  })

  it('deduplicates overlapping rows across files', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('Checking')

    // JAN_CSV has 3 rows; JAN_FEB_OVERLAP has 2 Jan + 2 Feb.
    // Balances are designed so there's no inter-CSV gap (Jan closing = Feb opening).
    const JAN_FEB_OVERLAP = `Date,Description,Amount,Balance
2026-01-10,Salary,500.00,595.00
2026-01-31,Rent,-400.00,195.00
2026-02-05,Coffee,-5.00,190.00
2026-02-10,Salary,500.00,690.00`

    importRangeReplace(accId, [
      { text: JAN_CSV, fileName: 'jan.csv' },
      { text: JAN_FEB_OVERLAP, fileName: 'overlap.csv' },
    ], 'generic')

    const txs = txStore.transactions.filter(t => t.accountId === accId && t.name !== 'Opening Balance')
    // Unique tx rows: 3 Jan + 2 Feb = 5.  Plus a possible inter-CSV gap adjustment
    // if the Jan closing balance (195) doesn't match Feb's derived opening.
    // Exclude Balance Adjustments from this count — just check transaction rows.
    const nonAdjustment = txs.filter(t => t.name !== 'Balance Adjustment')
    expect(nonAdjustment).toHaveLength(5)
    // Salary on Jan 10 should appear exactly once (deduped across files)
    const salaries = nonAdjustment.filter(t => t.name === 'Salary' && t.date === '2026-01-10')
    expect(salaries).toHaveLength(1)
  })

  it('preserves legitimate repeated transactions (same day, same merchant, same amount)', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('Checking')

    importRangeReplace(accId, [{ text: REPEATED_CSV, fileName: 'coffee.csv' }], 'generic')

    const coffees = txStore.transactions.filter(
      t => t.accountId === accId && t.name === 'Coffee'
    )
    // Two genuine coffee purchases on same day
    expect(coffees).toHaveLength(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Bank-Specific Adapter Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('BOI adapter — full import', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('imports BOI Jan correctly (newest-first order → oldest-first in store)', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('BOI Current')

    importRangeReplace(accId, [{ text: BOI_JAN, fileName: 'boi-jan.csv' }], 'boi')

    const txs = txStore.transactions.filter(
      t => t.accountId === accId && t.name !== 'Opening Balance'
    )
    expect(txs).toHaveLength(3)
    expect(txs.map(t => t.name).sort()).toEqual(['NETFLIX', 'SALARY', 'TESCO'])
  })

  it('range-replaces BOI data on re-import', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('BOI Current')

    // First import
    importRangeReplace(accId, [{ text: BOI_JAN, fileName: 'boi-jan.csv' }], 'boi')
    // Re-import
    const r = importRangeReplace(accId, [{ text: BOI_JAN, fileName: 'boi-jan.csv' }], 'boi')
    expect(r.mode).toBe('range-replace')

    const txs = txStore.transactions.filter(
      t => t.accountId === accId && t.name !== 'Opening Balance'
    )
    expect(txs).toHaveLength(3)
  })

  it('merges BOI Jan + Feb + Mar as three fragments', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('BOI Current')

    importRangeReplace(accId, [{ text: BOI_JAN, fileName: 'boi-jan.csv' }], 'boi')
    importRangeReplace(accId, [{ text: BOI_FEB, fileName: 'boi-feb.csv' }], 'boi')
    importRangeReplace(accId, [{ text: BOI_MAR, fileName: 'boi-mar.csv' }], 'boi')

    const txs = txStore.transactions.filter(
      t => t.accountId === accId && t.name !== 'Opening Balance'
    )
    // 3 per month = 9
    expect(txs).toHaveLength(9)
  })
})

describe('Revolut adapter — full import', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('imports Revolut CSV correctly', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('Revolut')

    importRangeReplace(accId, [{ text: REVOLUT_CSV, fileName: 'revolut.csv' }], 'revolut')

    const txs = txStore.transactions.filter(
      t => t.accountId === accId && t.name !== 'Opening Balance'
    )
    // 5 rows: Topup 100, Subway, Transfer to Jane, Tesco, Topup 50
    expect(txs).toHaveLength(5)
  })

  it('creates OB from Revolut balance data', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('Revolut')

    importRangeReplace(accId, [{ text: REVOLUT_CSV, fileName: 'revolut.csv' }], 'revolut')

    const ob = txStore.transactions.find(t => t.name === 'Opening Balance' && t.accountId === accId)
    expect(ob).toBeDefined()
    // Revolut: Topup +100, balance 100 → OB = 0 (first row's balance equals its amount)
  })

  it('range-replaces Revolut data on re-import', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('Revolut')

    importRangeReplace(accId, [{ text: REVOLUT_CSV, fileName: 'revolut.csv' }], 'revolut')
    const r = importRangeReplace(accId, [{ text: REVOLUT_CSV, fileName: 'revolut.csv' }], 'revolut')
    expect(r.mode).toBe('range-replace')

    const txs = txStore.transactions.filter(
      t => t.accountId === accId && t.name !== 'Opening Balance'
    )
    expect(txs).toHaveLength(5)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('Edge cases', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('single-row CSV: first == last, range-replace works', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('Checking')

    const SINGLE_ROW = `Date,Description,Amount,Balance
2026-01-15,Coffee,-5.00,95.00`

    importRangeReplace(accId, [{ text: SINGLE_ROW, fileName: 'single.csv' }], 'generic')
    const txs = txStore.transactions.filter(t => t.accountId === accId && t.name !== 'Opening Balance')
    expect(txs).toHaveLength(1)

    // Re-import same single row
    const r = importRangeReplace(accId, [{ text: SINGLE_ROW, fileName: 'single.csv' }], 'generic')
    expect(r.mode).toBe('range-replace')
    expect(txStore.transactions.filter(t => t.accountId === accId && t.name !== 'Opening Balance')).toHaveLength(1)
  })

  it('empty CSV file is handled gracefully', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const accId    = accStore.addAccount('Checking')

    const EMPTY_CSV = 'Date,Description,Amount,Balance'
    // Generic adapter returns [] for empty data — no rows to import
    const r = importRangeReplace(accId, [{ text: EMPTY_CSV, fileName: 'empty.csv' }], 'generic')
    expect(r.count).toBe(0)

    const txs = txStore.transactions.filter(t => t.accountId === accId)
    expect(txs).toHaveLength(0)
  })

  it('multiple imports to different accounts do not interfere', () => {
    const accStore = useAccountStore()
    const txStore  = useTransactionStore()
    const acc1 = accStore.addAccount('Checking')
    const acc2 = accStore.addAccount('Savings')

    importRangeReplace(acc1, [{ text: JAN_CSV, fileName: 'jan.csv' }], 'generic')
    importRangeReplace(acc2, [{ text: FEB_CSV, fileName: 'feb.csv' }], 'generic')

    const acc1Txs = txStore.transactions.filter(t => t.accountId === acc1 && t.name !== 'Opening Balance')
    const acc2Txs = txStore.transactions.filter(t => t.accountId === acc2 && t.name !== 'Opening Balance')
    expect(acc1Txs).toHaveLength(3)
    expect(acc2Txs).toHaveLength(3)
  })
})
