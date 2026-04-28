import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { loadCountryScoped, useCountryScopedPersistence } from './useCountryScopedPersistence'

// ── Types ──────────────────────────────────────────────────────
export interface PlannerItem {
  id:     number
  name:   string
  amount: number   // always a positive value; treated as a deduction from income
}

export interface SimulationItem {
  id:              number
  name:            string
  amount:          number
  kind:            'income' | 'expense'
  source:          'transaction' | 'planner' | 'custom'
  transactionId?:  number
  plannerItemId?:  number
}

export interface Simulation {
  id:    number
  name:  string
  month: string   // 'YYYY-MM'
  items: SimulationItem[]
}

let _nextId    = 1
let _nextSimId = 1
let _nextSimItemId = 1

// ── Store ──────────────────────────────────────────────────────
export const usePlannerStore = defineStore('planner', () => {
  const _saved = loadCountryScoped('folio_planner', 'clearbook_planner')

  const income              = ref<number>(_saved?.income ?? 0)
  const items               = ref<PlannerItem[]>(_saved?.items ?? [])
  const simulations         = ref<Simulation[]>(_saved?.simulations ?? [])
  const idealSimulationId   = ref<number | null>(_saved?.idealSimulationId ?? null)
  if (_saved?.nextId       != null) _nextId       = _saved.nextId
  if (_saved?.nextSimId    != null) _nextSimId    = _saved.nextSimId
  if (_saved?.nextSimItemId != null) _nextSimItemId = _saved.nextSimItemId

  useCountryScopedPersistence('folio_planner', {
    sources: [income, items, simulations, idealSimulationId],
    toBlob: () => ({
      income:            income.value,
      items:             items.value,
      simulations:       simulations.value,
      idealSimulationId: idealSimulationId.value,
      nextId:            _nextId,
      nextSimId:         _nextSimId,
      nextSimItemId:     _nextSimItemId,
    }),
    reload: (saved) => {
      _nextId                 = saved?.nextId            ?? 1
      _nextSimId              = saved?.nextSimId         ?? 1
      _nextSimItemId          = saved?.nextSimItemId     ?? 1
      income.value            = saved?.income            ?? 0
      items.value             = saved?.items             ?? []
      simulations.value       = saved?.simulations       ?? []
      idealSimulationId.value = saved?.idealSimulationId ?? null
    },
  })

  // ── Actions ────────────────────────────────────────────────
  function addItem(name: string, amount: number): PlannerItem {
    const item: PlannerItem = { id: _nextId++, name: name.trim(), amount }
    items.value.push(item)
    return item
  }

  function updateItem(id: number, patch: Partial<Pick<PlannerItem, 'name' | 'amount'>>): void {
    const item = items.value.find(i => i.id === id)
    if (!item) return
    if (patch.name   !== undefined) item.name   = patch.name.trim()
    if (patch.amount !== undefined) item.amount = patch.amount
  }

  function removeItem(id: number): void {
    items.value = items.value.filter(i => i.id !== id)
  }

  function moveItem(id: number, direction: 'up' | 'down'): void {
    const idx = items.value.findIndex(i => i.id === id)
    if (idx === -1) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= items.value.length) return
    const copy = [...items.value]
    ;[copy[idx], copy[swapIdx]] = [copy[swapIdx], copy[idx]]
    items.value = copy
  }

  function setIncome(value: number): void {
    income.value = value
  }

  // ── Commitment computed ────────────────────────────────────
  function runningBalances(): number[] {
    let balance = income.value
    return items.value.map(item => {
      balance -= item.amount
      return balance
    })
  }

  function totalCommitted(): number {
    return items.value.reduce((sum, i) => sum + i.amount, 0)
  }

  function remaining(): number {
    return income.value - totalCommitted()
  }

  // ── Simulation actions ─────────────────────────────────────
  function addSimulation(name: string, month: string): Simulation {
    const sim: Simulation = { id: _nextSimId++, name: name.trim(), month, items: [] }
    simulations.value.push(sim)
    return sim
  }

  function removeSimulation(id: number): void {
    simulations.value = simulations.value.filter(s => s.id !== id)
    if (idealSimulationId.value === id) idealSimulationId.value = null
  }

  function updateSimulation(id: number, patch: Partial<Pick<Simulation, 'name' | 'month'>>): void {
    const sim = simulations.value.find(s => s.id === id)
    if (!sim) return
    if (patch.name  !== undefined) sim.name  = patch.name.trim()
    if (patch.month !== undefined) sim.month = patch.month
  }

  function addSimulationItem(
    simId: number,
    name: string,
    amount: number,
    kind: SimulationItem['kind'],
    source: SimulationItem['source'],
    transactionId?: number,
    plannerItemId?: number,
  ): SimulationItem | null {
    const sim = simulations.value.find(s => s.id === simId)
    if (!sim) return null
    const item: SimulationItem = {
      id: _nextSimItemId++,
      name: name.trim(),
      amount,
      kind,
      source,
      transactionId,
      plannerItemId,
    }
    sim.items.push(item)
    return item
  }

  function updateSimulationItem(
    simId: number,
    itemId: number,
    patch: Partial<Pick<SimulationItem, 'name' | 'amount' | 'kind'>>,
  ): void {
    const sim = simulations.value.find(s => s.id === simId)
    if (!sim) return
    const item = sim.items.find(i => i.id === itemId)
    if (!item) return
    if (patch.name   !== undefined) item.name   = patch.name.trim()
    if (patch.amount !== undefined) item.amount = patch.amount
    if (patch.kind   !== undefined) item.kind   = patch.kind
  }

  function removeSimulationItem(simId: number, itemId: number): void {
    const sim = simulations.value.find(s => s.id === simId)
    if (!sim) return
    sim.items = sim.items.filter(i => i.id !== itemId)
  }

  function moveSimulationItem(simId: number, itemId: number, direction: 'up' | 'down'): void {
    const sim = simulations.value.find(s => s.id === simId)
    if (!sim) return
    const idx = sim.items.findIndex(i => i.id === itemId)
    if (idx === -1) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= sim.items.length) return
    const copy = [...sim.items]
    ;[copy[idx], copy[swapIdx]] = [copy[swapIdx], copy[idx]]
    sim.items = copy
  }

  // ── Simulation computed helpers ────────────────────────────
  function simRunningBalances(simId: number): number[] {
    const sim = simulations.value.find(s => s.id === simId)
    if (!sim) return []
    let balance = 0
    return sim.items.map(item => {
      if (item.kind === 'income') balance += item.amount
      else balance -= item.amount
      return balance
    })
  }

  function simSummary(simId: number): { totalIncome: number; totalExpenses: number; remaining: number } {
    const sim = simulations.value.find(s => s.id === simId)
    if (!sim) return { totalIncome: 0, totalExpenses: 0, remaining: 0 }
    const totalIncome   = sim.items.filter(i => i.kind === 'income').reduce((s, i) => s + i.amount, 0)
    const totalExpenses = sim.items.filter(i => i.kind === 'expense').reduce((s, i) => s + i.amount, 0)
    return { totalIncome, totalExpenses, remaining: totalIncome - totalExpenses }
  }

  function setIdealSimulation(id: number | null): void {
    idealSimulationId.value = id
  }

  const idealSimulation = computed<Simulation | null>(
    () => simulations.value.find(s => s.id === idealSimulationId.value) ?? null
  )

  return {
    income,
    items,
    simulations,
    idealSimulationId,
    idealSimulation,
    setIncome,
    addItem,
    updateItem,
    removeItem,
    moveItem,
    runningBalances,
    totalCommitted,
    remaining,
    addSimulation,
    removeSimulation,
    updateSimulation,
    addSimulationItem,
    updateSimulationItem,
    removeSimulationItem,
    moveSimulationItem,
    simRunningBalances,
    simSummary,
    setIdealSimulation,
  }
})
