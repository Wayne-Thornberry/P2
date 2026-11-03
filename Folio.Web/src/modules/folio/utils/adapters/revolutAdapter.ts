// ── adapters/revolutAdapter.ts ────────────────────────────────────────────────
//
// Revolut CSV export format:
//
//   Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
//   Topup,Current,02/12/2023 17:22,02/12/2023 17:23,Top-up by *****,15,0,EUR,COMPLETED,15
//   Card Payment,Current,06/12/2023 18:02,07/12/2023 5:36,Tesco,-27.75,0,EUR,COMPLETED,25.45
//
// Key characteristics:
//   • Comma-delimited.
//   • Dates in DD/MM/YYYY HH:MM format — time portion must be stripped before parsing.
//   • Amount is signed: positive = in, negative = out.
//   • Balance column reflects running balance AFTER the transaction.
//   • Rows are oldest-first.
//   • Only COMPLETED rows are imported; pending/reverted rows are skipped.

import type { CsvAdapter, ParsedRow } from '../csvAdapters';
import { parseAmount, dayBefore } from '../csvUtils';

/** Extract the date-only part from a Revolut datetime string like "02/12/2023 17:22". */
function parseRevolutDate(raw: string): string | null {
  const s = raw.trim();
  // DD/MM/YYYY HH:MM  or  DD/MM/YYYY
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : iso;
}

const revolutAdapter: CsvAdapter = {
  id: 'revolut',
  name: 'Revolut',
  currency: 'EUR',
  amountDecimals: 2,
  balanceDecimals: 2,
  rowOrder: 'oldest-first',

  // ── Detection ────────────────────────────────────────────────────────────────
  // Headers arrive pre-lowercased from splitCsvText.
  // "completed date" or "started date" is highly distinctive for Revolut.
  detect(headers: string[]): number {
    let score = 0;
    if (headers.includes('completed date') || headers.includes('started date')) score += 0.5;
    if (headers.includes('state'))    score += 0.2;
    if (headers.includes('currency')) score += 0.2;
    if (headers.includes('amount'))   score += 0.1;
    return score;
  },

  // ── Parse ─────────────────────────────────────────────────────────────────────
  // dataLines is string[][] — one string[] per row, fields already split by splitCsvText.
  parse(headers: string[], dataLines: string[][]): ParsedRow[] {
    const fi = (name: string) => headers.indexOf(name);

    // Prefer completed date; fall back to started date
    const dateCol    = fi('completed date') >= 0 ? fi('completed date') : fi('started date');
    const detailCol  = fi('description');
    const amountCol  = fi('amount');
    const balanceCol = fi('balance');
    const stateCol   = fi('state');
    const currencyCol = fi('currency');

    if (dateCol < 0 || amountCol < 0) return [];

    const rows: ParsedRow[] = [];

    for (const cols of dataLines) {
      // Skip non-completed rows (PENDING, REVERTED, FAILED, etc.)
      if (stateCol >= 0) {
        const state = cols[stateCol]?.trim().toUpperCase() ?? '';
        if (state && state !== 'COMPLETED') continue;
      }

      // Skip rows whose currency doesn't match this adapter's currency.
      // Revolut exports can mix currencies (e.g. EUR + SEK in one file).
      if (currencyCol >= 0 && this.currency) {
        const rowCurrency = cols[currencyCol]?.trim().toUpperCase() ?? '';
        if (rowCurrency && rowCurrency !== this.currency.toUpperCase()) continue;
      }

      const isoDate = parseRevolutDate(cols[dateCol]?.trim() ?? '');
      if (!isoDate) continue;

      const details = detailCol >= 0 ? (cols[detailCol]?.trim() ?? '') : '';

      const rawAmt = parseAmount(cols[amountCol]?.trim() ?? '');
      if (isNaN(rawAmt) || rawAmt === 0) continue;

      const amount = Math.abs(rawAmt);
      const type: 'in' | 'out' = rawAmt > 0 ? 'in' : 'out';

      const rawBal = balanceCol >= 0 ? parseAmount(cols[balanceCol]?.trim() ?? '') : NaN;
      const balance = isNaN(rawBal) ? null : rawBal;

      rows.push({ isoDate, yearMonth: isoDate.slice(0, 7), details, amount, type, balance });
    }

    return rows;
  },

  // ── Opening balance ───────────────────────────────────────────────────────────
  // balance of first row = balance AFTER first transaction.
  // Undo it to get the balance BEFORE the first transaction.
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

export default revolutAdapter;