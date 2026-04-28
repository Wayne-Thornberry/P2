import type { Transaction } from '../types/transaction'

export function txNet(transaction: Pick<Transaction, 'type' | 'amount'>): number {
  return transaction.type === 'in' ? transaction.amount : -transaction.amount
}

export function roundCents(value: number): number {
  return Math.round(value * 100) / 100
}

/** Net total of an iterable of transactions (in - out). Result is rounded to cents. */
export function sumNet(txs: Iterable<Pick<Transaction, 'type' | 'amount'>>): number {
  let s = 0
  for (const t of txs) s += txNet(t)
  return roundCents(s)
}

/**
 * Deep clone helper. Prefers native `structuredClone` for fidelity, but falls
 * back to `JSON.parse(JSON.stringify(...))` when `structuredClone` is missing
 * **or** when it throws — which happens for Vue reactive proxies and any
 * value containing functions, Symbols, or class instances. Intended for
 * plain-data clones (POJOs, arrays of POJOs).
 */
export function cloneDeep<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value) } catch { /* fall through */ }
  }
  return JSON.parse(JSON.stringify(value)) as T
}
