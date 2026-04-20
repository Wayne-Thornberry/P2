// ── csvUtils.ts ───────────────────────────────────────────────────────────────
// Shared parsing primitives used by all adapters.

/**
 * Detect the delimiter used in a CSV by sampling the raw header line.
 * Checks comma, semicolon, tab, pipe — whichever produces the most splits wins.
 */
export function detectDelimiter(headerLine: string): string {
  const candidates = [',', ';', '\t', '|'] as const;
  let best: string = ',';
  let bestCount = 0;
  for (const c of candidates) {
    const count = headerLine.split(c).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best;
}

/**
 * Split one CSV line into fields, respecting double-quoted fields.
 * Handles:
 *   "field with, comma"   → preserved as single field
 *   "escaped ""quotes"""  → inner "" decoded to "
 */
export function splitCsvLine(line: string, delimiter = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {   // escaped quote
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Parse a full CSV text into a header array and a 2-D array of data cells.
 * Auto-detects delimiter from the first non-empty line.
 * Skips completely empty lines.
 */
export function parseCsvText(
  text: string
): { headers: string[]; delimiter: string; dataLines: string[][] } {
  const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (rawLines.length === 0) return { headers: [], delimiter: ',', dataLines: [] };

  const delimiter = detectDelimiter(rawLines[0]);
  const headers = splitCsvLine(rawLines[0], delimiter).map(h => h.toLowerCase().trim());
  const dataLines = rawLines.slice(1).map(l => splitCsvLine(l, delimiter));

  return { headers, delimiter, dataLines };
}

// ── Date parsing ─────────────────────────────────────────────────────────────

const DATE_FORMATS: Array<(s: string) => string | null> = [
  // ISO: 2025-12-30
  s => /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null,
  // DD/MM/YYYY
  s => {
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  },
  // MM/DD/YYYY
  s => {
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
  },
  // DD-MM-YYYY
  s => {
    const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  },
  // DD.MM.YYYY
  s => {
    const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  },
];

/**
 * Attempt to parse a date string into ISO YYYY-MM-DD format.
 * Returns null if no known format matches.
 */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  for (const fn of DATE_FORMATS) {
    const result = fn(s);
    if (result) {
      // Validate the resulting date is real
      const d = new Date(result);
      if (!isNaN(d.getTime())) return result;
    }
  }
  return null;
}

// ── Amount parsing ────────────────────────────────────────────────────────────

/**
 * Parse a numeric amount string into a float.
 * Handles:
 *   European format  1.234,56  → 1234.56
 *   Standard format  1,234.56  → 1234.56
 *   Plain            -206.71   → -206.71
 *   Trailing minus   206.71-   → -206.71  (some EU banks)
 * Returns NaN if unparseable.
 */
export function parseAmount(raw: string): number {
  let s = raw.trim().replace(/\s/g, '');
  if (!s) return NaN;

  // Trailing minus (e.g. "206.71-")
  const trailingMinus = s.endsWith('-');
  if (trailingMinus) s = '-' + s.slice(0, -1);

  // Remove currency symbols
  s = s.replace(/[€$£]/g, '');

  // Detect European format: last separator is a comma
if (/^\-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) && s.includes(',')) {
  // e.g. 1.234,56 (must have a comma decimal)
  s = s.replace(/\./g, '').replace(',', '.');
} else if (/^\-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    // e.g. 1,234.56 or 1,234
    s = s.replace(/,/g, '');
  } else {
    // Plain number — comma might be decimal separator (e.g. "-206,71")
    const commaDecimal = /^\-?\d+,\d{1,2}$/.test(s);
    if (commaDecimal) s = s.replace(',', '.');
    else s = s.replace(/,/g, ''); // strip any remaining commas
  }

  return parseFloat(s);
}

/**
 * Subtract one day from an ISO date string. Returns ISO string.
 */
export function dayBefore(isoDate: string): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}