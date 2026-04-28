import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { BudgetItem, BudgetItemDef, TemplateEntry } from '../types/budget'
import { BUDGET_TEMPLATE } from '../data/budgetTemplate'
import { useBudgetStore } from './budgetStore'
import { loadCountryScoped, useCountryScopedPersistence } from './useCountryScopedPersistence'
import { cloneDeep } from '../utils/math'

export const useTemplateStore = defineStore('template', () => {
  const budgetStore = useBudgetStore()

  const _saved = loadCountryScoped('clearbook_template', 'p2_template')

  // ── Initialize / Migrate ─────────────────────────────────────────────
  let _initEntries: TemplateEntry[]
  if (_saved?.entries) {
    // v2 format — migrate if entries are missing category (old v2 had category on globalItems)
    const rawEntries: Array<{ itemId: number; assigned: number; category?: string }> = _saved.entries
    const defCatMap = new Map<number, string>(
      (budgetStore.globalItems as Array<BudgetItemDef & { category?: string }>).map(i => [i.id, i.category ?? ''])
    )
    _initEntries = rawEntries.map(e => ({
      itemId:   e.itemId,
      assigned: e.assigned,
      category: e.category ?? defCatMap.get(e.itemId) ?? '',
    }))
  } else if (_saved?.items) {
    // v1 migration: old BudgetItem[] — category comes from item
    _initEntries = []
    for (const item of _saved.items as BudgetItem[]) {
      const globalId = budgetStore.getOrCreateGlobalItem(item.name)
      _initEntries.push({ itemId: globalId, assigned: item.assigned, category: item.category })
    }
  } else {
    // Fresh install: seed from BUDGET_TEMPLATE
    _initEntries = []
    for (const item of BUDGET_TEMPLATE) {
      const globalId = budgetStore.getOrCreateGlobalItem(item.name)
      _initEntries.push({ itemId: globalId, assigned: item.assigned, category: item.category })
    }
  }

  const entries = ref<TemplateEntry[]>(_initEntries)

  useCountryScopedPersistence('clearbook_template', {
    sources: entries,
    toBlob: () => ({ entries: entries.value }),
    reload: (saved) => {
      if (saved?.entries) {
        // v2 format — itemIds reference budgetStore globalItems
        entries.value = saved.entries
      } else {
        // Fresh country — seed from BUDGET_TEMPLATE using fixed IDs
        entries.value = BUDGET_TEMPLATE.map(item => ({
          itemId:   item.id,
          assigned: item.assigned,
          category: item.category,
        }))
      }
    },
  })

  // ── Computed ──────────────────────────────────────────────────────────
  const items = computed<BudgetItem[]>(() => {
    const defs = new Map<number, BudgetItemDef>(budgetStore.globalItems.map(i => [i.id, i]))
    return entries.value
      .filter(e => defs.has(e.itemId))
      .map(e => {
        const def = defs.get(e.itemId)!
        return { id: e.itemId, name: def.name, category: e.category, assigned: e.assigned, activity: 0 }
      })
  })

  const categories = computed<string[]>(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const item of items.value) {
      if (!seen.has(item.category)) { seen.add(item.category); result.push(item.category) }
    }
    return result
  })

  function itemsInCategory(cat: string): BudgetItem[] {
    return items.value.filter(i => i.category === cat)
  }

  function hasItem(id: number): boolean {
    return entries.value.some(e => e.itemId === id)
  }

  // ── Mutations ─────────────────────────────────────────────────────────
  function addItem(name: string, category: string, assigned = 0): void {
    const globalId = budgetStore.getOrCreateGlobalItem(name)
    if (entries.value.some(e => e.itemId === globalId)) return
    entries.value.push({ itemId: globalId, assigned, category })
  }

  function addExistingItem(itemId: number, category: string, assigned = 0): void {
    if (entries.value.some(e => e.itemId === itemId)) return
    entries.value.push({ itemId, assigned, category })
  }

  function updateItem(updated: BudgetItem): void {
    // Item name is global; category and assigned are per-template
    const def = budgetStore.globalItems.find(i => i.id === updated.id)
    if (def) def.name = updated.name
    const entry = entries.value.find(e => e.itemId === updated.id)
    if (entry) { entry.assigned = updated.assigned; entry.category = updated.category }
  }

  /** Remove from template only. Global items are never deleted implicitly. */
  function removeItem(id: number): void {
    entries.value = entries.value.filter(e => e.itemId !== id)
  }

  /** Remove from template only — no orphan check (called by deleteItemGlobally). */
  function removeItemDirect(id: number): void {
    entries.value = entries.value.filter(e => e.itemId !== id)
  }

  function addCategory(name: string): void {
    if (!name.trim() || categories.value.includes(name.trim())) return
    addItem('New Item', name.trim(), 0)
  }

  function removeCategory(cat: string): void {
    const ids = items.value.filter(i => i.category === cat).map(i => i.id)
    for (const id of ids) removeItem(id)
  }

  function renameCategory(oldName: string, newName: string): void {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === oldName) return
    // Category is per-template — rename in template entries only
    for (const entry of entries.value) {
      if (entry.category === oldName) entry.category = trimmed
    }
  }

  function getCopy(): BudgetItem[] {
    return cloneDeep(items.value) as BudgetItem[]
  }

  function resetToDefault(): void {
    entries.value = []
    for (const item of BUDGET_TEMPLATE) {
      const globalId = budgetStore.getOrCreateGlobalItem(item.name)
      entries.value.push({ itemId: globalId, assigned: item.assigned, category: item.category })
    }
  }

  function $import(data: BudgetItem[]): void {
    entries.value = []
    for (const item of data) {
      const globalId = budgetStore.getOrCreateGlobalItem(item.name)
      entries.value.push({ itemId: globalId, assigned: item.assigned, category: item.category })
    }
  }

  // ── Template share: export / import ───────────────────────────────────

  /** Returns a portable JSON string suitable for sharing. No internal IDs. */
  function exportTemplate(): string {
    const rows = items.value.map(i => ({ name: i.name, category: i.category, assigned: i.assigned }))
    return JSON.stringify({ clearbook_template: true, version: 1, items: rows }, null, 2)
  }

  /**
   * Parse and apply a template JSON string produced by exportTemplate().
   * Returns an error message string on failure, or null on success.
   */
  function importTemplateFile(json: string): string | null {
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch {
      return 'Invalid file — could not parse JSON.'
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !(parsed as Record<string, unknown>).clearbook_template
    ) {
      return 'This does not look like a Clearbook template file.'
    }
    const raw = parsed as { version: number; items: unknown }
    if (!Array.isArray(raw.items) || raw.items.length === 0) {
      return 'Template file contains no items.'
    }
    const asItems: BudgetItem[] = (raw.items as Array<Record<string, unknown>>).map((r, idx) => {
      if (typeof r.name !== 'string' || !r.name.trim()) throw new Error(`Item ${idx + 1} has no name.`)
      return {
        id:       0,
        name:     String(r.name).trim(),
        category: typeof r.category === 'string' ? r.category.trim() : 'Imported',
        assigned: typeof r.assigned === 'number' ? r.assigned : 0,
        activity: 0,
      }
    })
    $import(asItems)
    return null
  }

  return {
    entries,
    items,
    categories,
    itemsInCategory,
    hasItem,
    addItem,
    addExistingItem,
    updateItem,
    removeItem,
    removeItemDirect,
    addCategory,
    removeCategory,
    renameCategory,
    getCopy,
    resetToDefault,
    $import,
    exportTemplate,
    importTemplateFile,
  }
})
