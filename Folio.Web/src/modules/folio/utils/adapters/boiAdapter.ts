// ── adapters/boiAdapter.ts ────────────────────────────────────────────────────
//
// Bank of Ireland CSV export format:
//
//   Date,Details,Debit,Credit,Balance
//   19/04/2026,16APR AN POST-OFFICE,23.00,,75.53
//   19/04/2026,17APR EFLOW.IE,10.00,,
//   17/04/2026,365 Online  64591807,,200.00,228.67
//
// Key characteristics:
//   • Comma-delimited, no quoting in practice.
//   • Dates in DD/MM/YYYY format.
//   • Newest transaction is the FIRST data row (newest-first order).
//   • Balance column is sparse: only the FIRST row of each calendar day carries
//     the closing balance for that day. All other rows in the same day are blank.
//   • Separate Debit / Credit columns (both positive numbers).
//   • The opening balance is reconstructed by working backwards from the first
//     balance value: sum up all transactions that appear above (i.e. newer than)
//     the first populated balance cell.

import type { CsvAdapter, ParsedRow } from '../csvAdapters';
import { parseDate, parseAmount, dayBefore } from '../csvUtils';

const boiAdapter: CsvAdapter = {
  id: 'boi',
  name: 'Bank of Ireland',
  currency: 'EUR',
  amountDecimals: 2,
  balanceDecimals: 2,
  rowOrder: 'newest-first',

  // ── Detection ────────────────────────────────────────────────────────────────
  detect(headers: string[]): number {
    const h = headers.map(s => s.toLowerCase().trim());
    const hasDate    = h.includes('date');
    const hasDetails = h.includes('details');
    const hasDebit   = h.includes('debit');
    const hasCredit  = h.includes('credit');
    const hasBalance = h.includes('balance');
    // All five BOI columns present → high confidence
    if (hasDate && hasDetails && hasDebit && hasCredit && hasBalance) return 0.9;
    // Four out of five → medium
    if ([hasDate, hasDetails, hasDebit, hasCredit, hasBalance].filter(Boolean).length >= 4) return 0.6;
    return 0;
  },

  // ── Parse ─────────────────────────────────────────────────────────────────────
  parse(headers: string[], dataLines: string[][]): ParsedRow[] {
    const h = headers.map(s => s.toLowerCase().trim());

    const col = (pat: RegExp) => h.findIndex(s => pat.test(s));
    const dateCol    = col(/^date$/);
    const detailCol  = col(/^details?$/);
    const debitCol   = col(/^debit$/);
    const creditCol  = col(/^credit$/);
    const balanceCol = col(/^balance$/);

    if (dateCol < 0 || (debitCol < 0 && creditCol < 0)) return [];

    // ── Pass 1: build raw rows in the original (newest-first) order ───────────
    // Balance cells are sparse; we track the last seen balance as we scan top→bottom
    // (newest→oldest) so we can carry it backwards to fill gaps.

    type RawRow = {
      isoDate: string;
      details: string;
      amount: number;
      type: 'in' | 'out';
      rawBalance: number | null;  // only populated on the first row of each day
    };

    const rawRows: RawRow[] = [];
    for (const cols of dataLines) {
      const isoDate = parseDate(cols[dateCol]?.trim() ?? '');
      if (!isoDate) continue;

      const details = detailCol >= 0 ? (cols[detailCol]?.trim() ?? '') : '';

      // Amount — separate debit/credit columns
      const debitRaw  = debitCol  >= 0 ? parseAmount(cols[debitCol]  ?? '') : NaN;
      const creditRaw = creditCol >= 0 ? parseAmount(cols[creditCol] ?? '') : NaN;

      let amount: number;
      let type: 'in' | 'out';

      if (!isNaN(creditRaw) && creditRaw > 0) {
        amount = creditRaw;
        type   = 'in';
      } else if (!isNaN(debitRaw) && debitRaw > 0) {
        amount = debitRaw;
        type   = 'out';
      } else {
        continue; // no valid amount, skip
      }

      const balRaw = balanceCol >= 0 ? parseAmount(cols[balanceCol] ?? '') : NaN;
      const rawBalance = !isNaN(balRaw) ? balRaw : null;

      rawRows.push({ isoDate, details, amount, type, rawBalance });
    }

    if (rawRows.length === 0) return [];

    // ── Pass 2: propagate balance backwards ───────────────────────────────────
    // BOI puts the balance only on the first (newest) row of each day.
    // We scan newest→oldest. The first balance value we encounter is the
    // closing balance AFTER that row. For all rows above it (newer, but same day)
    // we back-calculate by reversing each transaction.
    //
    // After propagation every row will have a balance = account balance AFTER
    // that transaction was applied.

    const withBalance: Array<RawRow & { balance: number | null }> = rawRows.map(r => ({
      ...r,
      balance: r.rawBalance,
    }));

    // Find the first row that has a balance value (scanning newest→oldest = index 0+)
    let anchorIdx = withBalance.findIndex(r => r.balance !== null);

    if (anchorIdx >= 0) {
      // Forward from anchor toward index 0 (newer rows) — back-calculate
      let runningBalance = withBalance[anchorIdx].balance!;
      for (let i = anchorIdx - 1; i >= 0; i--) {
        const row = withBalance[i];
        // To undo this row: if it was a debit (money out), add it back; if credit, subtract
        runningBalance = row.type === 'out'
          ? runningBalance + row.amount
          : runningBalance - row.amount;
        withBalance[i].balance = parseFloat(runningBalance.toFixed(this.balanceDecimals));
      }

      // Backward from anchor toward end (older rows) — forward-calculate
      runningBalance = withBalance[anchorIdx].balance!;
      for (let i = anchorIdx + 1; i < withBalance.length; i++) {
        // Balance BEFORE this (older) row = balance after anchor, minus net of rows between
        // Simpler: each step going older, undo the row above (newer)
        const prev = withBalance[i - 1];
        runningBalance = prev.type === 'out'
          ? runningBalance + prev.amount     // prev took money out → older balance was higher
          : runningBalance - prev.amount;    // prev put money in  → older balance was lower
        withBalance[i].balance = parseFloat(runningBalance.toFixed(this.balanceDecimals));
      }
    }

    // ── Pass 3: reverse to oldest-first and return ParsedRows ─────────────────
    return withBalance.reverse().map(r => ({
      isoDate:   r.isoDate,
      yearMonth: r.isoDate.slice(0, 7),
      details:   r.details,
      amount:    r.amount,
      type:      r.type,
      balance:   r.balance,
    }));
  },

  // ── Opening balance ───────────────────────────────────────────────────────────
  // After parse() has returned oldest-first rows with propagated balances,
  // the opening balance = balance of first row MINUS the first transaction.
  getOpeningBalance(rows: ParsedRow[]): number | null {
    if (rows.length === 0) return null;
    const first = rows[0];
    if (first.balance === null) return null;
    const opening = first.type === 'in'
      ? first.balance - first.amount
      : first.balance + first.amount;
    return parseFloat(opening.toFixed(this.balanceDecimals));
  },

  getOpeningDate(rows: ParsedRow[]): string {
    if (rows.length === 0) return '';
    return dayBefore(rows[0].isoDate);
  },
};

export default boiAdapter;