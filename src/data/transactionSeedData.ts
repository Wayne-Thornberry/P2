import type { Transaction } from '../types/transaction'

// Must match the IDs seeded by accountStore.loadSeedData()
const ACC_CHECKING   = 'acc-s1'
const ACC_SAVINGS    = 'acc-s2'
const ACC_CREDIT     = 'acc-s3'
const ACC_CASH       = 'acc-s4'
const ACC_INVESTMENT = 'acc-s5'

interface TxTemplate {
  itemId: number | null
  type: 'in' | 'out'
  names: string[]
  baseAmount: number
  variance: number       // fraction of baseAmount applied as ±random delta
  countMin: number
  countMax: number
  accounts: string[]
}

const TEMPLATES: TxTemplate[] = [
  // ── Income — linked to accounts only, not budget items ─────────────────
  // Income flows into accounts; budget items track planned spending, not income receipt.
  { itemId: null, type: 'in',  names: ['Direct Deposit — Payroll', 'Payroll Deposit', 'Salary Credit'],
    baseAmount: 5500, variance: 0,    countMin: 1, countMax: 1, accounts: [ACC_CHECKING] },
  { itemId: null, type: 'in',  names: ['Freelance Payment', 'Client Invoice Paid', 'Contract Payment', 'Upwork Transfer'],
    baseAmount: 600,  variance: 0.55, countMin: 0, countMax: 2, accounts: [ACC_CHECKING] },
  { itemId: null, type: 'in',  names: ['Dividend Payment', 'Quarterly Dividend', 'Share Dividend'],
    baseAmount: 250,  variance: 0.2,  countMin: 0, countMax: 1, accounts: [ACC_INVESTMENT] },
  { itemId: null, type: 'in',  names: ['Interest Credit', 'Savings Interest', 'Account Interest'],
    baseAmount: 45,   variance: 0.15, countMin: 1, countMax: 1, accounts: [ACC_SAVINGS] },

  // ── Housing ─────────────────────────────────────────────────────────
  { itemId: 101, type: 'out', names: ['Rent Payment', 'Mortgage Payment', 'Property Management — Rent'],
    baseAmount: 1800, variance: 0,    countMin: 1, countMax: 1, accounts: [ACC_CHECKING] },
  { itemId: 102, type: 'out', names: ['Electric Bill', 'Gas Bill', 'Power & Gas', 'Electricity Charge', 'Water Bill'],
    baseAmount: 110,  variance: 0.25, countMin: 1, countMax: 2, accounts: [ACC_CREDIT] },
  { itemId: 103, type: 'out', names: ['Home Insurance Premium', 'Property Insurance'],
    baseAmount: 120,  variance: 0,    countMin: 1, countMax: 1, accounts: [ACC_CHECKING] },
  { itemId: 104, type: 'out', names: ['Internet Bill', 'Monthly Phone Plan', 'Broadband Charge', 'Mobile Plan'],
    baseAmount: 95,   variance: 0.05, countMin: 1, countMax: 2, accounts: [ACC_CREDIT] },

  // ── Food ────────────────────────────────────────────────────────────
  { itemId: 201, type: 'out', names: ['Woolworths', 'Coles', 'Aldi', 'IGA Supermarket', 'Harris Farm Markets', 'Costco', 'Grocery Run'],
    baseAmount: 120,  variance: 0.35, countMin: 4, countMax: 7, accounts: [ACC_CREDIT, ACC_CHECKING] },
  { itemId: 202, type: 'out', names: ["McDonald's", 'Thai Palace', 'Pizza Hut', 'Italian Bistro', 'Sushi Train', 'Grill & Burger', 'Noodle Bar', 'Chinese Takeaway', 'Indian Kitchen', 'Kebab House', 'Local Pub Meal'],
    baseAmount: 40,   variance: 0.55, countMin: 3, countMax: 7, accounts: [ACC_CREDIT, ACC_CASH] },
  { itemId: 203, type: 'out', names: ['Coffee', 'Starbucks', "Gloria Jean's", 'The Coffee Club', 'Bakery Snack', 'Petrol Station Snacks', 'Vending Machine'],
    baseAmount: 6,    variance: 0.5,  countMin: 7, countMax: 15, accounts: [ACC_CASH, ACC_CREDIT] },

  // ── Transport ───────────────────────────────────────────────────────
  { itemId: 301, type: 'out', names: ['Car Loan Repayment', 'Vehicle Finance', 'Auto Loan Payment'],
    baseAmount: 450,  variance: 0,    countMin: 1, countMax: 1, accounts: [ACC_CHECKING] },
  { itemId: 302, type: 'out', names: ['BP Fuel', 'Shell Service Station', '7-Eleven Fuel', 'Caltex Petrol', 'Fuel Top-Up', 'Ampol Petrol'],
    baseAmount: 75,   variance: 0.25, countMin: 2, countMax: 4, accounts: [ACC_CREDIT, ACC_CASH] },
  { itemId: 303, type: 'out', names: ['Monthly Transit Pass', 'Train Ticket', 'Bus Pass', 'Opal Card Top-Up', 'Ferry Ticket'],
    baseAmount: 40,   variance: 0.3,  countMin: 1, countMax: 3, accounts: [ACC_CASH] },

  // ── Entertainment ───────────────────────────────────────────────────
  { itemId: 401, type: 'out', names: ['Netflix', 'Spotify Premium', 'Disney+', 'Apple TV+', 'YouTube Premium', 'Binge Subscription'],
    baseAmount: 14,   variance: 0,    countMin: 1, countMax: 4, accounts: [ACC_CREDIT] },
  { itemId: 402, type: 'out', names: ['Steam Purchase', 'PlayStation Store', 'Xbox Game Pass', 'Nintendo eShop', 'App Store', 'Epic Games'],
    baseAmount: 32,   variance: 0.75, countMin: 0, countMax: 3, accounts: [ACC_CREDIT] },
  { itemId: 403, type: 'out', names: ['Cinema Tickets', 'Concert Tickets', 'Bar Tab', 'Sports Event', 'Night Out', 'Comedy Club', 'Live Music Venue', 'Bowling Alley'],
    baseAmount: 65,   variance: 0.6,  countMin: 1, countMax: 4, accounts: [ACC_CREDIT, ACC_CASH] },

  // ── Healthcare ──────────────────────────────────────────────────────
  { itemId: 501, type: 'out', names: ['Health Insurance Premium', 'Private Health Cover', 'Medibank Premium'],
    baseAmount: 280,  variance: 0,    countMin: 1, countMax: 1, accounts: [ACC_CHECKING] },
  { itemId: 502, type: 'out', names: ['Pharmacy', 'Doctor Visit', 'Chemist Warehouse', 'GP Consultation', 'Prescription', 'Specialist Consult'],
    baseAmount: 35,   variance: 0.7,  countMin: 0, countMax: 3, accounts: [ACC_CREDIT, ACC_CASH] },

  // ── Savings ─────────────────────────────────────────────────────────
  { itemId: 601, type: 'out', names: ['Emergency Fund Transfer', 'Transfer to Savings — Emergency'],
    baseAmount: 500,  variance: 0,    countMin: 1, countMax: 1, accounts: [ACC_SAVINGS] },
  { itemId: 602, type: 'out', names: ['401k Contribution', 'Superannuation Contribution', 'Retirement Fund Transfer'],
    baseAmount: 600,  variance: 0,    countMin: 1, countMax: 1, accounts: [ACC_INVESTMENT] },
  { itemId: 603, type: 'out', names: ['Investment Transfer', 'Brokerage Deposit', 'ETF Purchase', 'Shares Investment'],
    baseAmount: 400,  variance: 0.3,  countMin: 1, countMax: 2, accounts: [ACC_INVESTMENT] },
]

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randAmount(base: number, variance: number): number {
  const delta = base * variance
  const raw = base + (Math.random() * 2 - 1) * delta
  return Math.round(Math.max(0.01, raw) * 100) / 100
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function generateSeedTransactions(): Transaction[] {
  const txns: Transaction[] = []
  let id = 1
  const now = new Date()

  // Generate 6 months: 5 months ago through current month
  for (let offset = 5; offset >= 0; offset--) {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    const year  = d.getFullYear()
    const month = d.getMonth() + 1
    const mStr  = String(month).padStart(2, '0')
    const days  = daysInMonth(year, month)

    for (const tmpl of TEMPLATES) {
      const count = randInt(tmpl.countMin, tmpl.countMax)
      for (let n = 0; n < count; n++) {
        const day = String(randInt(1, days)).padStart(2, '0')
        const date = `${year}-${mStr}-${day}`
        txns.push({
          id: id++,
          name: pick(tmpl.names),
          date,
          createdAt: new Date(`${date}T${String(randInt(7, 20)).padStart(2, '0')}:${String(randInt(0, 59)).padStart(2, '0')}:00`).toISOString(),
          amount: randAmount(tmpl.baseAmount, tmpl.variance),
          type: tmpl.type,
          itemId: tmpl.itemId,
          accountId: pick(tmpl.accounts),
        })
      }
    }
  }

  // Sort chronologically (oldest first)
  txns.sort((a, b) => a.date.localeCompare(b.date))
  return txns
}

