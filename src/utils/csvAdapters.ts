// ── SEB (Swedish bank) ───────────────────────────────────────────────
// Columns: Booking date, Value date, Voucher number, Text, Amount, Balance
// Only use Booking date, Text, Amount, Balance. Ignore Value date, Voucher number.
// Amount: negative = out, positive = in. Opening balance = last row's balance.

const sebAdapter: CsvAdapter = {
  id: 'seb',
  name: 'SEB (Sweden)',
  rowOrder: 'newest-first',
  detect(headers) {
    const hs = headers.map(h => h.toLowerCase().trim())
    let score = 0
    if (hs.includes('booking date')) score += 0.3
    if (hs.includes('text')) score += 0.2
    if (hs.includes('amount')) score += 0.2
    if (hs.includes('balance')) score += 0.2
    if (hs.includes('voucher number')) score += 0.1
    return score
  },
  parse(headers, lines) {
    // Flatten string[][] to string[]
    const flatLines: string[] = ([] as string[]).concat(...lines);
    const idx = (pat: RegExp) => headers.findIndex(h => pat.test(h.trim()));
    const dateCol    = idx(/^booking date$/i);
    const detailCol  = idx(/^text$/i);
    const amountCol  = idx(/^amount$/i);
    const balanceCol = idx(/^balance$/i);
    if (dateCol < 0 || detailCol < 0 || amountCol < 0) return [];

    const rows: ParsedRow[] = [];
    for (const line of flatLines) {
      const cols = parseCsvLine(line, ';');
      if (cols.length <= amountCol) continue;
      const isoDate = parseDate(cols[dateCol]?.trim() ?? '');
      if (!isoDate) continue;
      const details = cols[detailCol]?.trim() ?? '';
      if (!details) continue;
      const rawAmt = parseAmount(cols[amountCol] ?? '');
      if (isNaN(rawAmt) || rawAmt === 0) continue;
      const amount = Math.abs(rawAmt);
      const type: 'in' | 'out' = rawAmt > 0 ? 'in' : 'out';
      const balance = balanceCol >= 0 ? parseAmount(cols[balanceCol] ?? '') : NaN;
      rows.push({ isoDate, yearMonth: isoDate.slice(0, 7), details, amount, type, balance: isNaN(balance) ? null : balance });
    }
    return rows;
  },
}
// ── Shared types ─────────────────────────────────────────────────────

export type ParsedRow = {
  isoDate: string
  yearMonth: string
  details: string
  amount: number
  type: 'in' | 'out'
  balance: number | null
}

export interface CsvAdapter {
  readonly id: string
  /** Display name shown in the import dialog. */
  readonly name: string
  /**
   * Order in which the bank exports rows.
   * 'newest-first': most recent transaction is row 1 (BOI style).
   * 'oldest-first': oldest transaction is row 1 (Revolut style).
   */
  readonly rowOrder: 'newest-first' | 'oldest-first'
  /**
   * Returns a confidence score 0–1.
   * All registered adapters are scored; the highest wins.
   * Return 0 to never win (but still be a candidate as a last resort).
   */
  detect(headers: string[], rawLines: string[]): number
  /** Parse pre-split data lines (header row already excluded) into rows. */
  parse(headers: string[], dataLines: string[][]): ParsedRow[]
}

/** Result of parsing a single CSV file. */
export type CsvFileResult = {
  adapter: CsvAdapter
  rows: ParsedRow[]           // sorted oldest-first
  openingBalance: number | null   // balance BEFORE the oldest row in this file
  closingBalance: number | null   // balance AFTER the newest row in this file
  oldestDate: string
  newestDate: string
  fileName: string
}

/** A synthetic balance-adjustment entry to bridge a date gap between two CSVs. */
export type GapAdjustment = {
  date: string
  amount: number
  type: 'in' | 'out'
  label: string
}

/** Aggregated result of processing one or more CSV files together. */
export type MultiCsvResult = {
  adapter: CsvAdapter
  allRows: ParsedRow[]            // merged + deduplicated, sorted oldest-first
  openingBalance: number | null   // account-level balance before the oldest row
  openingDate: string             // date for the Opening Balance tx (day before oldest row)
  closingBalance: number | null   // balance after the newest row across all files
  gapAdjustments: GapAdjustment[] // balance bridges between non-adjacent CSV files
  csvSummaries: Array<{
    fileName: string
    rowCount: number
    oldestDate: string
    newestDate: string
    openingBalance: number | null
    closingBalance: number | null
  }>
}
// ── Shared utilities ─────────────────────────────────────────────────

function _dayBefore(iso: string): string {
  const d = new Date(iso)
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function _dayAfter(iso: string): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}


/** Parse a single CSV line respecting quoted fields and escaped double-quotes. */
export function parseCsvLine(line: string, delimiter: string = ','): string[] {
  const result: string[] = []
  let current = '', inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === delimiter && !inQuotes) {
      result.push(current); current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

function parseAmount(s: string): number {
  return parseFloat(s.replace(/,/g, '').trim())
}

/** DD/MM/YYYY → YYYY-MM-DD */
function parseDateDMY(s: string): string | null {
  const parts = s.trim().split('/')
  if (parts.length !== 3) return null
  const [dd, mm, yyyy] = parts
  if (!/^\d{4}$/.test(yyyy)) return null
  const iso = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null
}

/** YYYY-MM-DD or ISO timestamp → YYYY-MM-DD */
function parseDateISO(s: string): string | null {
  const m = s.trim().match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

/** MM/DD/YYYY (US format) → YYYY-MM-DD */
function parseDateMDY(s: string): string | null {
  const parts = s.trim().split('/')
  if (parts.length !== 3) return null
  const [mm, dd, yyyy] = parts
  if (!/^\d{4}$/.test(yyyy)) return null
  const iso = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null
}

function parseDate(s: string): string | null {
  return parseDateISO(s) ?? parseDateDMY(s) ?? parseDateMDY(s)
}

// ── Bank of Ireland ──────────────────────────────────────────────────
// BOI exports newest-first. On any given day, the row that HAS a balance
// value is listed first for that day — that balance is the END-OF-DAY
// balance after all transactions on that day. Rows without a balance on
// the same day are earlier in time (the balance cell is blank).
// Column headers: Date, Details, Debit, Credit, Balance

const boiAdapter: CsvAdapter = {
  id: 'boi',
  name: 'Bank of Ireland',
  rowOrder: 'newest-first',
  detect(headers) {
    const hs = headers.map(h => h.toLowerCase().trim())
    let score = 0
    if (hs.includes('date'))                                     score += 0.25
    if (hs.includes('details') || hs.includes('description'))   score += 0.25
    if (hs.includes('debit'))                                    score += 0.25
    if (hs.includes('credit'))                                   score += 0.25
    return score
  },
  parse(headers, lines) {
    const idx = (pat: RegExp) => headers.findIndex(h => pat.test(h.trim()))
    const dateCol    = Math.max(idx(/^date$/i),                      0)
    const detailCol  = Math.max(idx(/^details$|^description$/i),     1)
    const debitCol   = Math.max(idx(/^debit$/i),                     2)
    const creditCol  = Math.max(idx(/^credit$/i),                    3)
    const balanceCol = Math.max(idx(/^balance$/i),                   4)

    const rows: ParsedRow[] = []
    for (const cols of lines) {
      if (cols.length < 4) continue
      const isoDate = parseDateDMY(cols[dateCol]?.trim() ?? '')
      if (!isoDate) continue
      const details = cols[detailCol]?.trim()
      if (!details) continue
      const credit  = parseAmount(cols[creditCol]  ?? '')
      const debit   = parseAmount(cols[debitCol]   ?? '')
      const balance = parseAmount(cols[balanceCol] ?? '')
      let amount: number, type: 'in' | 'out'
      if (!isNaN(credit) && credit > 0)    { amount = credit; type = 'in'  }
      else if (!isNaN(debit) && debit > 0) { amount = debit;  type = 'out' }
      else continue
      rows.push({ isoDate, yearMonth: isoDate.slice(0, 7), details, amount, type, balance: isNaN(balance) ? null : balance })
    }
    return rows
  },
}

// ── Revolut ──────────────────────────────────────────────────────────
// Export format: Type, Product, Started Date, Completed Date, Description,
//                Amount, Fee, Currency, State, Balance

const revolutAdapter: CsvAdapter = {
  id: 'revolut',
  name: 'Revolut',
  rowOrder: 'oldest-first',
  detect(headers) {
    const hs = headers.map(h => h.toLowerCase().trim())
    let score = 0
    if (hs.some(h => h === 'completed date' || h === 'started date')) score += 0.4
    if (hs.includes('amount'))   score += 0.2
    if (hs.includes('currency')) score += 0.2
    if (hs.includes('state'))    score += 0.2
    return score
  },
  parse(headers, lines) {
    const idx = (pat: RegExp) => headers.findIndex(h => pat.test(h.trim()))
    const dateCol    = (() => { const c = idx(/^completed date$/i); return c >= 0 ? c : idx(/^started date$/i) })()
    const detailCol  = idx(/^description$/i)
    const amountCol  = idx(/^amount$/i)
    const balanceCol = idx(/^balance$/i)
    if (dateCol < 0 || amountCol < 0) return []

    const rows: ParsedRow[] = []
    for (const cols of lines) {
      if (cols.length <= amountCol) continue
      const isoDate = parseDate(cols[dateCol]?.trim() ?? '')
      if (!isoDate) continue
      const details = detailCol >= 0 ? (cols[detailCol]?.trim() ?? '') : ''
      if (!details) continue
      const rawAmt = parseAmount(cols[amountCol] ?? '')
      if (isNaN(rawAmt) || rawAmt === 0) continue
      const amount = Math.abs(rawAmt)
      const type: 'in' | 'out' = rawAmt > 0 ? 'in' : 'out'
      const balance = balanceCol >= 0 ? parseAmount(cols[balanceCol] ?? '') : NaN
      rows.push({ isoDate, yearMonth: isoDate.slice(0, 7), details, amount, type, balance: isNaN(balance) ? null : balance })
    }
    return rows
  },
}

// ── Generic fallback ─────────────────────────────────────────────────
// Best-effort heuristic for unrecognised CSVs.
// Handles: signed single-amount column, or separate debit/credit columns.
// Handles: ISO dates, DD/MM/YYYY, MM/DD/YYYY.

const genericAdapter: CsvAdapter = {
  id: 'generic',
  name: 'Generic CSV',
  rowOrder: 'oldest-first',
  detect() { return 0.1 },
  parse(headers, lines) {
    const h  = headers.map(s => s.toLowerCase().trim())
    const fi = (pat: RegExp) => h.findIndex(s => pat.test(s))

    const dateCol    = fi(/date|time/)
    const detailCol  = fi(/desc|narrat|detail|memo|reference|ref|payee|beneficiar/)
    const amountCol  = fi(/^amount$/)
    const debitCol   = fi(/debit|withdrawal|dr\.?$/)
    const creditCol  = fi(/credit|deposit|cr\.?$/)
    const balanceCol = fi(/balance/)

    if (dateCol < 0) return []
    if (amountCol < 0 && (debitCol < 0 || creditCol < 0)) return []

    const rows: ParsedRow[] = []
    for (const cols of lines) {
      const isoDate = parseDate(cols[dateCol]?.trim() ?? '')
      if (!isoDate) continue
      const details  = detailCol >= 0 ? (cols[detailCol]?.trim() ?? '') : ''
      const balance  = balanceCol >= 0 ? parseAmount(cols[balanceCol] ?? '') : NaN

      let amount: number, type: 'in' | 'out'
      if (amountCol >= 0) {
        const raw = parseAmount(cols[amountCol] ?? '')
        if (isNaN(raw) || raw === 0) continue
        amount = Math.abs(raw)
        type   = raw > 0 ? 'in' : 'out'
      } else {
        const credit = parseAmount(cols[creditCol] ?? '')
        const debit  = parseAmount(cols[debitCol]  ?? '')
        if (!isNaN(credit) && credit > 0)    { amount = credit; type = 'in'  }
        else if (!isNaN(debit) && debit > 0) { amount = debit;  type = 'out' }
        else continue
      }

      rows.push({ isoDate, yearMonth: isoDate.slice(0, 7), details, amount, type, balance: isNaN(balance) ? null : balance })
    }
    return rows
  },
}

// ── Registry ─────────────────────────────────────────────────────────

/**
 * All supported adapters, in priority order.
 * Add new bank adapters here — no other file needs to change.
 */
export const CSV_ADAPTERS: readonly CsvAdapter[] = [
  boiAdapter,
  revolutAdapter,
  sebAdapter,
  // Add more adapters here, e.g. aibAdapter, permanentTsbAdapter, …
  genericAdapter, // Must remain last — lowest-confidence fallback
]

export function detectAdapter(headers: string[], rawLines: string[]): CsvAdapter {
  let best      = genericAdapter
  let bestScore = -1
  for (const adapter of CSV_ADAPTERS) {
    const score = adapter.detect(headers, rawLines)
    if (score > bestScore) { bestScore = score; best = adapter }
  }
  return best
}

// ── Balance calculation ───────────────────────────────────────────────

/**
 * Back-calculate the account balance BEFORE the very first (oldest) transaction.
 *
 * BOI-specific rule (newest-first):
 *   The balance value on a row is the END-OF-DAY balance for that entire date group.
 *   Only ONE row per date group carries the balance (the most-recent transaction of
 *   the day, which appears first in file order). All other rows on that date have no
 *   balance value.
 *
 * Algorithm for newest-first (BOI):
 *   1. Find the LAST row in file order that has a balance — this is the oldest anchored
 *      end-of-day balance.
 *   2. Starting from that end-of-day balance, reverse ALL rows on that same date
 *      (including the anchor row). This gives the balance at the START of that day.
 *   3. Then reverse all rows on dates older than the anchor's date.
 *   This yields the balance immediately before the very oldest transaction in the file.
 *
 * For oldest-first (Revolut):
 *   The first row with a balance is the anchor; its balance is after that row only.
 *   Reverse the anchor row and any rows before it.
 */
function calcOpeningBalance(rows: ParsedRow[], rowOrder: 'newest-first' | 'oldest-first'): number | null {
  if (rowOrder === 'newest-first') {
    // Find the LAST row in file order that has a balance (= oldest anchored end-of-day balance).
    let anchorIdx = -1
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].balance !== null) { anchorIdx = i; break }
    }
    if (anchorIdx === -1) return null

    const anchorDate = rows[anchorIdx].isoDate
    let balance      = rows[anchorIdx].balance!

    // Reverse ALL rows on the anchor's date (the balance is end-of-day for the whole group).
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].isoDate === anchorDate) {
        balance += rows[i].type === 'out' ? rows[i].amount : -rows[i].amount
      }
    }

    // Reverse each row that is strictly older than the anchor date (higher index = older in newest-first).
    for (let i = anchorIdx + 1; i < rows.length; i++) {
      if (rows[i].isoDate !== anchorDate) {
        balance += rows[i].type === 'out' ? rows[i].amount : -rows[i].amount
      }
    }

    return Math.round(balance * 100) / 100
  } else {
    // oldest-first: first row with balance is anchor; its balance is after THAT row only.
    const anchorIdx = rows.findIndex(r => r.balance !== null)
    if (anchorIdx === -1) return null
    const anchor = rows[anchorIdx]
    let balance = anchor.balance!
    // Reverse the anchor row itself.
    balance += anchor.type === 'out' ? anchor.amount : -anchor.amount
    // Reverse each row older than the anchor (lower index = older in oldest-first).
    for (let i = anchorIdx - 1; i >= 0; i--) {
      const r = rows[i]
      balance += r.type === 'out' ? r.amount : -r.amount
    }
    return Math.round(balance * 100) / 100
  }
}

/**
 * Return the running balance after the newest transaction in the file.
 *   - newest-first: first row in file order with a balance (it IS the newest date's balance)
 *   - oldest-first: last row in file order with a balance
 */
function calcClosingBalance(rows: ParsedRow[], rowOrder: 'newest-first' | 'oldest-first'): number | null {
  if (rowOrder === 'newest-first') {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].balance !== null) return rows[i].balance
    }
    return null
  } else {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].balance !== null) return rows[i].balance
    }
    return null
  }
}

// ── Single-file parse ─────────────────────────────────────────────────

function parseSingleCsvFile(text: string, fileName: string, forcedAdapterId?: string): CsvFileResult {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) {
    return { adapter: genericAdapter, rows: [], openingBalance: null, closingBalance: null, oldestDate: '', newestDate: '', fileName }
  }

  // Detect if header is semicolon-delimited (SEB)
  const isLikelySEB = /booking date/i.test(lines[0]) && lines[0].includes(';');
  const firstCols = isLikelySEB ? parseCsvLine(lines[0], ';') : parseCsvLine(lines[0]);
  const isHeader  = isNaN(Date.parse(firstCols[0])) || /date|time/i.test(firstCols[0]);
  const headers   = isHeader ? firstCols.map(h => h.trim()) : [];
  const dataRawLines = isHeader ? lines.slice(1) : lines;

  // Detect adapter before splitting data lines
  const adapter = forcedAdapterId
    ? (CSV_ADAPTERS.find(a => a.id === forcedAdapterId) ?? detectAdapter(headers, lines))
    : detectAdapter(headers, lines)

  // For SEB, pass raw lines; for others, split with parseCsvLine (comma)
  const dataLines = adapter.id === 'seb'
    ? dataRawLines.map(line => [line])
    : dataRawLines.map(line => parseCsvLine(line));

  // Parse in the adapter's native file order (needed for balance calculations).
  const rawRows = adapter.parse(headers, dataLines)
  if (rawRows.length === 0) {
    return { adapter, rows: [], openingBalance: null, closingBalance: null, oldestDate: '', newestDate: '', fileName }
  }

  // Calculate balances BEFORE sorting (requires original file order).
  const openingBalance = calcOpeningBalance(rawRows, adapter.rowOrder)
  const closingBalance = calcClosingBalance(rawRows, adapter.rowOrder)

  const oldestDate = rawRows.reduce((min, r) => r.isoDate < min ? r.isoDate : min, rawRows[0].isoDate)
  const newestDate = rawRows.reduce((max, r) => r.isoDate > max ? r.isoDate : max, rawRows[0].isoDate)

  rawRows.sort((a, b) => a.isoDate.localeCompare(b.isoDate)) // oldest-first for import

  return { adapter, rows: rawRows, openingBalance, closingBalance, oldestDate, newestDate, fileName }
}

// ── Multi-file entry point ────────────────────────────────────────────

/**
 * Parse and merge one or more CSV files into a single importable result.
 *
 * Rules:
 *  - All files are parsed with the same adapter (bank format).
 *  - Rows are deduplicated by (date | details | amount | type).
 *  - Files are sorted oldest-first so the account opening balance comes
 *    from the file with the earliest date range.
 *  - If a DATE GAP exists between two adjacent files (their date ranges do
 *    not touch), and the closing balance of the earlier file differs from
 *    the opening balance of the later file, a GapAdjustment is emitted so
 *    the caller can insert a synthetic "Balance Adjustment" transaction.
 */
export function processMultipleCsvFiles(
  files: Array<{ text: string; fileName: string }>,
  forcedAdapterId?: string,
): MultiCsvResult {
  const fileResults = files.map(f => parseSingleCsvFile(f.text, f.fileName, forcedAdapterId))
  const valid = fileResults.filter(r => r.rows.length > 0)

  const fallbackAdapter = valid[0]?.adapter ?? genericAdapter

  if (valid.length === 0) {
    return {
      adapter: fallbackAdapter,
      allRows: [],
      openingBalance: null,
      openingDate: '',
      closingBalance: null,
      gapAdjustments: [],
      csvSummaries: [],
    }
  }

  // Sort files by their oldest date so we process them chronologically.
  valid.sort((a, b) => a.oldestDate.localeCompare(b.oldestDate))

  // Detect date gaps between adjacent files and compute balance bridges.
  const gapAdjustments: GapAdjustment[] = []
  for (let i = 0; i < valid.length - 1; i++) {
    const a = valid[i]
    const b = valid[i + 1]
    // A gap exists when the start of B is more than one day after the end of A.
    if (b.oldestDate > _dayAfter(a.newestDate)) {
      if (a.closingBalance !== null && b.openingBalance !== null) {
        const diff = Math.round((b.openingBalance - a.closingBalance) * 100) / 100
        if (Math.abs(diff) > 0.005) {
          gapAdjustments.push({
            date:   _dayBefore(b.oldestDate),
            amount: Math.abs(diff),
            type:   diff > 0 ? 'in' : 'out',
            label:  `${a.newestDate} → ${b.oldestDate}`,
          })
        }
      }
    }
  }

  // Merge rows, deduplicating by (date | details | amount | type).
  // Uses count-based dedup so legitimately repeated transactions (e.g., two ATM
  // withdrawals of the same amount on the same day) are preserved.
  // For multi-file imports with overlapping date ranges, a key appearing N times
  // in one file and M times in another is kept max(N, M) times.
  const keyMaxCount = new Map<string, number>()
  for (const result of valid) {
    const fileCount = new Map<string, number>()
    for (const row of result.rows) {
      const key = `${row.isoDate}|${row.details}|${row.amount}|${row.type}`
      fileCount.set(key, (fileCount.get(key) ?? 0) + 1)
    }
    for (const [key, cnt] of fileCount) {
      keyMaxCount.set(key, Math.max(keyMaxCount.get(key) ?? 0, cnt))
    }
  }
  const keyCurrent = new Map<string, number>()
  const allRows: ParsedRow[] = []
  for (const result of valid) {
    for (const row of result.rows) {
      const key = `${row.isoDate}|${row.details}|${row.amount}|${row.type}`
      const current = keyCurrent.get(key) ?? 0
      if (current < (keyMaxCount.get(key) ?? 0)) {
        keyCurrent.set(key, current + 1)
        allRows.push(row)
      }
    }
  }
  // Sort by date oldest-first. Within the same date, for newest-first adapters (BOI),
  // the rows are currently in CSV file order (most-recent tx first within the day).
  // We want them imported in reverse so the CSV-first row gets the latest createdAt
  // and therefore appears first in the default descending-createdAt display order.
  const adapterRowOrder = valid[0]?.adapter.rowOrder ?? 'oldest-first'
  allRows.sort((a, b) => {
    const dc = a.isoDate.localeCompare(b.isoDate)
    if (dc !== 0) return dc
    // Within same date: newest-first adapters → reverse file order (oldest-within-day first)
    // so the CSV-first row gets imported last and shows first in the display.
    // The rows are currently in file order as parsed; no extra index info available,
    // so we rely on stable sort preserving relative order and simply reverse within-date
    // for newest-first adapters below via a post-sort group reversal.
    return 0
  })
  if (adapterRowOrder === 'newest-first') {
    // Reverse within each same-date group so CSV-first row ends up imported last.
    let i = 0
    while (i < allRows.length) {
      const date = allRows[i].isoDate
      let j = i
      while (j < allRows.length && allRows[j].isoDate === date) j++
      // reverse allRows[i..j-1] in place
      for (let lo = i, hi = j - 1; lo < hi; lo++, hi--) {
        const tmp = allRows[lo]; allRows[lo] = allRows[hi]; allRows[hi] = tmp
      }
      i = j
    }
  }

  const oldestCsv = valid[0]
  const newestCsv = valid[valid.length - 1]

  return {
    adapter:        oldestCsv.adapter,
    allRows,
    openingBalance: oldestCsv.openingBalance,
    openingDate:    oldestCsv.oldestDate ? _dayBefore(oldestCsv.oldestDate) : '',
    closingBalance: newestCsv.closingBalance,
    gapAdjustments,
    csvSummaries: valid.map(r => ({
      fileName:       r.fileName,
      rowCount:       r.rows.length,
      oldestDate:     r.oldestDate,
      newestDate:     r.newestDate,
      openingBalance: r.openingBalance,
      closingBalance: r.closingBalance,
    })),
  }
}
