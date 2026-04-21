// ── txNameCleaner.ts ───────────────────────────────────────────────────────
//
// Applies bank-specific name-cleaning rules to produce a "friendly" display
// name for a transaction without mutating the original stored name.
//
// Each bank leaves its own fingerprints in transaction descriptions:
//   BOI       — leading POS date stamps ("16APR"), trailing ref numbers
//   SEB       — trailing slash-date suffixes ("/25-12-29")
//   Revolut   — "Top-up by *****" obfuscation, transaction-type prefixes
//   Kandus    — trailing punctuation artefacts
//   Generic   — no bank-specific rules; still applies common normalization
//
// Usage:
//   import { cleanTxName } from '../utils/txNameCleaner'
//   const friendly = cleanTxName(tx.name, account?.bankId)

// ── Shared normalization applied to every bank ────────────────────────────────
function sharedNormalize(name: string): string {
  return name
    // Collapse multiple spaces / mixed whitespace
    .replace(/\s{2,}/g, ' ')
    // Strip leading/trailing whitespace
    .trim()
}

// ── Bank-specific rule sets ───────────────────────────────────────────────────

function cleanBoi(name: string): string {
  return sharedNormalize(
    name
      // POS/contactless prefix + embedded date stamp: "POS15APR ", "POSC15APR "
      .replace(/^POSC?\d{1,2}[A-Z]{3}\s+/i, '')
      // Leading day+month stamp without POS prefix: "16APR ", "03JAN ", "25DEC "
      .replace(/^\d{1,2}[A-Z]{3}\s+/i, '')
      // "365 Online XXXXXXXX" — numeric reference appended; strip it, keep the label
      .replace(/^(365\s+Online)\s+\d+\s*$/i, '$1')
      // "365 Online XXXXXXXX TEXT" — reference in the middle; strip just the number
      .replace(/^365\s+Online\s+\d+\s+/i, '365 Online ')
      // Trailing long numeric reference codes (6+ digits)
      .replace(/\s+\d{6,}$/, '')
      // Embedded asterisk-masked card numbers "**1234"
      .replace(/\*{2,}\d+/g, '')
  )
}

function cleanSeb(name: string): string {
  return sharedNormalize(
    name
      // Trailing slash + YY-MM-DD POS date: "/25-12-29" or " /25-12-29"
      .replace(/\s*\/\d{2}-\d{2}-\d{2}$/, '')
      // Trailing slash + YYYY-MM-DD (defensive, full year variant)
      .replace(/\s*\/\d{4}-\d{2}-\d{2}$/, '')
  )
}

function cleanKandusBankin(name: string): string {
  return sharedNormalize(
    name
      // Trailing slash + YY-MM-DD (same pattern seen in SEB-family Swedish banks)
      .replace(/\s*\/\d{2}-\d{2}-\d{2}$/, '')
      // Trailing punctuation dots
      .replace(/\.+$/, '')
  )
}

function cleanRevolut(name: string): string {
  return sharedNormalize(
    name
      // "Top-up by *6004" / "Top-up by ****" → "Top-up"
      // Handles any number of leading asterisks (Revolut uses single * + last 4 digits)
      .replace(/\s+by\s+\*+\S*/i, '')
      // "Transfer to NAME" / "Transfer from NAME" → "NAME"
      // Must come before the generic Transfer prefix strip below
      .replace(/^Transfer\s+(?:to|from)\s+/i, '')
      // Remaining bare transaction-type prefixes (exact word only — avoids partial hits
      // like "Exchanged" matching "Exchange")
      .replace(/^(Card Payment|Topup|Refund)\s*[:\-–]?\s*/i, '')
  )
}

function cleanGeneric(name: string): string {
  return sharedNormalize(name)
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns a cleaned, human-friendly version of a transaction name by applying
 * rules specific to the bank identified by `bankId`.
 *
 * The original name is never mutated.
 *
 * @param name   The raw transaction name as stored.
 * @param bankId The adapter id of the bank associated with the account
 *               (e.g. 'boi', 'revolut', 'seb', 'kandus-bankin', 'generic').
 *               Pass `null` or `undefined` to get only the shared normalization.
 */
export function cleanTxName(name: string, bankId: string | null | undefined): string {
  switch (bankId) {
    case 'boi':           return cleanBoi(name)
    case 'seb':           return cleanSeb(name)
    case 'kandus-bankin': return cleanKandusBankin(name)
    case 'revolut':       return cleanRevolut(name)
    case 'generic':       return cleanGeneric(name)
    default:              return sharedNormalize(name)
  }
}

/**
 * Returns `true` when the friendly name is meaningfully different from the
 * raw name (i.e. cleaning did something useful).
 */
export function hasFriendlyName(name: string, bankId: string | null | undefined): boolean {
  return cleanTxName(name, bankId) !== name.trim()
}

// ── Fuzzy merchant-name matching ──────────────────────────────────────────────

/**
 * Normalises a cleaned merchant name for fuzzy comparison:
 * lowercase, strip apostrophes/quotes, collapse whitespace.
 */
function _normForMatch(s: string): string {
  return s.toLowerCase().replace(/[''`]/g, '').replace(/\s+/g, ' ').trim()
}

function _diceSimilarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0
  const getBigrams = (s: string): Set<string> => {
    const set = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
    return set
  }
  const biA = getBigrams(a)
  const biB = getBigrams(b)
  let intersection = 0
  for (const bi of biA) if (biB.has(bi)) intersection++
  return (2 * intersection) / (biA.size + biB.size)
}

/**
 * Returns `true` if two *already-cleaned* merchant names refer to the same
 * merchant with high confidence. Uses three checks in order:
 *
 *  1. Exact match after normalisation (apostrophes stripped, lowercase).
 *  2. Prefix-word-boundary match: e.g. "mcdonalds" matches "mcdonalds 7"
 *     or "mcdonalds h" (the shorter name is a whole-word prefix of the longer).
 *     Requires the shorter string to be ≥ 4 characters to avoid false positives.
 *  3. Dice bigram similarity ≥ 0.75 as a catch-all for near-matches.
 */
export function txNamesMatch(cleanedA: string, cleanedB: string): boolean {
  const a = _normForMatch(cleanedA)
  const b = _normForMatch(cleanedB)
  if (a === b) return true
  // Whole-word prefix containment ("mcdonalds" ⊂ "mcdonalds 7")
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  if (shorter.length >= 4 && longer.startsWith(shorter + ' ')) return true
  // Bigram similarity for near-matches (spelling variants, extra punctuation, etc.)
  return _diceSimilarity(a, b) >= 0.75
}
