import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { BudgetItem, BudgetItemDef, BudgetMonthEntry } from '../types/budget'
import { generateBudgetItems } from '../data/budgetSeedData'
import { BUDGET_TEMPLATE } from '../data/budgetTemplate'
import { useMonthStore } from './monthStore'
import { useTemplateStore } from './templateStore'
import { useTransactionStore } from './transactionStore'
import { loadCountryScoped, useCountryScopedPersistence } from './useCountryScopedPersistence'
import { cloneDeep } from '../utils/math'

let _nextItemId = 2000

export const useBudgetStore = defineStore('budget', () => {
  const monthStore = useMonthStore()

  const _saved = loadCountryScoped('folio_budget', 'clearbook_budget')

  // ── Storage ───────────────────────────────────────────────────────────
  const globalItems    = ref<BudgetItemDef[]>([])
  const monthlyEntries = ref<Record<number, Record<number, BudgetMonthEntry[]>>>({})
  if (_saved?.nextId != null) _nextItemId = _saved.nextId

  // ── Initialize / Migrate ─────────────────────────────────────────────
  if (_saved?.monthlyItems && !_saved?.globalItems) {
    // v1 → v2 migration: category lives on old BudgetItem, move it to entries
    const defMap = new Map<number, BudgetItemDef>()
    const oldCatMap = new Map<number, string>() // id → category from v1 items
    const newEntries: Record<number, Record<number, BudgetMonthEntry[]>> = {}
    for (const [yearStr, yearData] of Object.entries(_saved.monthlyItems as Record<number, Record<number, BudgetItem[]>>)) {
      const year = parseInt(yearStr, 10)
      newEntries[year] = {}
      for (const [monthStr, monthItems] of Object.entries(yearData as Record<number, BudgetItem[]>)) {
        const month = parseInt(monthStr, 10)
        newEntries[year][month] = []
        for (const item of monthItems as BudgetItem[]) {
          defMap.set(item.id, { id: item.id, name: item.name })
          oldCatMap.set(item.id, item.category)
          newEntries[year][month].push({ itemId: item.id, assigned: item.assigned, category: item.category })
        }
      }
    }
    globalItems.value    = [...defMap.values()]
    monthlyEntries.value = newEntries
    // Also register old template items into globalItems
    const savedTpl = (() => { try { return JSON.parse(localStorage.getItem('folio_template') ?? localStorage.getItem('clearbook_template') ?? localStorage.getItem('p2_template') ?? 'null') } catch { return null } })()
    if (savedTpl?.items) {
      for (const item of savedTpl.items as BudgetItem[]) {
        if (!globalItems.value.some(i => i.name === item.name)) {
          globalItems.value.push({ id: item.id, name: item.name })
          if (item.id >= _nextItemId) _nextItemId = item.id + 1
        }
      }
    }
  } else if (_saved?.globalItems && _saved?.monthlyEntries) {
    // v2 load — migrate entries that are missing category (old v2 had category on globalItems)
    const savedDefs: Array<{ id: number; name: string; category?: string }> = _saved.globalItems
    const defCatMap = new Map<number, string>(savedDefs.map(i => [i.id, i.category ?? '']))
    globalItems.value    = savedDefs.map(i => ({ id: i.id, name: i.name }))
    const rawEntries = _saved.monthlyEntries as Record<number, Record<number, Array<{ itemId: number; assigned: number; category?: string }>>>
    const migratedEntries: Record<number, Record<number, BudgetMonthEntry[]>> = {}
    for (const [yearStr, yearData] of Object.entries(rawEntries)) {
      const year = parseInt(yearStr, 10)
      migratedEntries[year] = {}
      for (const [monthStr, monthArr] of Object.entries(yearData)) {
        const month = parseInt(monthStr, 10)
        migratedEntries[year][month] = monthArr.map(e => ({
          itemId:   e.itemId,
          assigned: e.assigned,
          category: e.category ?? defCatMap.get(e.itemId) ?? '',
        }))
      }
    }
    monthlyEntries.value = migratedEntries
  } else {
    // Fresh install: seed globalItems from BUDGET_TEMPLATE (name only, no category)
    globalItems.value = BUDGET_TEMPLATE.map(i => ({ id: i.id, name: i.name }))
    _nextItemId = Math.max(...globalItems.value.map(i => i.id)) + 1
  }

  useCountryScopedPersistence('folio_budget', {
    sources: [globalItems, monthlyEntries],
    toBlob: () => ({
      globalItems:    globalItems.value,
      monthlyEntries: monthlyEntries.value,
      nextId:         _nextItemId,
    }),
    reload: (saved) => {
      if (saved?.globalItems && saved?.monthlyEntries) {
        // v2 format — load directly
        const savedDefs: Array<{ id: number; name: string }> = saved.globalItems
        globalItems.value    = savedDefs.map(i => ({ id: i.id, name: i.name }))
        monthlyEntries.value = saved.monthlyEntries
        _nextItemId          = saved.nextId ?? 2000
      } else {
        // Fresh country — seed from template
        _nextItemId       = 2000
        globalItems.value = BUDGET_TEMPLATE.map(i => ({ id: i.id, name: i.name }))
        _nextItemId       = Math.max(...globalItems.value.map(i => i.id), _nextItemId - 1) + 1
        monthlyEntries.value = {}
        const now = new Date()
        _seedMonth(now.getFullYear(), now.getMonth() + 1)
      }
    },
  })

  // ── Internal helpers ──────────────────────────────────────────────────
  function _seedMonth(year: number, month: number): void {
    const yearMap = monthlyEntries.value[year] ??= {}
    if (yearMap[month] !== undefined) return
    const prevYear  = month === 1 ? year - 1 : year
    const prevMonth = month === 1 ? 12 : month - 1
    const source = monthlyEntries.value[prevYear]?.[prevMonth]
    yearMap[month] = source ? cloneDeep(source) : []
  }

  const _now = new Date()
  _seedMonth(_now.getFullYear(), _now.getMonth() + 1)

  function _activeEntries(): BudgetMonthEntry[] {
    const y = monthStore.activeYear
    const m = monthStore.activeMonth
    _seedMonth(y, m)
    return monthlyEntries.value[y]![m]!
  }

  function _defMap(): Map<number, BudgetItemDef> {
    return new Map(globalItems.value.map(i => [i.id, i]))
  }

  function _isInAnyMonth(id: number): boolean {
    for (const yearData of Object.values(monthlyEntries.value)) {
      for (const monthArr of Object.values(yearData)) {
        if ((monthArr as BudgetMonthEntry[]).some(e => e.itemId === id)) return true
      }
    }
    return false
  }

  // ── Public API ────────────────────────────────────────────────────────

  /** Find existing or create new global item definition by name. Returns id. */
  function getOrCreateGlobalItem(name: string): number {
    const existing = globalItems.value.find(i => i.name === name)
    if (existing) return existing.id
    const id = _nextItemId++
    globalItems.value.push({ id, name })
    return id
  }

  /**
   * After removing from a month or template, remove from globalItems + unassign
   * transactions if this item is no longer referenced anywhere.
   */
  function checkOrphan(id: number): void {
    if (_isInAnyMonth(id)) return
    const templateStore = useTemplateStore()
    if (templateStore.hasItem(id)) return
    globalItems.value = globalItems.value.filter(i => i.id !== id)
    useTransactionStore().unassignItem(id)
  }

  const items = computed<BudgetItem[]>(() => {
    const y = monthStore.activeYear
    const m = monthStore.activeMonth
    _seedMonth(y, m)
    const entries = monthlyEntries.value[y]![m]!
    const defs = _defMap()
    return entries
      .filter(e => defs.has(e.itemId))
      .map(e => {
        const def = defs.get(e.itemId)!
        return { id: e.itemId, name: def.name, category: e.category, assigned: e.assigned, activity: 0 }
      })
  })

  /** Global items not currently in the active month */
  const availableToAdd = computed<BudgetItemDef[]>(() => {
    const y = monthStore.activeYear
    const m = monthStore.activeMonth
    _seedMonth(y, m)
    const inMonth = new Set(monthlyEntries.value[y]![m]!.map(e => e.itemId))
    return globalItems.value.filter(i => !inMonth.has(i.id))
  })

  function updateItem(updated: BudgetItem): void {
    const def = globalItems.value.find(i => i.id === updated.id)
    if (def) def.name = updated.name  // name is global across all months
    const entry = _activeEntries().find(e => e.itemId === updated.id)
    if (entry) { entry.assigned = updated.assigned; entry.category = updated.category }
  }

  function reorderItems(newOrder: BudgetItem[]): void {
    const entries = _activeEntries()
    const entryMap = new Map(entries.map(e => [e.itemId, e]))
    const reordered = newOrder
      .map(i => {
        const e = entryMap.get(i.id)
        if (!e) return undefined
        // Drag into a different category updates the entry's category
        return e.category !== i.category ? { ...e, category: i.category } : e
      })
      .filter((e): e is BudgetMonthEntry => e !== undefined)
    entries.splice(0, entries.length, ...reordered)
  }

  function addItem(name: string, category: string): void {
    const id = getOrCreateGlobalItem(name)
    addExistingItem(id, category)
  }

  function addExistingItem(itemId: number, category: string): void {
    const entries = _activeEntries()
    if (entries.some(e => e.itemId === itemId)) return
    // Insert after the last entry in the same category so PrimeVue groups it correctly.
    // Consecutive same-category rows are required for rowGroupMode="subheader".
    const lastInCat = entries.reduce((lastIdx, e, i) => e.category === category ? i : lastIdx, -1)
    if (lastInCat >= 0) {
      entries.splice(lastInCat + 1, 0, { itemId, assigned: 0, category })
    } else {
      entries.push({ itemId, assigned: 0, category })
    }
  }

  /** Remove from active month only. Global items are never deleted implicitly. */
  function deleteItem(id: number): void {
    const entries = _activeEntries()
    const idx = entries.findIndex(e => e.itemId === id)
    if (idx !== -1) entries.splice(idx, 1)
  }

  /** Remove all items with the given category from the active month only. */
  function deleteCategory(category: string): void {
    const entries = _activeEntries()
    const remaining = entries.filter(e => e.category !== category)
    entries.splice(0, entries.length, ...remaining)
  }

  /** Nuclear: remove from every month + template + globalItems + unassign transactions. */
  function deleteItemGlobally(id: number): void {
    for (const yearData of Object.values(monthlyEntries.value)) {
      for (const monthArr of Object.values(yearData)) {
        const arr = monthArr as BudgetMonthEntry[]
        const idx = arr.findIndex(e => e.itemId === id)
        if (idx !== -1) arr.splice(idx, 1)
      }
    }
    useTemplateStore().removeItemDirect(id)
    globalItems.value = globalItems.value.filter(i => i.id !== id)
    useTransactionStore().unassignItem(id)
  }

  function loadSeedData(): void {
    const baseItems = generateBudgetItems()
    const existingIds = new Set(globalItems.value.map(i => i.id))
    for (const item of baseItems) {
      if (!existingIds.has(item.id)) {
        globalItems.value.push({ id: item.id, name: item.name })
        existingIds.add(item.id)
      }
    }
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const y = d.getFullYear()
      const m = d.getMonth() + 1
      monthlyEntries.value[y] ??= {}
      monthlyEntries.value[y]![m] = baseItems.map(item => ({ itemId: item.id, assigned: item.assigned, category: item.category }))
    }
  }

  function populateFromTemplate(): void {
    const templateStore = useTemplateStore()
    const y = monthStore.activeYear
    const m = monthStore.activeMonth
    monthlyEntries.value[y] ??= {}
    monthlyEntries.value[y]![m] = cloneDeep(templateStore.entries)
  }

  /**
   * Replace the entries for an arbitrary (year, month) with a deep copy of
   * the current template. Use for batch "generate budgets" actions.
   */
  function setMonthFromTemplate(year: number, month: number): void {
    const templateStore = useTemplateStore()
    monthlyEntries.value[year] ??= {}
    monthlyEntries.value[year]![month] = cloneDeep(templateStore.entries)
  }

  /**
   * Replace the entries for an arbitrary (year, month) with the supplied entries.
   * The caller owns the array; it is deep-copied before assignment.
   */
  function setMonthEntries(year: number, month: number, entries: BudgetMonthEntry[]): void {
    monthlyEntries.value[year] ??= {}
    monthlyEntries.value[year]![month] = cloneDeep(entries)
  }

  /**
   * Copy all budget entries from the specified source month into the active month.
   * Assigned amounts are zeroed out — only the item/category structure is copied.
   * The active month must be empty before calling this.
   */
  function populateFromMonth(sourceYear: number, sourceMonth: number): void {
    const source = monthlyEntries.value[sourceYear]?.[sourceMonth]
    if (!source) return
    const y = monthStore.activeYear
    const m = monthStore.activeMonth
    monthlyEntries.value[y] ??= {}
    monthlyEntries.value[y]![m] = cloneDeep(source)
  }

  /**
   * Roll unspent surplus from sourceYear/sourceMonth forward into targetYear/targetMonth.
   *
   * For each item whose (assigned - activity) > 0 in the source month, the surplus
   * is added to the item's assigned amount in the target month. Items that are
   * overspent or not present in the target month are skipped.
   *
   * @param activityMap  Pre-computed { itemId → actual spend } for the source month.
   *                     Caller provides this because the store has no direct access to
   *                     the transaction store from here without a circular dep.
   */
  function carryOverSurplus(
    sourceYear:  number,
    sourceMonth: number,
    targetYear:  number,
    targetMonth: number,
    activityMap: Map<number, number>,
  ): number {
    const source = monthlyEntries.value[sourceYear]?.[sourceMonth]
    if (!source) return 0
    _seedMonth(targetYear, targetMonth)
    const target = monthlyEntries.value[targetYear]![targetMonth]!
    let total = 0
    for (const se of source) {
      const activity = activityMap.get(se.itemId) ?? 0
      const surplus  = Math.round((se.assigned - activity) * 100) / 100
      if (surplus <= 0) continue
      const te = target.find(e => e.itemId === se.itemId)
      if (!te) continue  // item not in target month — skip
      te.assigned = Math.round((te.assigned + surplus) * 100) / 100
      total += surplus
    }
    return total
  }

  /** All year+month combinations that have at least one entry, sorted newest first. */
  const monthsWithData = computed<Array<{ year: number; month: number; label: string }>>(() => {
    const result: Array<{ year: number; month: number; label: string }> = []
    const ay = monthStore.activeYear
    const am = monthStore.activeMonth
    for (const [yearStr, yearData] of Object.entries(monthlyEntries.value)) {
      const year = parseInt(yearStr, 10)
      for (const [monthStr, entries] of Object.entries(yearData)) {
        const month = parseInt(monthStr, 10)
        if (year === ay && month === am) continue // exclude current month
        if ((entries as BudgetMonthEntry[]).length === 0) continue
        const label = new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
        result.push({ year, month, label })
      }
    }
    return result.sort((a, b) => b.year !== a.year ? b.year - a.year : b.month - a.month)
  })

  function $import(raw: unknown): void {
    const d = raw as Record<string, unknown>
    if (Array.isArray(d?.globalItems) && d?.monthlyEntries) {
      // v2 import: strip any legacy category off globalItems, move to entries
      const savedDefs: Array<{ id: number; name: string; category?: string }> = d.globalItems as Array<{ id: number; name: string; category?: string }>
      const defCatMap = new Map<number, string>(savedDefs.map(i => [i.id, i.category ?? '']))
      globalItems.value = savedDefs.map(i => ({ id: i.id, name: i.name }))
      const rawEntries = d.monthlyEntries as Record<number, Record<number, Array<{ itemId: number; assigned: number; category?: string }>>>
      const migratedEntries: Record<number, Record<number, BudgetMonthEntry[]>> = {}
      for (const [yearStr, yearData] of Object.entries(rawEntries)) {
        const year = parseInt(yearStr, 10)
        migratedEntries[year] = {}
        for (const [monthStr, monthArr] of Object.entries(yearData)) {
          const month = parseInt(monthStr, 10)
          migratedEntries[year][month] = monthArr.map(e => ({
            itemId:   e.itemId,
            assigned: e.assigned,
            category: e.category ?? defCatMap.get(e.itemId) ?? '',
          }))
        }
      }
      monthlyEntries.value = migratedEntries
      const maxId = savedDefs.reduce((max, i) => Math.max(max, i.id), 1999)
      _nextItemId = maxId + 1
    } else {
      const monthly = d as Record<number, Record<number, BudgetItem[]>>
      const defMap = new Map<number, BudgetItemDef>()
      const newEntries: Record<number, Record<number, BudgetMonthEntry[]>> = {}
      for (const [yearStr, yearData] of Object.entries(monthly)) {
        const year = parseInt(yearStr, 10)
        newEntries[year] = {}
        for (const [monthStr, monthItems] of Object.entries(yearData)) {
          const month = parseInt(monthStr, 10)
          for (const item of monthItems) defMap.set(item.id, { id: item.id, name: item.name })
          newEntries[year][month] = monthItems.map(item => ({ itemId: item.id, assigned: item.assigned, category: item.category }))
        }
      }
      globalItems.value    = [...defMap.values()]
      monthlyEntries.value = newEntries
      let maxId = 1999
      for (const def of globalItems.value) if (def.id > maxId) maxId = def.id
      _nextItemId = maxId + 1
    }
  }

  return {
    items,
    globalItems,
    monthlyEntries,
    availableToAdd,
    getOrCreateGlobalItem,
    checkOrphan,
    updateItem,
    reorderItems,
    addItem,
    addExistingItem,
    deleteItem,
    deleteCategory,
    deleteItemGlobally,
    loadSeedData,
    populateFromTemplate,
    populateFromMonth,
    setMonthFromTemplate,
    setMonthEntries,
    carryOverSurplus,
    monthsWithData,
    $import,
  }
})
