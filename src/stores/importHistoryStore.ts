import { defineStore } from 'pinia'
import { ref } from 'vue'
import { loadCountryScoped, useCountryScopedPersistence } from './useCountryScopedPersistence'

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
  const _saved = loadCountryScoped('folio_import_history', 'clearbook_import_history')
  const imports = ref<ImportRecord[]>(_saved?.imports ?? [])
  if (_saved?.nextId != null) _nextId = _saved.nextId

  useCountryScopedPersistence('folio_import_history', {
    sources: imports,
    toBlob: () => ({ imports: imports.value, nextId: _nextId }),
    reload: (s) => { _nextId = s?.nextId ?? 1; imports.value = s?.imports ?? [] },
  })

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
