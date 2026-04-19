import type { BudgetItem } from '../types/budget'

// ── Normalisation ──────────────────────────────────────────────
// Strip banking-specific prefixes and embedded date stamps so the
// meaningful merchant name is what actually gets scored.
function normalize(raw: string): string {
  return raw
    // Remove common transaction-type prefixes (POS, DDR, CHQ, BACS…)
    .replace(/^(POSCD?C?|POSC|POS|DDR?|CHQ|STO|BACS|FPS|TFR|ATM|CDT|DBT)\s*/i, '')
    // Remove leading date stamps: "16APR", "APR16", "04/16", "16/04"
    .replace(/^\d{1,2}[A-Z]{3}\s*/i, '')
    .replace(/^[A-Z]{3}\d{1,2}\s*/i, '')
    .replace(/^\d{1,2}\/\d{2}\s*/i, '')
    // Remove trailing card / reference numbers
    .replace(/\*{2,}\d+/g, '')
    .replace(/\b\d{6,}\b/g, '')
    // Replace punctuation with spaces
    .replace(/[._\-/\\]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// ── Keyword → semantic hints dictionary ───────────────────────
// Each entry maps a regex pattern (matched against the normalised
// transaction name) to an array of hint words.  These hints are then
// compared against the tokenised item name + category to produce a
// score. Adding more entries here extends coverage without touching
// any other part of the codebase.
const MERCHANT_HINTS: Array<{ pattern: RegExp; hints: string[] }> = [
  // ── Groceries / Supermarket ─────────────────────────────────
  {
    pattern: /woolworths|coles|\baldi\b|\biga\b|lidl|tesco|sainsbury|waitrose|\basda\b|morrisons|supervalu|\bspar\b|\bcentra\b|dunnes|marks.{0,4}spencer|costco|harris farm|grocery|supermarket|fresh market|food store|wholefoods|whole foods/i,
    hints: ['groceries', 'food', 'supermarket'],
  },
  // ── Dining out / Restaurants ────────────────────────────────
  {
    pattern: /mcdonald|mcdonalds|\bkfc\b|burger king|subway|\bpizza\b|dominos|domino|noodle|thai|sushi|chinese|indian|italian|kebab|takeaway|takeout|restaurant|dining|bistro|\bgrill\b|diner|eatery|nandos|five guys|burger|chicken shop|chipotle|taco|burrito|currys?|brasserie|steakhouse|steaks|grill house|certa|tower grill|mckeown|mckeon|love food|chipper|fish.?chips/i,
    hints: ['dining', 'out', 'food', 'restaurant'],
  },
  // ── Coffee & Snacks ─────────────────────────────────────────
  {
    pattern: /starbucks|coffee|\bgloria jean|coffee club|costa coffee|bakery|\bsnack\b|vending|cafe|caffe|espresso|croissant|pastry|barista|bean/i,
    hints: ['coffee', 'snacks', 'cafe'],
  },
  // ── Fuel / Petrol Stations ──────────────────────────────────
  {
    pattern: /\bbp\b|\bshell\b|caltex|7.?eleven|ampol|\besso\b|texaco|chevron|exxon|\bpetrol\b|\bfuel\b|diesel|service station|gas station|forecourt|\bcircle.?k\b|applegreen|maxol|topaz|\bjet\b petrol/i,
    hints: ['fuel', 'petrol', 'transport', 'car'],
  },
  // ── Toll Roads ──────────────────────────────────────────────
  {
    pattern: /\beflow\b|toll|e-flow|e\.flow|motorway toll|via ?\w+ toll/i,
    hints: ['fuel', 'transport', 'car', 'travel'],
  },
  // ── Public Transit ──────────────────────────────────────────
  {
    pattern: /bus pass|train ticket|transit pass|\bopal\b|\bmyki\b|\btram\b|\bmetro\b|\bferry\b|commute|public transport|monthly pass|leap card|rail ticket|dart ticket|luas/i,
    hints: ['public', 'transit', 'bus', 'train', 'transport'],
  },
  // ── Car / Auto Loan ─────────────────────────────────────────
  {
    pattern: /car loan|auto loan|vehicle finance|car payment|hire purchase|car repay|motor finance|vehicle repayment/i,
    hints: ['car', 'payment', 'vehicle', 'transport', 'auto'],
  },
  // ── Rent / Mortgage ─────────────────────────────────────────
  {
    pattern: /\brent\b|mortgage|property management|landlord|rental payment|letting agent/i,
    hints: ['rent', 'mortgage', 'housing'],
  },
  // ── Utilities: Electricity / Gas / Water ────────────────────
  {
    pattern: /electric(ity)?|power bill|\bgas bill\b|water bill|council rates|energy bill|utilities|utility|airtricity|bord.?gais|eir(com)?|irish water|uisce/i,
    hints: ['utilities', 'electricity', 'bills', 'housing'],
  },
  // ── Internet & Phone ────────────────────────────────────────
  {
    pattern: /internet|broadband|wifi|mobile plan|phone plan|vodafone|telstra|optus|\beir\b|\bthree\b|\bo2\b|bt broadband|virginmedia|sky broadband|comcast|telecom|meteor|talkto|eircom|chorus/i,
    hints: ['internet', 'phone', 'broadband', 'mobile', 'housing'],
  },
  // ── Insurance ───────────────────────────────────────────────
  {
    pattern: /insurance|medibank|bupa|allianz|\baxa\b|aami|nrma|aviva|\baig\b|zurich|fbd insurance|liberty insurance|health insur|car insur|home insur|premium.*insur|insur.*premium/i,
    hints: ['insurance', 'premium', 'home'],
  },
  // ── Streaming Services ──────────────────────────────────────
  {
    pattern: /netflix|spotify|disney\+?|apple.?tv|youtube premium|binge|stan|paramount\+?|hbo|hulu|prime video|amazon prime|streaming|deezer|tidal|apple music|apple one|google one/i,
    hints: ['streaming', 'services', 'subscription', 'entertainment'],
  },
  // ── Gaming ──────────────────────────────────────────────────
  {
    pattern: /\bsteam\b|playstation|xbox|nintendo|epic games|app store|google play|gaming|game pass|ps store|ea play|ubisoft|activision/i,
    hints: ['gaming', 'entertainment'],
  },
  // ── Healthcare / Medical ─────────────────────────────────────
  {
    pattern: /pharmacy|chemist|chemist warehouse|doctor|\bgp\b|medical|prescription|hospital|dentist|optometrist|physio(therapy)?|specialist|wellness|clinic|health centre|laya|vhi/i,
    hints: ['pharmacy', 'medical', 'health', 'healthcare'],
  },
  // ── Savings / Investment ────────────────────────────────────
  {
    pattern: /savings.?transfer|transfer.?savings|emergency fund|investment transfer|brokerage deposit|\betf\b|shares invest|\bsuper\b(annuation)?|retirement fund|401k|pension fund/i,
    hints: ['savings', 'investment', 'fund', 'emergency', 'retirement'],
  },
  // ── Entertainment / Events ──────────────────────────────────
  {
    pattern: /cinema|movie theatre|\bconcert\b|tickets?\b|festival|theatre|theater|museum|sport.*event|bowling|comedy club|live music|bar tab|night out|amusement|theme park/i,
    hints: ['entertainment', 'events', 'outings'],
  },
  // ── Salary / Income ─────────────────────────────────────────
  {
    pattern: /payroll|salary|wage|direct deposit|payslip|pay credit|income credit/i,
    hints: ['salary', 'income', 'primary'],
  },
  // ── Freelance / Contract Income ─────────────────────────────
  {
    pattern: /freelance|contract payment|client invoice|upwork|fiverr|stripe transfer/i,
    hints: ['freelance', 'work', 'income'],
  },
  // ── Dividends ───────────────────────────────────────────────
  {
    pattern: /dividend|share dividend|stock dividend|quarterly dividend/i,
    hints: ['dividends', 'income', 'investment'],
  },
  // ── An Post / Postal services ───────────────────────────────
  {
    pattern: /an post|post.?office|royal mail|postal|postmaster/i,
    hints: ['bills', 'utilities', 'housing'],
  },
  // ── Amazon / Online shopping ────────────────────────────────
  {
    pattern: /\bamzn\b|amazon|amazon mktp|ebay|online shop|aliexpress/i,
    hints: ['entertainment', 'shopping', 'online'],
  },
  // ── Hotel / Accommodation ───────────────────────────────────
  {
    pattern: /hotel|motel|airbnb|hostel|accommodation|lodging|inn\b|resort|b&b|bed.?and.?breakfast/i,
    hints: ['events', 'outings', 'entertainment', 'travel'],
  },
  // ── Financial transfers ──────────────────────────────────────
  {
    pattern: /revolut|monzo|n26|wise\.com|transferwise|bank transfer|interbank/i,
    hints: ['savings', 'transfer', 'investment'],
  },
]

// ── Tokeniser ─────────────────────────────────────────────────
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t))
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'ltd', 'inc',
  'pty', 'plc', 'co', 'ie', 'uk', 'au', 'us', 'com', 'net', 'org',
  'online', 'ireland', 'limited', 'via', 'ref', 'tap', 'card',
])

// ── Item scoring ───────────────────────────────────────────────
// name token hit → 3 pts, category token hit → 1 pt
// This makes a merchant matching a specific item name outrank a
// vaguer category match.
function scoreItem(item: BudgetItem, txHints: Set<string>): number {
  let score = 0
  for (const token of tokenize(item.name)) {
    if (txHints.has(token)) score += 3
  }
  for (const token of tokenize(item.category)) {
    if (txHints.has(token)) score += 1
  }
  return score
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Given a raw transaction description and a list of budget items,
 * return the ID of the best-matching item, or null if nothing
 * scores above zero.
 */
export function suggestItem(txName: string, items: BudgetItem[]): number | null {
  if (!txName.trim() || !items.length) return null

  const clean = normalize(txName)

  // Collect all semantic hint tokens
  const txHints = new Set<string>()
  for (const token of tokenize(clean)) txHints.add(token)

  for (const { pattern, hints } of MERCHANT_HINTS) {
    if (pattern.test(clean) || pattern.test(txName)) {
      for (const hint of hints) {
        for (const token of tokenize(hint)) txHints.add(token)
      }
    }
  }

  let bestId: number | null = null
  let bestScore = 0

  for (const item of items) {
    const s = scoreItem(item, txHints)
    if (s > bestScore) {
      bestScore = s
      bestId = item.id
    }
  }

  return bestId
}

/**
 * Batch-suggest items for a set of transactions.
 * Returns a Map of transactionId → suggestedItemId.
 * Only processes transactions where itemId is null (or all if onlyUnassigned=false).
 */
export function suggestItems(
  transactions: { id: number; name: string; itemId: number | null }[],
  items: BudgetItem[],
  onlyUnassigned = true,
): Map<number, number> {
  const result = new Map<number, number>()
  const targets = onlyUnassigned ? transactions.filter(t => t.itemId === null) : transactions
  for (const tx of targets) {
    const itemId = suggestItem(tx.name, items)
    if (itemId !== null) result.set(tx.id, itemId)
  }
  return result
}

/**
 * Return the top N scored items for a transaction name, in descending score order.
 * Items with score > 0 come first (ranked), followed by all others alphabetically.
 */
export function suggestTopItems(txName: string, items: BudgetItem[], topN = 5): BudgetItem[] {
  if (!items.length) return []

  const clean = normalize(txName)
  const txHints = new Set<string>()
  for (const token of tokenize(clean)) txHints.add(token)
  for (const { pattern, hints } of MERCHANT_HINTS) {
    if (pattern.test(clean) || pattern.test(txName)) {
      for (const hint of hints) {
        for (const token of tokenize(hint)) txHints.add(token)
      }
    }
  }

  const scored = items.map(item => ({ item, score: scoreItem(item, txHints) }))
  const withScore    = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score)
  const withoutScore = scored.filter(s => s.score === 0).sort((a, b) => a.item.name.localeCompare(b.item.name))

  return [...withScore, ...withoutScore].slice(0, topN).map(s => s.item)
}
