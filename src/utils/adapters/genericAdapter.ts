// ── adapters/genericAdapter.ts ───────────────────────────────────────────────
//
// Generic fallback adapter.
//
// Handles any CSV that has at minimum:
//   • A date column  (header matches: date, time)
//   • Either a single signed Amount column, OR separate Debit + Credit columns
//
// Optional columns picked up when present:
//   • Description / narrative / details / memo / reference / payee
//   • Balance
//
// Delimiter and date format are auto-detected via csvUtils helpers.
// Returns 0.1 confidence so it only wins when no bank-specific adapter fires.

import type { CsvAdapter, ParsedRow } from '../csvAdapters';
import { parseDate, parseAmount, dayBefore } from '../csvUtils';

const genericAdapter: CsvAdapter = {
  id: 'generic',
  name: 'Generic CSV',
  rowOrder: 'oldest-first',  // conservative assumption

  detect(): number {
    // Always a last-resort candidate — never beats a specific adapter
    return 0.1;
  },

  parse(headers: string[], dataLines: string[][]): ParsedRow[] {
    const h = headers.map(s => s.toLowerCase().trim());

    // Helper: index of first header matching a regex
    const fi = (pat: RegExp) => h.findIndex(s => pat.test(s));

    const dateCol    = fi(/\b(date|time)\b/);
    const detailCol  = fi(/\b(desc|narrat|detail|memo|reference|ref|payee|beneficiar)/);
    const amountCol  = fi(/^amount$/);
    const debitCol   = fi(/\b(debit|withdrawal|dr\.?)$/);
    const creditCol  = fi(/\b(credit|deposit|cr\.?)$/);
    const balanceCol = fi(/\bbalance\b/);

    // Must have a date and at least one amount source
    if (dateCol < 0) return [];
    if (amountCol < 0 && (debitCol < 0 || creditCol < 0)) return [];

    const rows: ParsedRow[] = [];

    for (const cols of dataLines) {
      const isoDate = parseDate(cols[dateCol]?.trim() ?? '');
      if (!isoDate) continue;

      const details = detailCol >= 0 ? (cols[detailCol]?.trim() ?? '') : '';

      const rawBalance = balanceCol >= 0 ? parseAmount(cols[balanceCol] ?? '') : NaN;
      const balance = !isNaN(rawBalance) ? rawBalance : null;

      let amount: number;
      let type: 'in' | 'out';

      if (amountCol >= 0) {
        // Single signed amount column: negative = out, positive = in
        const raw = parseAmount(cols[amountCol] ?? '');
        if (isNaN(raw) || raw === 0) continue;
        amount = Math.abs(raw);
        type   = raw > 0 ? 'in' : 'out';
      } else {
        // Separate debit / credit columns (both expected to be positive)
        const credit = parseAmount(cols[creditCol] ?? '');
        const debit  = parseAmount(cols[debitCol]  ?? '');
        if (!isNaN(credit) && credit > 0) {
          amount = credit;
          type   = 'in';
        } else if (!isNaN(debit) && debit > 0) {
          amount = debit;
          type   = 'out';
        } else {
          continue;
        }
      }

      rows.push({
        isoDate,
        yearMonth: isoDate.slice(0, 7),
        details,
        amount: parseFloat(amount.toFixed(2)),
        type,
        balance,
      });
    }

    return rows;
  },

  // ── Opening balance ───────────────────────────────────────────────────────────
  // Best-effort: use the first row's balance and reverse its transaction.
  // Returns null if no balance data is present.
  getOpeningBalance(rows: ParsedRow[]): number | null {
    if (rows.length === 0) return null;
    const first = rows[0];
    if (first.balance === null) return null;
    const opening = first.type === 'in'
      ? first.balance - first.amount
      : first.balance + first.amount;
    return parseFloat(opening.toFixed(2));
  },

  getOpeningDate(rows: ParsedRow[]): string {
    if (rows.length === 0) return '';
    return dayBefore(rows[0].isoDate);
  },
};

export default genericAdapter;