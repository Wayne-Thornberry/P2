// ── Shared types ─────────────────────────────────────────────────────────────

export type ParsedRow = {
  isoDate: string;
  yearMonth: string;
  details: string;
  amount: number;
  type: 'in' | 'out';
  balance: number | null;
};

export interface CsvAdapter {
  /** Number of decimals for amounts (e.g. 2 for EUR, 3 for SEK). */
  readonly amountDecimals?: number;
  /** Number of decimals for balances. */
  readonly balanceDecimals?: number;
  readonly id: string;
  /** Display name shown in the import dialog. */
  readonly name: string;
  /** ISO 4217 currency code (e.g. 'EUR', 'SEK', 'USD'). */
  readonly currency?: string;
  /**
   * Order in which the bank exports rows.
   * 'newest-first': most recent transaction is row 1 (BOI style).
   * 'oldest-first': oldest transaction is row 1 (Revolut style).
   */
  readonly rowOrder: 'newest-first' | 'oldest-first';
  /**
   * Returns a confidence score 0–1.
   * All registered adapters are scored; the highest wins.
   * Return 0 to never win (but still be a candidate as a last resort).
   */
  detect(headers: string[], rawLines: string[]): number;
  /** Parse pre-split data lines (header row already excluded) into rows. */
  parse(headers: string[], dataLines: string[][]): ParsedRow[];
  /** Optional: Adapter-specific opening balance calculation. */
  getOpeningBalance?: (rows: ParsedRow[]) => number | null;
  /** Optional: Adapter-specific opening date calculation. */
  getOpeningDate?: (rows: ParsedRow[]) => string;
}

/** Result of parsing a single CSV file. */
export type CsvFileResult = {
  adapter: CsvAdapter;
  rows: ParsedRow[];           // sorted oldest-first
  openingBalance: number | null; // balance BEFORE the oldest row in this file
  closingBalance: number | null; // balance AFTER the newest row in this file
  oldestDate: string;
  newestDate: string;
  fileName: string;
};

/** A synthetic balance-adjustment entry to bridge a date gap between two CSVs. */
export type GapAdjustment = {
  date: string;
  amount: number;
  type: 'in' | 'out';
  label: string;
};

/** Aggregated result of processing one or more CSV files together. */
export type MultiCsvResult = {
  adapter: CsvAdapter;
  allRows: ParsedRow[];        // merged + deduplicated, sorted oldest-first
  openingBalance: number | null; // account-level balance before the oldest row
  openingDate: string;         // date for the Opening Balance tx (day before oldest row)
  closingBalance: number | null; // balance after the newest row across all files
  gapAdjustments: GapAdjustment[]; // balance bridges between non-adjacent CSV files
  csvSummaries: Array<{
    fileName: string;
    rowCount: number;
    oldestDate: string;
    newestDate: string;
    openingBalance: number | null;
    closingBalance: number | null;
    adapterName: string;
  }>;
};


// ── Registry ─────────────────────────────────────────────────────────────────

import boiAdapter from './adapters/boiAdapter';
import revolutAdapter from './adapters/revolutAdapter';
import sebAdapter from './adapters/sebAdapter';
import genericAdapter from './adapters/genericAdapter.ts';
import { detectDelimiter, splitCsvLine } from './csvUtils';

export const CSV_ADAPTERS: readonly CsvAdapter[] = [
  boiAdapter,
  revolutAdapter,
  sebAdapter,
  genericAdapter, // Must remain last — lowest-confidence fallback
];


// ── Internal: parse one raw CSV text into headers + split data lines ──────────

type SplitCsv = {
  headers: string[];      // lower-cased, trimmed field names
  dataLines: string[][];  // one string[] per data row, fields already split + trimmed
  rawLines: string[];     // original unsplit lines (for adapter.detect())
};

function splitCsvText(text: string): SplitCsv {
  const rawLines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (rawLines.length === 0) {
    return { headers: [], dataLines: [], rawLines: [] };
  }

  const delimiter = detectDelimiter(rawLines[0]);
  const headers = splitCsvLine(rawLines[0], delimiter).map(h => h.toLowerCase().trim());
  const dataLines = rawLines.slice(1).map(l => splitCsvLine(l, delimiter));

  return { headers, dataLines, rawLines: rawLines.slice(1) };
}


// ── Internal: select the best adapter for a set of headers + raw lines ────────

function selectAdapter(
  headers: string[],
  rawLines: string[],
  forcedAdapterId?: string
): CsvAdapter {
  if (forcedAdapterId) {
    const forced = CSV_ADAPTERS.find(a => a.id === forcedAdapterId);
    if (!forced) throw new Error(`Unknown adapter id: "${forcedAdapterId}"`);
    return forced;
  }

  let best: CsvAdapter = CSV_ADAPTERS[CSV_ADAPTERS.length - 1]; // generic fallback
  let bestScore = -1;

  for (const adapter of CSV_ADAPTERS) {
    const score = adapter.detect(headers, rawLines);
    if (score > bestScore) {
      bestScore = score;
      best = adapter;
    }
  }

  return best;
}


// ── Public: parse a single CSV file ──────────────────────────────────────────

export function parseSingleCsvFile(
  text: string,
  fileName: string,
  forcedAdapterId?: string
): CsvFileResult {
  const { headers, dataLines, rawLines } = splitCsvText(text);
  const adapter = selectAdapter(headers, rawLines, forcedAdapterId);

  // Adapter returns rows sorted oldest-first
  const rows = adapter.parse(headers, dataLines);

  const openingBalance = adapter.getOpeningBalance
    ? adapter.getOpeningBalance(rows)
    : null;

  // Closing balance = balance recorded on the newest (last) row
  const closingBalance = rows.length > 0
    ? rows[rows.length - 1].balance
    : null;

  return {
    adapter,
    rows,
    openingBalance,
    closingBalance,
    oldestDate: rows[0]?.isoDate ?? '',
    newestDate: rows[rows.length - 1]?.isoDate ?? '',
    fileName,
  };
}


// ── Public: parse and merge multiple CSV files ────────────────────────────────
//
// adapterId is optional — if omitted, each file is auto-detected independently
// and must all resolve to the same adapter (or an error is thrown).
// If supplied, that adapter is used for all files.

export function processMultipleCsvFiles(
  csvFiles: Array<{ text: string; fileName: string }>,
  adapterId?: string
): MultiCsvResult {
  if (csvFiles.length === 0) {
    throw new Error('No CSV files provided.');
  }

  // ── Step 1: parse every file independently ───────────────────────────────
  const fileResults: CsvFileResult[] = csvFiles.map(({ text, fileName }) =>
    parseSingleCsvFile(text, fileName, adapterId)
  );

  // ── Step 2: enforce a single adapter across all files ────────────────────
  const adapterIds = [...new Set(fileResults.map(r => r.adapter.id))];
  if (adapterIds.length > 1) {
    throw new Error(
      `CSV files were matched to different adapters (${adapterIds.join(', ')}). ` +
      `Please supply files from the same bank, or pass an explicit adapterId.`
    );
  }
  const adapter = fileResults[0].adapter;

  // ── Step 3: sort files chronologically (oldest file first) ───────────────
  const sortedFiles = [...fileResults].sort((a, b) =>
    a.oldestDate.localeCompare(b.oldestDate)
  );


  // ── Step 4: merge rows, preserve verbatim order ──────────────────────────
  // Just concatenate all rows from all files, in chronological file order, preserving row order within each file.
  const allRows: ParsedRow[] = [];
  for (const file of sortedFiles) {
    for (const row of file.rows) {
      allRows.push(row);
    }
  }

  // ── Step 5: opening balance — from the chronologically first file ─────────
  const openingBalance = sortedFiles[0].openingBalance;

  const openingDate = adapter.getOpeningDate
    ? adapter.getOpeningDate(sortedFiles[0].rows)
    : (() => {
        const oldest = sortedFiles[0].oldestDate;
        if (!oldest) return '';
        const d = new Date(oldest);
        d.setDate(d.getDate() - 1);
        return d.toISOString().slice(0, 10);
      })();

  // ── Step 6: closing balance — from the chronologically last file ──────────
  const closingBalance = sortedFiles[sortedFiles.length - 1].closingBalance;

  // ── Step 7: detect balance gaps between adjacent files ───────────────────
  const gapAdjustments: GapAdjustment[] = [];

  for (let i = 0; i < sortedFiles.length - 1; i++) {
    const current = sortedFiles[i];
    const next    = sortedFiles[i + 1];

    if (current.closingBalance === null || next.openingBalance === null) continue;

    const diff = parseFloat(
      (next.openingBalance - current.closingBalance).toFixed(2)
    );

    if (Math.abs(diff) > 0.005) {
      gapAdjustments.push({
        date:   next.oldestDate,
        amount: Math.abs(diff),
        type:   diff > 0 ? 'in' : 'out',
        label:  `Balance adjustment between ${current.fileName} and ${next.fileName}`,
      });
    }
  }

  // ── Step 8: build per-file summaries ─────────────────────────────────────
  const csvSummaries = sortedFiles.map(f => ({
    fileName:       f.fileName,
    adapterName:    f.adapter.name,
    rowCount:       f.rows.length,
    oldestDate:     f.oldestDate,
    newestDate:     f.newestDate,
    openingBalance: f.openingBalance,
    closingBalance: f.closingBalance,
  }));

  return {
    adapter,
    allRows,
    openingBalance,
    openingDate,
    closingBalance,
    gapAdjustments,
    csvSummaries,
  };
}