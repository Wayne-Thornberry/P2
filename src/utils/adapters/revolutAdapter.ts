import type { CsvAdapter, ParsedRow } from '../csvAdapters';
import { parseAmount, parseDate } from '../csvUtils';

// Robust CSV line parser (handles quoted fields and commas inside quotes)
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

const revolutAdapter: CsvAdapter = {
  id: 'revolut',
  name: 'Revolut',
  rowOrder: 'oldest-first',
  detect(headers) {
    const hs = headers.map(h => h.toLowerCase().trim());
    let score = 0;
    if (hs.some(h => h === 'completed date' || h === 'started date')) score += 0.4;
    if (hs.includes('amount')) score += 0.2;
    if (hs.includes('currency')) score += 0.2;
    if (hs.includes('state')) score += 0.2;
    return score;
  },
  parse(headers, lines) {
    if (!headers.length || !lines.length) return [];
    const headerCells = parseCsvLine(typeof headers[0] === 'string' ? headers[0] : (headers[0] as string[]).join(','));
    const idx = (pat: RegExp) => headerCells.findIndex(h => pat.test(h));
    const dateCol = (() => {
      const c = idx(/^completed date$/i);
      return c >= 0 ? c : idx(/^started date$/i);
    })();
    const detailCol = idx(/^description$/i);
    const amountCol = idx(/^amount$/i);
    const balanceCol = idx(/^balance$/i);
    if (dateCol < 0 || amountCol < 0) return [];

    const rows: ParsedRow[] = [];
    for (const line of lines) {
      if (typeof line !== 'string') continue;
      const cols = parseCsvLine(line);
      if (cols.length <= amountCol) continue;
      const isoDate = parseDate(cols[dateCol]?.trim() ?? '');
      if (!isoDate) continue;
      const details = detailCol >= 0 ? cols[detailCol]?.trim() ?? '' : '';
      if (!details) continue;
      const rawAmt = parseAmount(cols[amountCol] ?? '');
      if (isNaN(rawAmt) || rawAmt === 0) continue;
      const amount = Math.abs(rawAmt);
      const type: 'in' | 'out' = rawAmt > 0 ? 'in' : 'out';
      const balance = balanceCol >= 0 ? parseAmount(cols[balanceCol] ?? '') : NaN;
      rows.push({
        isoDate,
        yearMonth: isoDate.slice(0, 7),
        details,
        amount,
        type,
        balance: isNaN(balance) ? null : balance,
      });
    }
    return rows;
  },
  getOpeningBalance(rows) {
    if (!rows.length) return null;
    const first = rows[0];
    return (first.balance !== null && first.amount !== undefined)
      ? (first.type === 'in'
        ? first.balance - Math.abs(first.amount)
        : first.balance + Math.abs(first.amount))
      : null;
  },
};

export default revolutAdapter;