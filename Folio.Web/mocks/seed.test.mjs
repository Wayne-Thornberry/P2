// The mock is what a local run serves the site, so its example budget has to be as sound
// as the real thing: an id that points at nothing shows up as a blank category in the
// budget page, and a counter below the highest id produces a duplicate on the next insert.
//
// These are plain .mjs so they need no build step and are not type-checked: the mock is
// run by node, exactly as the dev server runs it.

import { describe, expect, it } from 'vitest'
import { seedSettings, seedWorkspace } from './seed.mjs'

const settings = seedSettings()
const workspace = seedWorkspace(settings.country)

const accounts = workspace.folio_accounts.accounts
const transactions = workspace.folio_transactions.transactions
const budget = workspace.folio_budget
const budgetItems = budget.globalItems
const goals = workspace.folio_savings_goals.goals
const planner = workspace.folio_planner

const accountIds = new Set(accounts.map((account) => account.id))
const itemIds = new Set(budgetItems.map((item) => item.id))

/** Every id in a list is unique. */
function expectUniqueIds(rows) {
  const ids = rows.map((row) => row.id)
  expect(new Set(ids).size).toBe(ids.length)
}

describe('the mock seed', () => {
  it('opens on a country, so the setup screen does not appear', () => {
    expect(settings.country).toBe('ireland')
    expect(settings.currency).toBe('EUR')
  })

  it('answers for the country the settings name, and nowhere else', () => {
    expect(Object.keys(workspace)).toContain('folio_transactions')
    expect(seedWorkspace('sweden')).toEqual({})
  })

  it('has every collection the site expects', () => {
    expect(Object.keys(workspace).sort()).toEqual([
      'folio_accounts',
      'folio_budget',
      'folio_finance',
      'folio_import_history',
      'folio_planner',
      'folio_savings_goals',
      'folio_template',
      'folio_transactions',
      'folio_upcoming',
    ])
  })

  it('gives every transaction a real account and budget item', () => {
    for (const transaction of transactions) {
      if (transaction.accountId !== undefined) expect(accountIds).toContain(transaction.accountId)
      if (transaction.itemId !== undefined) expect(itemIds).toContain(transaction.itemId)
    }
  })

  it('keeps every id unique and every counter ahead of it', () => {
    expectUniqueIds(accounts)
    expectUniqueIds(transactions)
    expectUniqueIds(goals)
    expectUniqueIds(workspace.folio_upcoming.items)

    // Account ids are strings ("acc-4") and the rest are numbers, so the digits are what
    // the counter has to be ahead of.
    const highest = (rows) =>
      rows.reduce((max, row) => Math.max(max, Number(String(row.id).replace(/\D/g, '')) || 0), 0)

    expect(workspace.folio_accounts.nextId).toBeGreaterThan(highest(accounts))
    expect(workspace.folio_transactions.nextId).toBeGreaterThan(highest(transactions))
    expect(workspace.folio_savings_goals.nextGoalId).toBeGreaterThan(highest(goals))
    expect(workspace.folio_upcoming.nextId).toBeGreaterThan(highest(workspace.folio_upcoming.items))
    expect(planner.nextSimId).toBeGreaterThan(highest(planner.simulations))
  })

  it('assigns money to items that exist, in three months', () => {
    const years = Object.keys(budget.monthlyEntries)
    expect(years).toHaveLength(1)

    const months = Object.values(budget.monthlyEntries[years[0]])
    expect(Object.keys(months)).toHaveLength(3)

    for (const entries of months) {
      for (const entry of entries) {
        expect(itemIds).toContain(entry.itemId)
      }
    }
  })

  it('gives each goal contributions with their own ids', () => {
    const contributions = goals.flatMap((goal) => goal.contributions)

    expectUniqueIds(contributions)
    expect(workspace.folio_savings_goals.nextContribId).toBeGreaterThan(
      contributions.reduce((max, row) => Math.max(max, row.id), 0),
    )
  })

  it('points every planner scenario line at something it names', () => {
    const plannerItemIds = new Set(planner.items.map((item) => item.id))

    for (const simulation of planner.simulations) {
      for (const line of simulation.items) {
        expect(['income', 'expense']).toContain(line.kind)
        expect(['transaction', 'planner', 'custom']).toContain(line.source)

        if (line.plannerItemId !== undefined) expect(plannerItemIds).toContain(line.plannerItemId)
      }
    }
  })

  it('only links goals and finance records to accounts that exist', () => {
    for (const goal of goals) {
      if (goal.linkedAccountId) expect(accountIds).toContain(goal.linkedAccountId)
    }

    const { loans, savings } = workspace.folio_finance
    for (const record of [...loans, ...savings]) {
      if (record.linkedAccountId) expect(accountIds).toContain(record.linkedAccountId)
    }
  })
})
