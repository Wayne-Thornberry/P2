import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useTransactionStore } from './transactionStore'
import { useSettingsStore } from './settingsStore'
import { useAccountStore } from './accountStore'
import { roundCents, txNet } from '../utils/math'
import { storageKey, loadStored } from '../utils/storeStorage'

export interface SavingsGoal {
  id:               number
  name:             string
  targetAmount:     number
  deadline?:        string          // YYYY-MM-DD
  color:            string          // css hex or named
  linkedAccountId?: string          // auto-track from account transactions
  contributions:    SavingsContribution[]
  createdAt:        string          // ISO
  archived:         boolean
}

export interface SavingsContribution {
  id:     number
  date:   string    // YYYY-MM-DD
  amount: number
  note?:  string
}

let _nextGoalId = 1
let _nextContribId = 1

const COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#14b8a6', '#f97316', '#ec4899',
]

export const useSavingsGoalStore = defineStore('savingsGoals', () => {
  const settings = useSettingsStore()

  function _key(): string { return storageKey('clearbook_savings_goals', settings.country) }
  function _load() { return loadStored('clearbook_savings_goals', settings.country) }

  const _saved = _load()

  const goals = ref<SavingsGoal[]>(_saved?.goals ?? [])
  if (_saved?.nextGoalId   != null) _nextGoalId    = _saved.nextGoalId
  if (_saved?.nextContribId != null) _nextContribId = _saved.nextContribId

  watch(goals, () => {
    localStorage.setItem(_key(), JSON.stringify({
      goals: goals.value, nextGoalId: _nextGoalId, nextContribId: _nextContribId,
    }))
  }, { deep: true })

  // Reload when country changes
  watch(() => settings.country, (newCountry) => {
    if (!newCountry) return
    const saved = _load()
    _nextGoalId    = saved?.nextGoalId    ?? 1
    _nextContribId = saved?.nextContribId ?? 1
    goals.value    = saved?.goals         ?? []
  })

  function addGoal(name: string, targetAmount: number, deadline?: string, linkedAccountId?: string): SavingsGoal {
    // Savings goals cannot be linked to liability accounts (loans/credit cards)
    const accStore = useAccountStore()
    const resolvedAccountId = linkedAccountId && accStore.accounts.find(a => a.id === linkedAccountId)?.type !== 'liability'
      ? linkedAccountId
      : undefined
    const color = COLORS[_nextGoalId % COLORS.length]
    const goal: SavingsGoal = {
      id: _nextGoalId++, name: name.trim(), targetAmount,
      deadline: deadline || undefined, color,
      linkedAccountId: resolvedAccountId,
      contributions: [], createdAt: new Date().toISOString(), archived: false,
    }
    goals.value.push(goal)
    return goal
  }

  function updateGoal(id: number, patch: Partial<Pick<SavingsGoal, 'name' | 'targetAmount' | 'deadline' | 'color' | 'archived' | 'linkedAccountId'>>): void {
    const g = goals.value.find(g => g.id === id)
    if (!g) return
    if (patch.name            !== undefined) g.name            = patch.name.trim()
    if (patch.targetAmount    !== undefined) g.targetAmount     = patch.targetAmount
    if (patch.deadline        !== undefined) g.deadline         = patch.deadline || undefined
    if (patch.color           !== undefined) g.color            = patch.color
    if (patch.archived        !== undefined) g.archived         = patch.archived
    if ('linkedAccountId' in patch) {
      const accStore = useAccountStore()
      const isLiability = patch.linkedAccountId
        ? accStore.accounts.find(a => a.id === patch.linkedAccountId)?.type === 'liability'
        : false
      g.linkedAccountId = isLiability ? undefined : (patch.linkedAccountId || undefined)
    }
  }

  function deleteGoal(id: number): void {
    const idx = goals.value.findIndex(g => g.id === id)
    if (idx !== -1) goals.value.splice(idx, 1)
  }

  function addContribution(goalId: number, amount: number, date: string, note?: string): void {
    const g = goals.value.find(g => g.id === goalId)
    if (!g) return
    g.contributions.push({ id: _nextContribId++, date, amount, note: note?.trim() || undefined })
    g.contributions.sort((a, b) => b.date.localeCompare(a.date))
  }

  function deleteContribution(goalId: number, contribId: number): void {
    const g = goals.value.find(g => g.id === goalId)
    if (!g) return
    const idx = g.contributions.findIndex(c => c.id === contribId)
    if (idx !== -1) g.contributions.splice(idx, 1)
  }

  function totalSaved(goal: SavingsGoal): number {
    if (goal.linkedAccountId) {
      const txStore = useTransactionStore()
      const net = txStore.transactions
        .filter(t => t.accountId === goal.linkedAccountId)
        .reduce((sum, transaction) => sum + txNet(transaction), 0)
      return roundCents(net)
    }
    return roundCents(goal.contributions.reduce((sum, contribution) => sum + contribution.amount, 0))
  }

  function progressPct(goal: SavingsGoal): number {
    if (goal.targetAmount <= 0) return 0
    return Math.min(100, Math.round((totalSaved(goal) / goal.targetAmount) * 100))
  }

  return { goals, addGoal, updateGoal, deleteGoal, addContribution, deleteContribution, totalSaved, progressPct }
})
