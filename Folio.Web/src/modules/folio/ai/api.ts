import { api } from '../../../shared'

/**
 * What the two AI features ask the API for.
 *
 * The API is the only thing that talks to DeepSeek: the page sends what it wants looked
 * at, and gets back a report or a set of proposed assignments. Nothing here costs money
 * until it is called, which is why both are on a button rather than on a timer.
 */

/** Whether this box can write a report, and which model would write it. */
export interface AiStatus {
  available: boolean
  model: string
}

export interface AnalysisTotals {
  in: number
  out: number
  net: number
  savingsRate: number
  averageOutPerMonth: number
  transactions: number
  averageTransaction: number
  uncategorised: number
}

export interface AnalysisMonth {
  month: string
  in: number
  out: number
  count: number
}

export interface AnalysisCategory {
  itemId: number | null
  name: string
  spent: number
  count: number
  share: number
  assigned: number
  category: string | null
}

export interface AnalysisMerchant {
  name: string
  spent: number
  count: number
  average: number
  months: number
  last: string
}

export interface AnalysisAccountSlice {
  id: string | null
  name: string
  in: number
  out: number
  count: number
  share: number
}

export interface AnalysisWeekday {
  day: string
  spent: number
  count: number
  share: number
}

export interface AnalysisEntry {
  date: string
  name: string
  amount: number
  account: string
  item: string
}

export interface AnalysisRecurring {
  name: string
  amount: number
  months: number
  count: number
  last: string
}

export interface AnalysisOverspend {
  itemId: number
  name: string
  assigned: number
  spent: number
  over: number
}

export interface AnalysisFacts {
  currency: string
  totals: AnalysisTotals
  months: AnalysisMonth[]
  categories: AnalysisCategory[]
  merchants: AnalysisMerchant[]
  accounts: AnalysisAccountSlice[]
  weekdays: AnalysisWeekday[]
  largest: AnalysisEntry[]
  recurring: AnalysisRecurring[]
  budget: {
    assigned: number
    spent: number
    overBudgetItems: number
    overspending: AnalysisOverspend[]
    uncategorisedTransactions: number
    uncategorisedAmount: number
  }
  flaggedCount: number
  flaggedAmount: number
}

export interface AnalysisFinding {
  title: string
  detail: string
  severity: 'high' | 'medium' | 'low'
}

export interface AnalysisReport {
  headline: string
  summary: string
  findings: AnalysisFinding[]
  patterns: string[]
  risks: string[]
  actions: string[]
}

export interface AnalysisResponse {
  generatedAt: string
  model: string
  period: { from: string; to: string; months: number }
  accounts: AnalysisAccountSlice[]
  facts: AnalysisFacts
  report: AnalysisReport
}

/** One transaction as the categoriser is given it. */
export interface CategoriseInput {
  id: number
  name: string
  notes?: string
  amount: number
  type: 'in' | 'out'
  date: string
}

export interface CategoriseAssignment {
  transactionId: number
  itemId?: number | null
  itemName: string
  isNew: boolean
  confidence: number
  why: string
}

export interface CategoriseResponse {
  assignments: CategoriseAssignment[]
  newItems: string[]
  unmatched: number[]
  considered: number
  items: Array<{ id: number; name: string }>
}

export function fetchStatus(): Promise<AiStatus> {
  return api.get<AiStatus>('/api/folio/ai')
}

/** A written report on the last N months, for every account or the ones named. */
export function generate(
  country: string,
  accounts: string[],
  months: number,
): Promise<AnalysisResponse> {
  return api.post<AnalysisResponse>(
    `/api/folio/analysis?country=${encodeURIComponent(country)}`,
    { accounts, months },
  )
}

/** What item each of these transactions belongs to, as a proposal nothing has saved yet. */
export function categorise(
  country: string,
  transactions: CategoriseInput[],
  items: Array<{ id: number; name: string }>,
): Promise<CategoriseResponse> {
  return api.post<CategoriseResponse>(
    `/api/folio/categorise?country=${encodeURIComponent(country)}`,
    { transactions, items },
  )
}
