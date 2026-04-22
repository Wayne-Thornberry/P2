import type { Transaction } from '../types/transaction'

export function txNet(transaction: Pick<Transaction, 'type' | 'amount'>): number {
  return transaction.type === 'in' ? transaction.amount : -transaction.amount
}

export function roundCents(value: number): number {
  return Math.round(value * 100) / 100
}