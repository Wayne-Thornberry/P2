import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export interface ImportRecord {
  id: number
  date: string        // ISO datetime
  bankName: string    // from adapter.name
  adapterId: string   // from adapter.id
  fileName: string    // original file name if available
  rowCount: number    // transactions actually imported
}

let _nextId = 1

export const useImportHistoryStore = defineStore('importHistory', () => {
  const _saved = (() => {
    try { return JSON.parse(localStorage.getItem('clearbook_import_history') ?? 'null') } catch { return null }
  })()

  const imports = ref<ImportRecord[]>(_saved?.imports ?? [])
  if (_saved?.nextId != null) _nextId = _saved.nextId

  watch(imports, (val) => {
    localStorage.setItem('clearbook_import_history', JSON.stringify({ imports: val, nextId: _nextId }))
  }, { deep: true })

  function addRecord(r: Omit<ImportRecord, 'id' | 'date'>): void {
    imports.value.unshift({
      ...r,
      id:   _nextId++,
      date: new Date().toISOString(),
    })
  }

  function clearHistory(): void {
    imports.value = []
  }

  return { imports, addRecord, clearHistory }
})
