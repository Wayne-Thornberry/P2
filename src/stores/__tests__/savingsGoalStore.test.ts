import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSavingsGoalStore } from '../savingsGoalStore'
import { useSettingsStore } from '../settingsStore'

function freshPinia() {
  localStorage.clear()
  const pinia = createPinia()
  setActivePinia(pinia)
  return pinia
}

describe('savingsGoalStore — addGoal', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('adds a goal', () => {
    const store = useSavingsGoalStore()
    store.addGoal('Holiday', 2000)
    expect(store.goals).toHaveLength(1)
    expect(store.goals[0].name).toBe('Holiday')
    expect(store.goals[0].targetAmount).toBe(2000)
    expect(store.goals[0].archived).toBe(false)
    expect(store.goals[0].contributions).toEqual([])
  })

  it('assigns incrementing unique ids', () => {
    const store = useSavingsGoalStore()
    store.addGoal('A', 100)
    store.addGoal('B', 200)
    expect(store.goals[0].id).not.toBe(store.goals[1].id)
  })

  it('trims goal name whitespace', () => {
    const store = useSavingsGoalStore()
    store.addGoal('  Holiday  ', 1000)
    expect(store.goals[0].name).toBe('Holiday')
  })

  it('sets linkedAccountId when provided', () => {
    const store = useSavingsGoalStore()
    store.addGoal('Car', 5000, undefined, 'acc-1')
    expect(store.goals[0].linkedAccountId).toBe('acc-1')
  })
})

describe('savingsGoalStore — updateGoal', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('updates goal name', () => {
    const store = useSavingsGoalStore()
    store.addGoal('Old', 1000)
    store.updateGoal(store.goals[0].id, { name: 'New' })
    expect(store.goals[0].name).toBe('New')
  })

  it('archives a goal via updateGoal', () => {
    const store = useSavingsGoalStore()
    store.addGoal('Car', 5000)
    const id = store.goals[0].id
    store.updateGoal(id, { archived: true })
    expect(store.goals[0].archived).toBe(true)
  })

  it('unarchives a goal via updateGoal', () => {
    const store = useSavingsGoalStore()
    store.addGoal('Car', 5000)
    const id = store.goals[0].id
    store.updateGoal(id, { archived: true })
    store.updateGoal(id, { archived: false })
    expect(store.goals[0].archived).toBe(false)
  })

  it('is a no-op for unknown id', () => {
    const store = useSavingsGoalStore()
    store.addGoal('A', 100)
    store.updateGoal(9999, { name: 'X' })
    expect(store.goals[0].name).toBe('A')
  })
})

describe('savingsGoalStore — deleteGoal', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('removes a goal by id', () => {
    const store = useSavingsGoalStore()
    store.addGoal('Holiday', 2000)
    const id = store.goals[0].id
    store.deleteGoal(id)
    expect(store.goals).toHaveLength(0)
  })
})

describe('savingsGoalStore — addContribution', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('adds a contribution to the correct goal', () => {
    const store = useSavingsGoalStore()
    store.addGoal('Holiday', 2000)
    const goalId = store.goals[0].id
    store.addContribution(goalId, 500, '2026-01-01', 'First save')
    expect(store.goals[0].contributions).toHaveLength(1)
    expect(store.goals[0].contributions[0].amount).toBe(500)
    expect(store.goals[0].contributions[0].note).toBe('First save')
  })

  it('is a no-op for unknown goal id', () => {
    const store = useSavingsGoalStore()
    store.addGoal('Holiday', 2000)
    store.addContribution(9999, 100, '2026-01-01')
    expect(store.goals[0].contributions).toHaveLength(0)
  })
})

describe('savingsGoalStore — deleteContribution', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('removes a contribution by id', () => {
    const store = useSavingsGoalStore()
    store.addGoal('Car', 5000)
    const goalId = store.goals[0].id
    store.addContribution(goalId, 200, '2026-01-01')
    const contribId = store.goals[0].contributions[0].id
    store.deleteContribution(goalId, contribId)
    expect(store.goals[0].contributions).toHaveLength(0)
  })
})

describe('savingsGoalStore — totalSaved', () => {
  beforeEach(() => { freshPinia(); useSettingsStore().country = 'IE' })

  it('sums contributions for non-linked goal', () => {
    const store = useSavingsGoalStore()
    store.addGoal('Holiday', 2000)
    const goalId = store.goals[0].id
    store.addContribution(goalId, 300, '2026-01-01')
    store.addContribution(goalId, 700, '2026-02-01')
    expect(store.totalSaved(store.goals[0])).toBe(1000)
  })

  it('progressPct stays at 100 when over target', () => {
    const store = useSavingsGoalStore()
    store.addGoal('Small', 100)
    const goalId = store.goals[0].id
    store.addContribution(goalId, 200, '2026-01-01')
    expect(store.progressPct(store.goals[0])).toBe(100)
  })

  it('progressPct is 0 for zero target', () => {
    const store = useSavingsGoalStore()
    store.addGoal('Zero', 0)
    expect(store.progressPct(store.goals[0])).toBe(0)
  })
})

