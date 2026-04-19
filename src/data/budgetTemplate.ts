import type { BudgetItem } from '../types/budget'

// ── Template IDs occupy the 3000 range ────────────────────────
// Using fixed IDs means transaction item-links remain valid if you
// repopulate a month from this template.
//
// Assigned amounts represent sensible monthly defaults for a
// single working adult. Adjust in the budget table after populating.

export const BUDGET_TEMPLATE: BudgetItem[] = [

  // ── Income ───────────────────────────────────────────────────
  { id: 3001, category: 'Income',               name: 'Salary',               assigned: 3500, activity: 0 },
  { id: 3002, category: 'Income',               name: 'Other Income',          assigned: 0,    activity: 0 },

  // ── Housing ──────────────────────────────────────────────────
  { id: 3101, category: 'Housing',              name: 'Rent',                  assigned: 1200, activity: 0 },
  { id: 3102, category: 'Housing',              name: 'Electricity & Gas',     assigned: 120,  activity: 0 },
  { id: 3103, category: 'Housing',              name: 'Internet & Phone',      assigned: 70,   activity: 0 },

  // ── Food ─────────────────────────────────────────────────────
  { id: 3201, category: 'Food',                 name: 'Groceries',             assigned: 350,  activity: 0 },
  { id: 3202, category: 'Food',                 name: 'Eating Out',            assigned: 150,  activity: 0 },
  { id: 3203, category: 'Food',                 name: 'Coffee & Snacks',       assigned: 40,   activity: 0 },

  // ── Transport ────────────────────────────────────────────────
  { id: 3301, category: 'Transport',            name: 'Fuel',                  assigned: 120,  activity: 0 },
  { id: 3302, category: 'Transport',            name: 'Car Insurance',         assigned: 80,   activity: 0 },
  { id: 3303, category: 'Transport',            name: 'Public Transport',      assigned: 50,   activity: 0 },

  // ── Health & Fitness ─────────────────────────────────────────
  { id: 3401, category: 'Health & Fitness',     name: 'Gym',                   assigned: 40,   activity: 0 },
  { id: 3402, category: 'Health & Fitness',     name: 'Pharmacy & Medical',    assigned: 50,   activity: 0 },

  // ── Bills & Subscriptions ────────────────────────────────────
  { id: 3501, category: 'Bills & Subscriptions', name: 'Streaming Services',   assigned: 30,   activity: 0 },
  { id: 3502, category: 'Bills & Subscriptions', name: 'Other Bills',          assigned: 50,   activity: 0 },

  // ── Personal ─────────────────────────────────────────────────
  { id: 3601, category: 'Personal',             name: 'Clothing',              assigned: 60,   activity: 0 },
  { id: 3602, category: 'Personal',             name: 'Personal Care',         assigned: 30,   activity: 0 },
  { id: 3603, category: 'Personal',             name: 'Gifts & Misc',          assigned: 50,   activity: 0 },

  // ── Savings ──────────────────────────────────────────────────
  { id: 3701, category: 'Savings',              name: 'Emergency Fund',        assigned: 200,  activity: 0 },
  { id: 3702, category: 'Savings',              name: 'Savings Goal',          assigned: 200,  activity: 0 },
]
