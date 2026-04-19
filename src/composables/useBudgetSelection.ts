import { ref, computed } from 'vue'
import type { Ref } from 'vue'
import type { BudgetItem } from '../types/budget'

export function useBudgetSelection(items: Ref<BudgetItem[]>) {
  const selectedItems = ref<BudgetItem[]>([])

  function itemsInCategory(category: string): BudgetItem[] {
    return items.value.filter(i => i.category === category)
  }

  function isSelected(item: BudgetItem): boolean {
    return selectedItems.value.some(s => s.id === item.id)
  }

  function toggleItem(item: BudgetItem): void {
    if (isSelected(item)) {
      selectedItems.value = selectedItems.value.filter(s => s.id !== item.id)
    } else {
      selectedItems.value = [...selectedItems.value, item]
    }
  }

  const isAllSelected = computed(() =>
    items.value.length > 0 && items.value.every(i => isSelected(i))
  )

  const isSomeSelected = computed((): boolean => {
    const n = items.value.filter(i => isSelected(i)).length
    return n > 0 && n < items.value.length
  })

  function toggleAll(): void {
    if (isAllSelected.value) {
      selectedItems.value = []
    } else {
      selectedItems.value = [...items.value]
    }
  }

  function isCategoryAllSelected(category: string): boolean {
    const cats = itemsInCategory(category)
    return cats.length > 0 && cats.every(i => isSelected(i))
  }

  function isCategoryIndeterminate(category: string): boolean {
    const cats = itemsInCategory(category)
    const n = cats.filter(i => isSelected(i)).length
    return n > 0 && n < cats.length
  }

  function toggleCategorySelection(category: string): void {
    const cats = itemsInCategory(category)
    if (isCategoryAllSelected(category)) {
      selectedItems.value = selectedItems.value.filter(s => !cats.some(c => c.id === s.id))
    } else {
      const toAdd = cats.filter(c => !isSelected(c))
      selectedItems.value = [...selectedItems.value, ...toAdd]
    }
  }

  function getRowClass(data: BudgetItem): string {
    return isSelected(data) ? 'budget-row-selected' : ''
  }

  return {
    selectedItems,
    itemsInCategory,
    isSelected,
    toggleItem,
    isAllSelected,
    isSomeSelected,
    toggleAll,
    isCategoryAllSelected,
    isCategoryIndeterminate,
    toggleCategorySelection,
    getRowClass,
  }
}
