import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useSettingsStore } from './settingsStore'
import { storageKey, loadStored } from '../utils/storeStorage'

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
  const settings = useSettingsStore()

  function _key(): string { return storageKey('clearbook_import_history', settings.country) }
  function _load() { return loadStored('clearbook_import_history', settings.country) }

  const _saved = _load()

  const imports = ref<ImportRecord[]>(_saved?.imports ?? [])
  if (_saved?.nextId != null) _nextId = _saved.nextId

  watch(imports, (val) => {
    localStorage.setItem(_key(), JSON.stringify({ imports: val, nextId: _nextId }))
  }, { deep: true })

  // Reload when country changes
  watch(() => settings.country, (newCountry) => {
    if (!newCountry) return
    const saved = _load()
    _nextId       = saved?.nextId  ?? 1
    imports.value = saved?.imports ?? []
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
