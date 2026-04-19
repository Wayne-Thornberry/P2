import { ref } from 'vue'
import type { Ref } from 'vue'
import type { BudgetItem, BudgetRow } from '../types/budget'

interface RowReorderEvent {
  dragIndex: number
  dropIndex: number
  value: BudgetItem[]
}

const INTERACTIVE = 'input, button, a, .p-checkbox, .p-checkbox *, .p-select, .p-select *, .p-inputtext'

export function useBudgetDrag(
  items: Ref<BudgetItem[]>,
  tableItems: Ref<BudgetRow[]>,
  expandedRowGroups: Ref<string[]>,
  onReorder: (items: BudgetItem[]) => void,
) {
  const draggingItem = ref<BudgetItem | null>(null)
  const draggingCategoryName = ref<string | null>(null)
  const hoveredCategory = ref<string | null>(null)

  function onRowReorder(event: RowReorderEvent): void {
    const reordered = [...event.value]
    const moved = reordered[event.dropIndex]
    const above = event.dropIndex > 0 ? reordered[event.dropIndex - 1] : null
    const below = event.dropIndex < reordered.length - 1 ? reordered[event.dropIndex + 1] : null
    let inferredCategory: string
    if (above && below && above.category !== below.category) {
      inferredCategory = above.category === moved.category ? below.category : above.category
    } else {
      inferredCategory = above?.category ?? below?.category ?? moved.category
    }
    if (moved.category !== inferredCategory) {
      reordered[event.dropIndex] = { ...moved, category: inferredCategory }
      if (!expandedRowGroups.value.includes(inferredCategory)) {
        expandedRowGroups.value = [...expandedRowGroups.value, inferredCategory]
      }
    }
    onReorder(reordered)
    draggingItem.value = null
  }

  function onTableDragStart(e: DragEvent): void {
    const row = (e.target as HTMLElement).closest('tr[data-p-index]') as HTMLElement | null
    if (!row) return
    const idx = row.getAttribute('data-p-index')
    if (idx !== null) {
      draggingItem.value = tableItems.value[parseInt(idx)] ?? null
    }
  }

  function onCategoryDragStart(category: string): void {
    draggingCategoryName.value = category
  }

  function reorderCategories(draggedCat: string, targetCat: string): void {
    const categoryOrder = [...new Set(items.value.map(i => i.category))]
    const fromIdx = categoryOrder.indexOf(draggedCat)
    const toIdx = categoryOrder.indexOf(targetCat)
    if (fromIdx === toIdx) return
    const newOrder = [...categoryOrder]
    newOrder.splice(fromIdx, 1)
    newOrder.splice(toIdx, 0, draggedCat)
    const reordered: BudgetItem[] = []
    for (const cat of newOrder) {
      reordered.push(...items.value.filter(i => i.category === cat))
    }
    onReorder(reordered)
  }

  function onDropToCategory(targetCategory: string): void {
    hoveredCategory.value = null
    if (draggingCategoryName.value) {
      const draggedCat = draggingCategoryName.value
      draggingCategoryName.value = null
      if (draggedCat !== targetCategory) reorderCategories(draggedCat, targetCategory)
      return
    }
    const item = draggingItem.value
    draggingItem.value = null
    if (!item) return
    const without = items.value.filter(i => i.id !== item.id)
    const firstIdx = without.findIndex(i => i.category === targetCategory)
    const insertAt = firstIdx >= 0 ? firstIdx : without.length
    const updated = { ...item, category: targetCategory }
    onReorder([...without.slice(0, insertAt), updated, ...without.slice(insertAt)])
    if (!expandedRowGroups.value.includes(targetCategory)) {
      expandedRowGroups.value = [...expandedRowGroups.value, targetCategory]
    }
  }

  // PrimeVue's onRowMouseDown sets draggable=false on the <tr> unless the target
  // is a handle cell. Our wrapper div handler fires after (bubble order) and re-enables it.
  function onWrapperMouseDown(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return
    const tr = (e.target as HTMLElement).closest('tbody tr') as HTMLElement | null
    if (!tr) return
    if (tr.classList.contains('p-datatable-row-group-header')) return
    tr.draggable = true
  }

  function onWrapperMouseUp(e: MouseEvent): void {
    const tr = (e.target as HTMLElement).closest('tbody tr') as HTMLElement | null
    if (tr) tr.draggable = false
  }

  function clearDrag(): void {
    draggingItem.value = null
    draggingCategoryName.value = null
  }

  return {
    hoveredCategory,
    onRowReorder,
    onTableDragStart,
    onCategoryDragStart,
    onDropToCategory,
    onWrapperMouseDown,
    onWrapperMouseUp,
    clearDrag,
  }
}
