import { describe, it, expect } from 'vitest'
import { detectDelimiter, splitCsvLine, parseCsvText, parseDate, parseAmount } from '../csvUtils'

// ── detectDelimiter ───────────────────────────────────────────────────────────
describe('detectDelimiter', () => {
  it('detects comma', () => {
    expect(detectDelimiter('Date,Details,Debit,Credit,Balance')).toBe(',')
  })
  it('detects semicolon', () => {
    expect(detectDelimiter('Date;Details;Amount;Balance')).toBe(';')
  })
  it('detects tab', () => {
    expect(detectDelimiter('Date\tDetails\tAmount')).toBe('\t')
  })
  it('detects pipe', () => {
    expect(detectDelimiter('Date|Amount|Balance')).toBe('|')
  })
  it('defaults to comma on ambiguous input', () => {
    expect(detectDelimiter('nodélimiter')).toBe(',')
  })
})

// ── splitCsvLine ──────────────────────────────────────────────────────────────
describe('splitCsvLine', () => {
  it('splits simple CSV row', () => {
    expect(splitCsvLine('2025-01-01,Coffee,5.00,out')).toEqual(['2025-01-01', 'Coffee', '5.00', 'out'])
  })
  it('handles quoted field with comma inside', () => {
    expect(splitCsvLine('"Tesco, Galway",25.00')).toEqual(['Tesco, Galway', '25.00'])
  })
  it('handles escaped double-quotes inside quoted field', () => {
    expect(splitCsvLine('"He said ""hello""",10.00')).toEqual(['He said "hello"', '10.00'])
  })
  it('handles empty fields', () => {
    expect(splitCsvLine('2025-01-01,,5.00')).toEqual(['2025-01-01', '', '5.00'])
  })
  it('supports semicolon delimiter', () => {
    expect(splitCsvLine('2025-01-01;Lidl;12.50', ';')).toEqual(['2025-01-01', 'Lidl', '12.50'])
  })
  it('trims whitespace from unquoted fields', () => {
    expect(splitCsvLine(' 2025-01-01 ,  Lidl  , 12.50 ')).toEqual(['2025-01-01', 'Lidl', '12.50'])
  })
})

// ── parseCsvText ──────────────────────────────────────────────────────────────
describe('parseCsvText', () => {
  it('parses header and data rows', () => {
    const csv = 'Date,Amount\n2025-01-01,10.00\n2025-01-02,20.00'
    const { headers, dataLines } = parseCsvText(csv)
    expect(headers).toEqual(['date', 'amount'])
    expect(dataLines).toHaveLength(2)
    expect(dataLines[0][1]).toBe('10.00')
  })
  it('handles CRLF line endings', () => {
    const csv = 'Date,Amount\r\n2025-01-01,10.00\r\n'
    const { dataLines } = parseCsvText(csv)
    expect(dataLines).toHaveLength(1)
  })
  it('skips blank lines', () => {
    const csv = 'Date,Amount\n\n2025-01-01,10.00\n\n'
    const { dataLines } = parseCsvText(csv)
    expect(dataLines).toHaveLength(1)
  })
  it('returns empty on empty input', () => {
    const { headers, dataLines } = parseCsvText('')
    expect(headers).toHaveLength(0)
    expect(dataLines).toHaveLength(0)
  })
})

// ── parseDate ─────────────────────────────────────────────────────────────────
describe('parseDate', () => {
  it('passes through ISO format', () => {
    expect(parseDate('2025-12-30')).toBe('2025-12-30')
  })
  it('parses DD/MM/YYYY', () => {
    expect(parseDate('30/12/2025')).toBe('2025-12-30')
  })
  it('parses DD.MM.YYYY', () => {
    expect(parseDate('30.12.2025')).toBe('2025-12-30')
  })
  it('parses DD-MM-YYYY', () => {
    expect(parseDate('30-12-2025')).toBe('2025-12-30')
  })
  it('returns null for invalid date', () => {
    expect(parseDate('not-a-date')).toBeNull()
  })
  it('returns null for empty string', () => {
    expect(parseDate('')).toBeNull()
  })
})

// ── parseAmount ───────────────────────────────────────────────────────────────
describe('parseAmount', () => {
  it('parses plain positive decimal', () => {
    expect(parseAmount('25.50')).toBe(25.5)
  })
  it('parses plain negative decimal', () => {
    expect(parseAmount('-206.71')).toBe(-206.71)
  })
  it('parses trailing minus (EU bank style)', () => {
    expect(parseAmount('206.71-')).toBe(-206.71)
  })
  it('parses European format 1.234,56', () => {
    expect(parseAmount('1.234,56')).toBe(1234.56)
  })
  it('parses comma-thousands 1,234.56', () => {
    expect(parseAmount('1,234.56')).toBe(1234.56)
  })
  it('parses comma-decimal -206,71', () => {
    expect(parseAmount('-206,71')).toBe(-206.71)
  })
  it('strips euro symbol', () => {
    expect(parseAmount('€12.00')).toBe(12)
  })
  it('returns NaN for non-numeric', () => {
    expect(parseAmount('abc')).toBeNaN()
  })
  it('returns NaN for empty string', () => {
    expect(parseAmount('')).toBeNaN()
  })
})
