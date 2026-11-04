// ── useStatement ───────────────────────────────────────────────
// A bank statement as a PDF is a picture of a table, not a file of rows: what says whether
// an amount is money in or money out is which column it was drawn in. So the browser does
// the reading — pdf.js turns the page into words and the boxes they were drawn in — and the
// API does the understanding, because the layout of a Bank of Ireland statement is a rule
// about the bank, not about this page (see BankStatement.cs).
//
// pdf.js is imported when a statement is dropped rather than with the app: a budget does
// not need a PDF reader until somebody hands it a PDF.

import { api } from '../../../shared'

/** A word on a page, and the box it was drawn in, in points from the page's top left. */
export interface StatementWord {
  text: string
  x0:   number
  x1:   number
  top:  number
}

export interface StatementPage {
  words: StatementWord[]
}

export interface StatementFileWords {
  fileName: string
  pages:    StatementPage[]
}

export interface StatementRow {
  isoDate:   string
  yearMonth: string
  details:   string
  amount:    number
  type:      'in' | 'out'
  balance:   number | null
}

export interface StatementGap {
  date:   string
  amount: number
  type:   'in' | 'out'
  label:  string
}

export interface StatementFileSummary {
  fileName:       string
  rowCount:       number
  oldestDate:     string
  newestDate:     string
  openingBalance: number | null
  closingBalance: number | null
}

/** What the API answers: the statements' transactions, oldest first, and the balances either end. */
export interface StatementAnswer {
  bank:           string
  bankName:       string
  currency:       string
  rows:           StatementRow[]
  openingBalance: number | null
  openingDate:    string
  closingBalance: number | null
  gaps:           StatementGap[]
  files:          StatementFileSummary[]
}

/**
 * A line of text as words, with the width shared out by character count.
 *
 * pdf.js hands back a line at a time; a statement's columns are decided by where each word
 * ends, so a line has to become words again. Sharing the width out is an estimate — except
 * for the last word, whose right edge is exact, and the right edge is what decides which
 * money column a number is in.
 */
export function wordsFrom(text: string, left: number, width: number, top: number): StatementWord[] {
  const trimmed = text.trim()

  if (!trimmed.includes(' ')) return [{ text: trimmed, x0: left, x1: left + width, top }]

  const words: StatementWord[] = []
  let taken = 0

  for (const word of trimmed.split(/\s+/)) {
    const start = trimmed.indexOf(word, taken)
    taken = start + word.length

    words.push({
      text: word,
      x0:   left + (start / trimmed.length) * width,
      x1:   left + (taken / trimmed.length) * width,
      top,
    })
  }

  return words
}

/**
 * Reads a PDF's words, and where each one sits.
 */
export async function statementWords(file: File): Promise<StatementFileWords> {
  const pdfjs = await import('pdfjs-dist')

  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default

  const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const pages: StatementPage[] = []

  for (let number = 1; number <= document.numPages; number++) {
    const page = await document.getPage(number)
    const height = page.view[3] - page.view[1]
    const content = await page.getTextContent()
    const words: StatementWord[] = []

    for (const item of content.items) {
      if (!('str' in item) || item.str.trim().length === 0) continue

      words.push(...wordsFrom(item.str, item.transform[4], item.width, height - item.transform[5]))
    }

    pages.push({ words })
  }

  return { fileName: file.name, pages }
}

/** Reads one or more statements as one set of transactions. */
export async function readStatements(files: File[]): Promise<StatementAnswer> {
  const read = await Promise.all(files.map(statementWords))

  return api.post<StatementAnswer>('/api/folio/import/statement', { bank: 'boi', files: read })
}
