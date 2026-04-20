// ── adapters/kandusBankinAdapter.ts ──────────────────────────────────────────
//
// Kandus Bankin (Sweden) CSV export format:
//
//   Reskontradatum;Transaktionsdatum;Text;Belopp;Saldo
//   2026-04-20;2026-04-18;FURVESTER;-2928,29;2243,19
//   2026-04-20;2026-04-17;SKINDERGADE 1.;-294,91;5171,48
//
// Key characteristics:
//   • Semicolon-delimited.
//   • All headers are in Swedish.
//   • Dates in ISO YYYY-MM-DD format.
//   • Newest transaction is the FIRST data row (newest-first order).
//   • Amounts use comma as the decimal separator (European format, 2 d.p.).
//   • Belopp (amount): negative = debit (out), positive = credit (in).
//   • Saldo (balance) is populated on every row.
//   • The header row may have trailing empty comma-separated fields — handled
//     by matching column names with startsWith rather than exact equality.

import type { CsvAdapter, ParsedRow } from '../csvAdapters';
import { parseDate, parseAmount, dayBefore } from '../csvUtils';

const kandusBankinAdapter: CsvAdapter = {
  id: 'kandus-bankin',
  name: 'Kandus Bankin',
  currency: 'SEK',
  amountDecimals: 2,
  balanceDecimals: 2,
  rowOrder: 'newest-first',

  // ── Detection ────────────────────────────────────────────────────────────────
  detect(headers: string[]): number {
    const h = headers.map(s => s.toLowerCase().trim());

    // Distinctive Swedish headers unique to this bank
    const hasReskontradatum    = h.some(s => s.startsWith('reskontradatum'));
    const hasTransaktionsdatum = h.some(s => s.startsWith('transaktionsdatum'));
    const hasText              = h.some(s => s === 'text');
    const hasBelopp            = h.some(s => s.startsWith('belopp'));
    const hasSaldo             = h.some(s => s.startsWith('saldo'));

    // Both date columns being present is a very strong signal
    if (hasReskontradatum && hasTransaktionsdatum && hasBelopp && hasSaldo) return 0.97;
    if (hasReskontradatum && hasTransaktionsdatum) return 0.7;
    if (hasReskontradatum || hasTransaktionsdatum) return 0.3;

    const score = [hasText, hasBelopp, hasSaldo].filter(Boolean).length;
    return score >= 3 ? 0.1 : 0;
  },

  // ── Parse ─────────────────────────────────────────────────────────────────────
  parse(headers: string[], dataLines: string[][]): ParsedRow[] {
    const h = headers.map(s => s.toLowerCase().trim());

    const amountDecimals  = kandusBankinAdapter.amountDecimals  ?? 2;
    const balanceDecimals = kandusBankinAdapter.balanceDecimals ?? 2;

    // Match by startsWith to tolerate trailing artefacts (e.g. "saldo,,")
    const col = (pats: string[]) =>
      h.findIndex(s => pats.some(p => s.startsWith(p) || s === p));

    const dateCol    = col(['reskontradatum']);
    const textCol    = col(['text']);
    const amountCol  = col(['belopp']);
    const balanceCol = col(['saldo']);

    if (dateCol < 0 || amountCol < 0) return [];

    const rows: ParsedRow[] = [];

    for (const cols of dataLines) {
      const isoDate = parseDate(cols[dateCol]?.trim() ?? '');
      if (!isoDate) continue;

      const details = textCol >= 0 ? (cols[textCol]?.trim() ?? '') : '';

      // Strip any trailing commas that can appear on the last field of a row
      const rawAmountStr  = (cols[amountCol]  ?? '').replace(/,+$/, '').trim();
      const rawBalanceStr = (cols[balanceCol] ?? '').replace(/,+$/, '').trim();

      const rawAmount = parseAmount(rawAmountStr);
      if (isNaN(rawAmount) || rawAmount === 0) continue;

      const amount = Math.abs(rawAmount);
      const type: 'in' | 'out' = rawAmount > 0 ? 'in' : 'out';

      const rawBalance = balanceCol >= 0 ? parseAmount(rawBalanceStr) : NaN;
      const balance = !isNaN(rawBalance) ? parseFloat(rawBalance.toFixed(balanceDecimals)) : null;

      rows.push({
        isoDate,
        yearMonth: isoDate.slice(0, 7),
        details,
        amount: parseFloat(amount.toFixed(amountDecimals)),
        type,
        balance,
      });
    }

    // Kandus Bankin exports newest-first; reverse to return oldest-first
    return rows.reverse();
  },

  // ── Opening balance ───────────────────────────────────────────────────────────
  getOpeningBalance(rows: ParsedRow[]): number | null {
    if (rows.length === 0) return null;
    const oldest = rows[0];
    if (oldest.balance === null || typeof oldest.amount !== 'number') return null;
    const opening = oldest.type === 'in'
      ? oldest.balance - oldest.amount
      : oldest.balance + oldest.amount;
    return parseFloat(opening.toFixed(2));
  },

  getOpeningDate(rows: ParsedRow[]): string {
    if (rows.length === 0) return '';
    return dayBefore(rows[0].isoDate);
  },
};

export default kandusBankinAdapter;
