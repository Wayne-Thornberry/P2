import { afterEach, describe, expect, it, vi } from 'vitest'
import { readStatements, wordsFrom } from './useStatement'

// ── Splitting a line into words ───────────────────────────────
// pdf.js hands back a line at a time, and the statement's rules need words: the right edge
// of an amount is what says which column it is in.

describe('reading a line off a statement PDF', () => {
  it('leaves a word that is already one word alone, at the width pdf.js measured', () => {
    const [word] = wordsFrom('5.50', 367.2, 15.6, 258.2)

    expect(word).toEqual({ text: '5.50', x0: 367.2, x1: 382.8, top: 258.2 })
  })

  it('splits a line into words, keeping the ends of the line exact', () => {
    const words = wordsFrom('03 Oct 2018', 79.2, 44.3, 246.2)

    expect(words.map(word => word.text)).toEqual(['03', 'Oct', '2018'])
    expect(words[0].x0).toBe(79.2)
    expect(words.at(-1)!.x1).toBeCloseTo(123.5, 1)
  })

  it('keeps the last word ending where the line does, which is what puts it in a column', () => {
    const words = wordsFrom('POSC02OCT DAYBREAK KE', 143.8, 106.4, 258.2)

    expect(words.at(-1)!.x1).toBeCloseTo(250.2, 1)
  })
})

// ── Asking the API for the transactions ───────────────────────

function answered(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('importing a statement', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('sends the words pdf.js read, and answers with the transactions', async () => {
    const answer = {
      bank: 'boi',
      bankName: 'Bank of Ireland',
      currency: 'EUR',
      rows: [{ isoDate: '2026-01-05', yearMonth: '2026-01', details: 'POS SHOP', amount: 5.5, type: 'out', balance: 94.5 }],
      openingBalance: 100,
      openingDate: '2026-01-04',
      closingBalance: 94.5,
      gaps: [],
      files: [],
    }

    const fetchMock = vi.fn().mockResolvedValue(answered(answer))
    vi.stubGlobal('fetch', fetchMock)

    vi.doMock('pdfjs-dist', () => ({
      GlobalWorkerOptions: { workerSrc: '' },
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: () => Promise.resolve({
            view: [0, 0, 595, 864],
            getTextContent: () => Promise.resolve({
              items: [
                { str: 'POS SHOP', transform: [1, 0, 0, 1, 143.8, 600], width: 60 },
                { str: '5.50', transform: [1, 0, 0, 1, 367.2, 600], width: 15.6 },
              ],
            }),
          }),
        }),
      }),
    }))

    vi.doMock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }))

    const { readStatements: read } = await import('./useStatement')
    const file = { name: 'statement.pdf', arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) } as unknown as File

    const result = await read([file])

    const [path, init] = fetchMock.mock.calls[0]
    expect(path).toBe('/api/folio/import/statement')
    expect(init.method).toBe('POST')

    const sent = JSON.parse(init.body)
    expect(sent.bank).toBe('boi')
    expect(sent.files[0].fileName).toBe('statement.pdf')
    expect(sent.files[0].pages[0].words).toEqual([
      { text: 'POS', x0: 143.8, x1: 166.3, top: 264 },
      { text: 'SHOP', x0: 173.8, x1: 203.8, top: 264 },
      { text: '5.50', x0: 367.2, x1: 382.8, top: 264 },
    ])
    expect(result.rows[0].details).toBe('POS SHOP')
  })

  it("repeats the API's own words when it refuses a statement", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Only a Bank of Ireland statement can be read: ?bank=boi.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )))

    vi.doMock('pdfjs-dist', () => ({
      GlobalWorkerOptions: { workerSrc: '' },
      getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }),
    }))
    vi.doMock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }))

    const { readStatements: read } = await import('./useStatement')

    await expect(read([])).rejects.toThrow('Only a Bank of Ireland statement can be read: ?bank=boi.')
  })
})

// The module-level import is what the first two tests use; this keeps it referenced.
void readStatements
