import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useTransactionStore } from './transactionStore'
import { useSettingsStore } from './settingsStore'
import { roundCents, txNet } from '../utils/math'
import { storageKey, loadStored } from '../utils/storeStorage'

export interface LoanRecord {
  id:               number
  name:             string
  principal:        number        // original loan amount
  apr:              number        // annual % rate (e.g. 5.5 = 5.5%)
  termMonths:       number        // total term in months
  startDate:        string        // YYYY-MM-DD
  linkedAccountId?: string
  color:            string
  createdAt:        string
  archived:         boolean
}

export interface SavingsAccountRecord {
  id:               number
  name:             string
  apr:              number        // annual % rate
  compoundFreq:     'monthly' | 'quarterly' | 'annually'
  startBalance:     number        // opening balance
  startDate:        string        // YYYY-MM-DD
  linkedAccountId?: string
  color:            string
  createdAt:        string
  archived:         boolean
}

export interface AmortizationRow {
  month:          number   // 1-indexed
  date:           string   // YYYY-MM
  openingBalance: number
  payment:        number
  interestPaid:   number
  principalPaid:  number
  closingBalance: number
}

const LOAN_COLORS = ['#ef4444', '#f97316', '#6366f1', '#8b5cf6', '#ec4899', '#14b8a6', '#10b981', '#f59e0b']
const SAV_COLORS  = ['#10b981', '#14b8a6', '#6366f1', '#8b5cf6', '#f59e0b', '#f97316', '#ec4899', '#ef4444']

let _nextLoanId = 1
let _nextSavId  = 1

export const useLoanStore = defineStore('loans', () => {
  const settings = useSettingsStore()

  function _key(): string { return storageKey('clearbook_finance', settings.country) }
  function _load() { return loadStored('clearbook_finance', settings.country) }

  const _saved = _load()
  const loans   = ref<LoanRecord[]>(_saved?.loans ?? [])
  const savings = ref<SavingsAccountRecord[]>(_saved?.savings ?? [])
  if (_saved?.nextLoanId != null) _nextLoanId = _saved.nextLoanId
  if (_saved?.nextSavId  != null) _nextSavId  = _saved.nextSavId

  watch([loans, savings], () => {
    localStorage.setItem(_key(), JSON.stringify({
      loans: loans.value, savings: savings.value,
      nextLoanId: _nextLoanId, nextSavId: _nextSavId,
    }))
  }, { deep: true })

  watch(() => settings.country, (c) => {
    if (!c) return
    const s = _load()
    _nextLoanId   = s?.nextLoanId ?? 1
    _nextSavId    = s?.nextSavId  ?? 1
    loans.value   = s?.loans   ?? []
    savings.value = s?.savings ?? []
  })

  // ── Loans ─────────────────────────────────────────────────────
  function addLoan(
    name: string, principal: number, apr: number,
    termMonths: number, startDate: string, linkedAccountId?: string,
  ): LoanRecord {
    const id = _nextLoanId++
    const loan: LoanRecord = {
      id, name: name.trim(), principal, apr, termMonths, startDate,
      linkedAccountId: linkedAccountId || undefined,
      color: LOAN_COLORS[id % LOAN_COLORS.length],
      createdAt: new Date().toISOString(), archived: false,
    }
    loans.value.push(loan)
    return loan
  }

  function updateLoan(id: number, patch: Partial<Omit<LoanRecord, 'id' | 'createdAt' | 'color'>>): void {
    const l = loans.value.find(l => l.id === id)
    if (l) Object.assign(l, patch)
  }

  function deleteLoan(id: number): void {
    const idx = loans.value.findIndex(l => l.id === id)
    if (idx !== -1) loans.value.splice(idx, 1)
  }

  // ── Savings accounts ─────────────────────────────────────────
  function addSavingsAccount(
    name: string, apr: number, compoundFreq: SavingsAccountRecord['compoundFreq'],
    startBalance: number, startDate: string, linkedAccountId?: string,
  ): SavingsAccountRecord {
    const id = _nextSavId++
    const sav: SavingsAccountRecord = {
      id, name: name.trim(), apr, compoundFreq, startBalance, startDate,
      linkedAccountId: linkedAccountId || undefined,
      color: SAV_COLORS[id % SAV_COLORS.length],
      createdAt: new Date().toISOString(), archived: false,
    }
    savings.value.push(sav)
    return sav
  }

  function updateSavingsAccount(id: number, patch: Partial<Omit<SavingsAccountRecord, 'id' | 'createdAt' | 'color'>>): void {
    const s = savings.value.find(s => s.id === id)
    if (s) Object.assign(s, patch)
  }

  function deleteSavingsAccount(id: number): void {
    const idx = savings.value.findIndex(s => s.id === id)
    if (idx !== -1) savings.value.splice(idx, 1)
  }

  // ── Amortization ─────────────────────────────────────────────
  function calcAmortization(loan: LoanRecord): AmortizationRow[] {
    const r = loan.apr / 100 / 12
    const n = loan.termMonths
    const P = loan.principal
    const M = r > 0
      ? P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1)
      : P / n

    let balance = P
    const rows: AmortizationRow[] = []
    const start = new Date(loan.startDate + 'T00:00:00')

    for (let i = 0; i < n; i++) {
      const d = new Date(start)
      d.setMonth(d.getMonth() + i + 1)
      const label     = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const opening   = balance
      const interest  = balance * r
      const principal = Math.min(M - interest, balance)
      balance         = Math.max(0, balance - principal)
      rows.push({
        month: i + 1, date: label,
        openingBalance: roundCents(opening),
        payment:        roundCents(M),
        interestPaid:   roundCents(interest),
        principalPaid:  roundCents(principal),
        closingBalance: roundCents(balance),
      })
    }
    return rows
  }

  function monthlyPayment(loan: LoanRecord): number {
    const r = loan.apr / 100 / 12
    const n = loan.termMonths
    const P = loan.principal
    if (r === 0) return roundCents(P / n)
    return roundCents(P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1))
  }

  function totalInterest(loan: LoanRecord): number {
    return Math.max(0, roundCents(monthlyPayment(loan) * loan.termMonths - loan.principal))
  }

  // ── Savings projection ────────────────────────────────────────
  function calcSavingsProjection(sav: SavingsAccountRecord, months: number): { date: string; balance: number }[] {
    const freqMap: Record<string, number> = { monthly: 12, quarterly: 4, annually: 1 }
    const periodsPerYear  = freqMap[sav.compoundFreq]
    const rPerPeriod      = sav.apr / 100 / periodsPerYear
    const periodsPerMonth = periodsPerYear / 12
    const start           = new Date(sav.startDate + 'T00:00:00')
    return Array.from({ length: months + 1 }, (_, i) => {
      const d = new Date(start)
      d.setMonth(d.getMonth() + i)
      const label   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const balance = sav.startBalance * Math.pow(1 + rPerPeriod, i * periodsPerMonth)
      return { date: label, balance: roundCents(balance) }
    })
  }

  // ── Monthly running balance for a linked account ──────────────
  function buildMonthlyRunningBalance(accountId: string): Map<string, number> {
    const txStore = useTransactionStore()
    const txs = txStore.transactions
      .filter(t => t.accountId === accountId)
      .sort((a, b) => a.date.localeCompare(b.date))
    const byMonth = new Map<string, number>()
    let running   = 0
    for (const t of txs) {
      running += txNet(t)
      byMonth.set(t.date.slice(0, 7), running)
    }
    return byMonth
  }

  function accountNetBalance(accountId: string): number {
    const txStore = useTransactionStore()
    const net = txStore.transactions
      .filter(t => t.accountId === accountId)
      .reduce((sum, transaction) => sum + txNet(transaction), 0)
    return roundCents(net)
  }

  return {
    loans, savings,
    addLoan, updateLoan, deleteLoan,
    addSavingsAccount, updateSavingsAccount, deleteSavingsAccount,
    calcAmortization, monthlyPayment, totalInterest,
    calcSavingsProjection, buildMonthlyRunningBalance, accountNetBalance,
  }
})
