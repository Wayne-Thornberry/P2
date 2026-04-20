export interface Account {
  id: string
  name: string
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
}
