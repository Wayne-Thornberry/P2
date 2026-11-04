// The mock's read of a bank statement PDF.
//
// The rules live in the API (Modules/Folio/BankStatement.cs); this is the same rule again
// so that dropping a statement works with no database, no .NET and no SQL Server. What the
// site sends is what pdf.js could read off the page — words and the boxes they were drawn
// in — so nothing here touches a PDF: keep the two in step, and a statement that imports
// locally imports on the box.

const LINE_TOLERANCE = 3
const SAME_BALANCE = 0.005
const MAX_DESCRIPTION = 120

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const FURNITURE = [
  'Transaction details', 'Opening Balance', 'Closing Balance',
  'Bank of Ireland', 'Sort Code', 'IBAN', 'BIC', 'Account Number',
  'SUBTOTAL', 'Page ', 'Registered No', 'Tel (', 'Fax (',
  'Branch code', 'Bank Identifier Code', 'Your account name',
  '3RD LEVEL ACCOUNT', 'Statement date', 'Your Current Account Statement',
  'Account number', 'MR WAYNE THORNBERRY',
  'Deposit Guarantee Scheme', 'Depositor Information Sheet',
  'bankofireland.com', 'eligible deposit',
  'Registered Office', 'Head Office', 'Mespil Road',
  'BALANCE FORWARD', 'INTEREST RATE PAYABLE FROM DATE',
  'Interest Rates payable are quoted gross on Cleared Credit Balances',
]

/** Why this request cannot be read, or null when it can. */
export function statementRefusal(request) {
  const bank = (request?.bank ?? 'boi').trim().toLowerCase()

  if (bank !== 'boi') return 'Only a Bank of Ireland statement can be read: ?bank=boi.'

  const files = request?.files ?? []
  if (files.length === 0) return 'A statement is needed.'

  const empty = files.find(file => (file.pages ?? []).every(page => (page.words ?? []).length === 0))
  if (empty) return `Nothing could be read from ${empty.fileName}.`

  return null
}

/** A statement's rows, merged into one answer. */
export function readStatement(request) {
  const files = (request.files ?? [])
    .map(readFile)
    .sort((left, right) => oldestOf(left).localeCompare(oldestOf(right)))

  const first = files.find(file => file.rows.length > 0)
  const last = [...files].reverse().find(file => file.rows.length > 0)

  return {
    bank: 'boi',
    bankName: 'Bank of Ireland',
    currency: 'EUR',
    rows: merge(files),
    openingBalance: first?.openingBalance ?? null,
    openingDate: first ? dayBefore(first.rows[0].isoDate) : '',
    closingBalance: last?.closingBalance ?? null,
    gaps: gapsBetween(files),
    files: files.map(file => ({
      fileName: file.fileName,
      rowCount: file.rows.length,
      oldestDate: file.rows[0]?.isoDate ?? '',
      newestDate: file.rows.at(-1)?.isoDate ?? '',
      openingBalance: file.openingBalance,
      closingBalance: file.closingBalance,
    })),
  }
}

const oldestOf = file => (file.rows.length > 0 ? file.rows[0].isoDate : '9999-99-99')

function dayBefore(date) {
  const [year, month, day] = date.split('-').map(Number)
  const previous = new Date(Date.UTC(year, month - 1, day - 1))
  return previous.toISOString().slice(0, 10)
}

function readFile(file) {
  let columns = { debit: null, credit: null }
  const rows = []
  const state = { date: null }
  const pending = []

  for (const page of file.pages ?? []) {
    const lines = groupLines(page.words ?? [])
    const found = findColumns(lines)
    if (found) columns = found

    readLines(lines, columns, rows, state, pending)
  }

  rows.sort((left, right) => left.isoDate.localeCompare(right.isoDate))
  const balances = propagate(rows)

  const statement = rows.map((row, index) => ({
    isoDate: row.isoDate,
    yearMonth: row.isoDate.slice(0, 7),
    details: row.details,
    amount: row.amount,
    type: row.type,
    balance: balances[index],
  }))

  let openingBalance = null
  let closingBalance = null

  if (statement.length > 0) {
    closingBalance = statement.at(-1).balance
    const oldest = statement[0]
    openingBalance = oldest.balance === null
      ? null
      : Math.round((oldest.type === 'in' ? oldest.balance - oldest.amount : oldest.balance + oldest.amount) * 100) / 100
  }

  return { fileName: file.fileName, rows: statement, openingBalance, closingBalance }
}

/** Words grouped by the line they sit on, each line left to right. */
function groupLines(words) {
  const lines = new Map()

  for (const word of words) {
    const key = Math.round(word.top / LINE_TOLERANCE) * LINE_TOLERANCE
    if (!lines.has(key)) lines.set(key, [])
    lines.get(key).push(word)
  }

  return [...lines.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, line]) => line.sort((left, right) => left.x0 - right.x0))
}

/** Where the money columns begin, read off the headings. */
function findColumns(lines) {
  for (const line of lines) {
    const text = line.map(word => word.text).join(' ')
    if (!text.includes('Balance') || !text.includes('Payments')) continue

    const payments = line.filter(word => word.text === 'Payments')
    const balance = line.find(word => word.text === 'Balance')

    if (payments.length >= 2 && balance) return { debit: payments[1].x0, credit: balance.x0 }
  }

  return null
}

function isAmount(text) {
  const separator = text.indexOf('.')
  if (separator < 1 || text.length - separator !== 3) return false
  if (!/^\d+$/.test(text.slice(separator + 1))) return false

  const groups = text.slice(0, separator).split(',')
  if (!groups.every(group => /^\d+$/.test(group))) return false

  return groups.length === 1 || (groups[0].length <= 3 && groups.slice(1).every(group => group.length === 3))
}

const amountOf = text => (isAmount(text) ? Number(text.replace(/,/g, '')) : null)

function columnOf(word, columns) {
  if (columns.debit !== null && word.x1 <= columns.debit) return 'debit'
  if (columns.credit !== null && word.x1 <= columns.credit) return 'credit'
  return 'balance'
}

function dateOf(tokens) {
  const parts = tokens.length === 1 ? tokens[0].replace(/-/g, ' ').split(/\s+/) : tokens
  if (parts.length !== 3) return null

  const [day, month, year] = parts
  if (!/^\d{1,2}$/.test(day)) return null

  const monthNumber = MONTHS.findIndex(name => name.toLowerCase() === month.toLowerCase()) + 1
  if (monthNumber === 0) return null
  if (!/^\d{2}(\d{2})?$/.test(year)) return null

  const fullYear = year.length === 2 ? Number(year) + (Number(year) < 70 ? 2000 : 1900) : Number(year)
  const daysInMonth = new Date(Date.UTC(fullYear, monthNumber, 0)).getUTCDate()

  if (Number(day) < 1 || Number(day) > daysInMonth) return null

  return `${fullYear}-${String(monthNumber).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`
}

function readLines(lines, columns, rows, state, pending) {
  for (const line of lines) {
    const text = line.map(word => word.text).join(' ')
    let start = 0

    const single = line.length >= 1 ? dateOf([line[0].text]) : null
    const triple = line.length >= 3 ? dateOf(line.slice(0, 3).map(word => word.text)) : null

    if (single) {
      state.date = single
      start = 1
      pending.length = 0
    } else if (triple) {
      state.date = triple
      start = 3
      pending.length = 0
    }

    if (FURNITURE.some(phrase => text.includes(phrase))) {
      pending.length = 0
      continue
    }

    const date = state.date
    if (!date) continue

    const details = []
    const amounts = { debit: null, credit: null, balance: null }

    for (const word of line.slice(start)) {
      const amount = amountOf(word.text)
      if (amount === null) {
        details.push(word.text)
        continue
      }
      amounts[columnOf(word, columns)] = amount
    }

    const moneyOut = amounts.debit !== null
    const moneyIn = amounts.credit !== null

    if (!moneyOut && !moneyIn) {
      if (start > 0 && details.length > 0) {
        pending.length = 0
        pending.push(...details)
      }
      continue
    }

    const words = pending.length > 0 ? [...pending, ...details] : details
    pending.length = 0

    rows.push({
      isoDate: date,
      details: words.join(' ').trim().slice(0, MAX_DESCRIPTION),
      amount: moneyOut ? amounts.debit : amounts.credit,
      type: moneyOut ? 'out' : 'in',
      balance: amounts.balance,
    })
  }
}

/** A balance on every row, worked out from the ones the statement prints. */
function propagate(rows) {
  const balances = rows.map(() => null)
  const anchor = rows.findIndex(row => row.balance !== null)

  if (anchor < 0) return balances

  const signed = row => (row.type === 'in' ? row.amount : -row.amount)

  balances[anchor] = rows[anchor].balance

  for (let index = anchor + 1; index < rows.length; index++) {
    balances[index] = Math.round((balances[index - 1] + signed(rows[index])) * 100) / 100
  }

  for (let index = anchor - 1; index >= 0; index--) {
    balances[index] = Math.round((balances[index + 1] - signed(rows[index + 1])) * 100) / 100
  }

  return balances
}

/** Every file's rows together, with the same transaction in two statements kept once. */
function merge(files) {
  const merged = []
  const seen = new Map()

  for (const file of files) {
    const consumed = new Map()

    for (const row of file.rows) {
      const key = `${row.isoDate}|${row.details}|${row.amount}|${row.type}`
      const taken = consumed.get(key) ?? 0
      consumed.set(key, taken + 1)

      const already = seen.get(key) ?? 0
      if (taken < already) continue

      merged.push(row)
      seen.set(key, already + 1)
    }
  }

  return merged
}

/** Balances that do not run on from one statement to the next. */
function gapsBetween(files) {
  const gaps = []

  for (let index = 0; index < files.length - 1; index++) {
    const previous = files[index]
    const next = files[index + 1]

    if (previous.closingBalance === null || next.openingBalance === null) continue

    const difference = Math.round((next.openingBalance - previous.closingBalance) * 100) / 100
    if (Math.abs(difference) <= SAME_BALANCE) continue

    gaps.push({
      date: next.rows[0].isoDate,
      amount: Math.abs(difference),
      type: difference > 0 ? 'in' : 'out',
      label: `Balance adjustment between ${previous.fileName} and ${next.fileName}`,
    })
  }

  return gaps
}
