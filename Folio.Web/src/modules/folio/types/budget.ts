/** Global definition of a budget item — id and name only, no category */
export interface BudgetItemDef {
  id: number
  name: string
}

/** Per-month assignment record — category is context-specific (per month/year) */
export interface BudgetMonthEntry {
  itemId: number
  assigned: number
  category: string
}

/** Per-template assignment record — same shape as BudgetMonthEntry */
export type TemplateEntry = BudgetMonthEntry

/** Full view of a budget item in a specific month (global def + monthly assigned + computed activity) */
export interface BudgetItem {
  id: number
  name: string
  category: string
  assigned: number
  activity: number
}

export type BudgetRow = BudgetItem & { available: number }
