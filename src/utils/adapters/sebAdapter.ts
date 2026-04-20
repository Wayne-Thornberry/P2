// ── adapters/sebAdapter.ts ────────────────────────────────────────────────────
//
// SEB (Skandinaviska Enskilda Banken) CSV export format:
//
//   Booking date;Value date;Voucher number;Text;Amount;Balance
//   2025-12-30;2025-12-30;5484015687;APOTEK HJART/25-12-29;-206.710;162212.130
//   2025-12-30;2025-12-30;5484526386;ICA KVANTUM /25-12-29;-148.600;162418.840
//   2025-12-29;2025-12-29;5484382397;BALICE      /25-12-28;-19.680;162567.440
//
// Key characteristics:
//   • Semicolon-delimited.
//   • Dates in ISO YYYY-MM-DD format.
//   • Newest transaction is the FIRST data row (newest-first order).
//   • Amount column: negative = debit (money out), positive = credit (money in).
//   • Balance column is fully populated on every row — it reflects the running
//     account balance AFTER each transaction.
//   • Numbers use a period as decimal separator and may have 3 decimal places
//     (the bank stores amounts in smaller currency units internally).

import type { CsvAdapter, ParsedRow } from '../csvAdapters';
import { parseDate, parseAmount, dayBefore } from '../csvUtils';

const sebAdapter: CsvAdapter = {
  id: 'seb',
  name: 'SEB',
  currency: 'SEK',
  amountDecimals: 3,
  balanceDecimals: 3,
  rowOrder: 'newest-first',

  // ── Detection ────────────────────────────────────────────────────────────────
  detect(headers: string[]): number {
    const h = headers.map(s => s.toLowerCase().trim());
    const hasBookingDate  = h.some(s => s === 'booking date' || s === 'bokföringsdag');
    const hasValueDate    = h.some(s => s === 'value date'   || s === 'valutadag');
    const hasVoucher      = h.some(s => s.includes('voucher') || s.includes('verifikationsnummer'));
    const hasText         = h.some(s => s === 'text');
    const hasAmount       = h.some(s => s === 'amount'  || s === 'belopp');
    const hasBalance      = h.some(s => s === 'balance' || s === 'saldo');

    const score = [hasBookingDate, hasValueDate, hasVoucher, hasText, hasAmount, hasBalance]
      .filter(Boolean).length;

    // 5–6 matches → very confident it's SEB
    if (score >= 5) return 0.95;
    if (score >= 3) return 0.5;
    return 0;
  },

  // ── Parse ─────────────────────────────────────────────────────────────────────
  parse(headers: string[], dataLines: string[][]): ParsedRow[] {
    const h = headers.map(s => s.toLowerCase().trim());

    const amountDecimals = sebAdapter.amountDecimals ?? 2;
    const balanceDecimals = sebAdapter.balanceDecimals ?? 2;

    const col = (pats: string[]) =>
      h.findIndex(s => pats.some(p => s.includes(p)));

    // Accept both English and Swedish column names
    const dateCol    = col(['booking date', 'bokföringsdag']);
    const textCol    = col(['text']);
    const amountCol  = col(['amount', 'belopp']);
    const balanceCol = col(['balance', 'saldo']);

    if (dateCol < 0 || amountCol < 0) return [];

    const rows: ParsedRow[] = [];

    for (const cols of dataLines) {
      const isoDate = parseDate(cols[dateCol]?.trim() ?? '');
      if (!isoDate) continue;

      const details = textCol >= 0 ? (cols[textCol]?.trim() ?? '') : '';

      const rawAmountStr = cols[amountCol] ?? '';
      const rawAmount = parseAmount(rawAmountStr);
      if (isNaN(rawAmount) || rawAmount === 0) continue;

      // Debug: log the raw CSV value and parsed value
      console.log('[SEB parse] rawAmountStr:', rawAmountStr, 'parsed:', rawAmount);

      const amount = Math.abs(rawAmount);
      const type: 'in' | 'out' = rawAmount > 0 ? 'in' : 'out';

      const rawBalance = balanceCol >= 0 ? parseAmount(cols[balanceCol] ?? '') : NaN;
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

    // SEB exports newest-first; reverse to return oldest-first
    return rows.reverse();
  },

  // ── Opening balance ───────────────────────────────────────────────────────────
  // SEB provides a balance on every row, so this is straightforward.
  // Opening balance = balance after oldest row, reversed by that row's effect.
  getOpeningBalance(rows: ParsedRow[]): number | null {
    if (rows.length === 0) return null;
    const oldest = rows[0];
    console.log('[SEB getOpeningBalance] Oldest record:', oldest);
    if (oldest.balance === null || typeof oldest.amount !== 'number') return null;
    const opening = oldest.type === 'in'
      ? oldest.balance - oldest.amount
      : oldest.balance + oldest.amount;
    return parseFloat(opening.toFixed(3));
  },

  getOpeningDate(rows: ParsedRow[]): string {
    if (rows.length === 0) return '';
    return dayBefore(rows[0].isoDate);
  },
};

export default sebAdapter;