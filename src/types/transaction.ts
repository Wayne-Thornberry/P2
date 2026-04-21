/** Sentinel ID for the virtual "Unassigned" account (transactions with accountId === null). */
export const UNASSIGNED_ACCOUNT_ID = '__unassigned__' as const

/** Virtual account object representing all transactions that have no account assigned. */
export const UNASSIGNED_ACCOUNT: Account = {
  id:   UNASSIGNED_ACCOUNT_ID,
  name: 'Unassigned',
  type: 'asset',
}

export interface Account {
  id:                string
  name:              string
  type?:             'asset' | 'liability'  // default = 'asset'; liabilities excluded from budget by default
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
