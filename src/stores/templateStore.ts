import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { BudgetItem, BudgetItemDef, TemplateEntry } from '../types/budget'
import { BUDGET_TEMPLATE } from '../data/budgetTemplate'
import { useBudgetStore } from './budgetStore'
import { useSettingsStore } from './settingsStore'

export const useTemplateStore = defineStore('template', () => {
  const budgetStore = useBudgetStore()
  const settings    = useSettingsStore()

  function _key(): string {
    return settings.country ? `clearbook_template_${settings.country}` : 'clearbook_template'
  }

  function _loadTemplate() {
    try {
      const key = _key()
      let raw = localStorage.getItem(key)
      // One-time migration from bare key for existing installs
      if (raw === null && settings.country) {
        raw = localStorage.getItem('clearbook_template')
        if (raw !== null) {
          localStorage.setItem(key, raw)
          localStorage.removeItem('clearbook_template')
        }
      }
      if (raw === null) {
        raw = localStorage.getItem('p2_template')
        if (raw !== null) localStorage.removeItem('p2_template')
      }
      return JSON.parse(raw ?? 'null')
    } catch { return null }
  }

  const _saved = _loadTemplate()

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

  watch(entries, (val) => {
    localStorage.setItem(_key(), JSON.stringify({ entries: val }))
  }, { deep: true })

  // Reload when country changes
  watch(() => settings.country, (newCountry) => {
    if (!newCountry) return
    const saved = _loadTemplate()
    if (saved?.entries) {
      // Load saved entries directly (v2 format — itemIds reference budgetStore globalItems)
      entries.value = saved.entries
    } else {
      // Fresh country — seed from BUDGET_TEMPLATE using fixed IDs (matches budgetStore fresh seed)
      entries.value = BUDGET_TEMPLATE.map(item => ({
        itemId:   item.id,
        assigned: item.assigned,
        category: item.category,
      }))
    }
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

  /** Remove from template, then let budgetStore check if globally orphaned. */
  function removeItem(id: number): void {
    entries.value = entries.value.filter(e => e.itemId !== id)
    budgetStore.checkOrphan(id)
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
    return JSON.parse(JSON.stringify(items.value)) as BudgetItem[]
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
  }
})
