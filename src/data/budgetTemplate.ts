import type { BudgetItem } from '../types/budget'

// ── Template IDs occupy the 3000 range ────────────────────────
// Using fixed IDs means transaction item-links remain valid if you
// repopulate a month from this template.

export const BUDGET_TEMPLATE: BudgetItem[] = [

  // ── Income ───────────────────────────────────────────────────
  { id: 3001, category: 'Income',    name: 'Salary',       assigned: 0, activity: 0 },
  { id: 3002, category: 'Income',    name: 'Other Income', assigned: 0, activity: 0 },

  // ── Housing ──────────────────────────────────────────────────
  { id: 3101, category: 'Housing',   name: 'Rent',         assigned: 0, activity: 0 },
  { id: 3102, category: 'Housing',   name: 'Utilities',    assigned: 0, activity: 0 },

  // ── Food ─────────────────────────────────────────────────────
  { id: 3201, category: 'Food',      name: 'Groceries',    assigned: 0, activity: 0 },
  { id: 3202, category: 'Food',      name: 'Eating Out',   assigned: 0, activity: 0 },

  // ── Transport ────────────────────────────────────────────────
  { id: 3301, category: 'Transport', name: 'Transport',    assigned: 0, activity: 0 },

  // ── Savings ──────────────────────────────────────────────────
  { id: 3701, category: 'Savings',   name: 'Savings',      assigned: 0, activity: 0 },
]
