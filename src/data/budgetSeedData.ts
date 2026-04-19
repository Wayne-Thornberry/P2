import type { BudgetItem } from '../types/budget'

export function generateBudgetItems(): BudgetItem[] {
  return [
    // ── Income ──────────────────────────────────────────────────
    { id: 1,   category: 'Income',        name: 'Primary Salary',        assigned: 5500, activity: 0 },
    { id: 2,   category: 'Income',        name: 'Freelance Work',         assigned: 600,  activity: 0 },
    { id: 3,   category: 'Income',        name: 'Dividends',              assigned: 250,  activity: 0 },
    { id: 4,   category: 'Income',        name: 'Interest Income',        assigned: 45,   activity: 0 },

    // ── Housing ──────────────────────────────────────────────────
    { id: 101, category: 'Housing',       name: 'Rent / Mortgage',        assigned: 1800, activity: 0 },
    { id: 102, category: 'Housing',       name: 'Utilities',              assigned: 220,  activity: 0 },
    { id: 103, category: 'Housing',       name: 'Home Insurance',         assigned: 120,  activity: 0 },
    { id: 104, category: 'Housing',       name: 'Internet & Phone',       assigned: 95,   activity: 0 },

    // ── Food ────────────────────────────────────────────────────
    { id: 201, category: 'Food',          name: 'Groceries',              assigned: 600,  activity: 0 },
    { id: 202, category: 'Food',          name: 'Dining Out',             assigned: 200,  activity: 0 },
    { id: 203, category: 'Food',          name: 'Coffee & Snacks',        assigned: 60,   activity: 0 },

    // ── Transport ───────────────────────────────────────────────
    { id: 301, category: 'Transport',     name: 'Car Payment',            assigned: 450,  activity: 0 },
    { id: 302, category: 'Transport',     name: 'Fuel',                   assigned: 150,  activity: 0 },
    { id: 303, category: 'Transport',     name: 'Public Transit',         assigned: 80,   activity: 0 },

    // ── Entertainment ────────────────────────────────────────────
    { id: 401, category: 'Entertainment', name: 'Streaming Services',     assigned: 45,   activity: 0 },
    { id: 402, category: 'Entertainment', name: 'Gaming',                 assigned: 60,   activity: 0 },
    { id: 403, category: 'Entertainment', name: 'Events & Outings',       assigned: 150,  activity: 0 },

    // ── Healthcare ───────────────────────────────────────────────
    { id: 501, category: 'Healthcare',    name: 'Health Insurance',       assigned: 280,  activity: 0 },
    { id: 502, category: 'Healthcare',    name: 'Pharmacy / Medical',     assigned: 80,   activity: 0 },

    // ── Savings ──────────────────────────────────────────────────
    { id: 601, category: 'Savings',       name: 'Emergency Fund',         assigned: 500,  activity: 0 },
    { id: 602, category: 'Savings',       name: 'Retirement (401k)',      assigned: 600,  activity: 0 },
    { id: 603, category: 'Savings',       name: 'Investment Contributions', assigned: 400, activity: 0 },
  ]
}

