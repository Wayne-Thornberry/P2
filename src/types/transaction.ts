/** Sentinel ID for the virtual "Unassigned" account (transactions with accountId === null). */
export const UNASSIGNED_ACCOUNT_ID = '__unassigned__' as const

/** Sentinel ID for the virtual "Cash" account (cash transactions with no bank account). */
export const CASH_ACCOUNT_ID = '__cash__' as const

/** Virtual account object representing all transactions that have no account assigned. */
export const UNASSIGNED_ACCOUNT: Account = {
  id:   UNASSIGNED_ACCOUNT_ID,
  name: 'Unassigned',
  type: 'asset',
}

/** Virtual account object representing cash transactions. */
export const CASH_ACCOUNT: Account = {
  id:   CASH_ACCOUNT_ID,
  name: 'Cash',
  type: 'asset',
}

export interface Account {
  id:                string
  name:              string
  type?:             'asset' | 'savings' | 'liability'  // asset = current/everyday; savings = savings account; liability = loan/credit card
  excludeFromBudget?: boolean               // explicit override: true = exclude, false = force include
  archived?:         boolean                // historical/closed — transactions locked, excluded from budget
  bankId?:           string                 // CSV adapter id for bank-specific name cleaning (e.g. 'boi', 'revolut')
}

export interface Transaction {
  id: number
  name: string
  date: string        // YYYY-MM-DD, user-set
  createdAt: string   // ISO datetime, auto-recorded
  amount: number      // always positive
  type: 'in' | 'out'
  itemId: number | null   // null = N/A
  accountId: string | null
  notes?: string          // optional memo
  flagged?: boolean       // user-set flag
  locked?: boolean        // prevents editing/deletion when true
}
