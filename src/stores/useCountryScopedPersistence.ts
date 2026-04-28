import { watch, type WatchSource } from 'vue'
import { storageKey, loadStored } from '../utils/storeStorage'
import { useSettingsStore } from './settingsStore'

/**
 * Wires up the standard Folio country-scoped localStorage persistence
 * pattern for a setup-style Pinia store.
 *
 * Each store has the same boilerplate quartet:
 *   1. Compute the country-scoped storage key.
 *   2. Read initial saved data on first load.
 *   3. Watch state and write the JSON blob back on change.
 *   4. Watch `settings.country` and re-hydrate state for the new country.
 *
 * This composable handles 3 and 4. The caller is responsible for calling
 * `loadCountryScoped(base, legacyKey?)` first to read the initial blob and
 * initialize its own refs/companions (e.g. `_nextId` counters).
 *
 * Forgetting the country watch is a known bug source, so always wire
 * persistence through this composable rather than ad-hoc `watch(...)` calls.
 *
 * Usage in a setup store:
 *
 *   const _saved = loadCountryScoped('folio_foo', 'clearbook_foo')
 *   const items = ref<Foo[]>(_saved?.items ?? [])
 *   if (_saved?.nextId != null) _nextId = _saved.nextId
 *
 *   useCountryScopedPersistence('folio_foo', {
 *     sources: items,
 *     toBlob: () => ({ items: items.value, nextId: _nextId }),
 *     reload: (s) => { _nextId = s?.nextId ?? 1; items.value = s?.items ?? [] },
 *   })
 */
export interface CountryScopedPersistenceOptions {
  /** Reactive sources to deep-watch. A single ref or an array of refs. */
  sources: WatchSource | WatchSource[]
  /** Build the JSON-serializable blob to persist. Called on every change. */
  toBlob: () => unknown
  /** Re-hydrate state from the freshly-loaded blob after a country change. */
  reload: (saved: any) => void
}

/** Load the initial saved blob for a country-scoped store. */
export function loadCountryScoped(base: string, legacyKey?: string): any {
  const settings = useSettingsStore()
  return loadStored(base, settings.country, legacyKey)
}

export function useCountryScopedPersistence(
  base: string,
  opts: CountryScopedPersistenceOptions,
): void {
  const settings = useSettingsStore()

  watch(
    opts.sources as any,
    () => {
      localStorage.setItem(storageKey(base, settings.country), JSON.stringify(opts.toBlob()))
    },
    { deep: true },
  )

  watch(() => settings.country, (newCountry) => {
    if (!newCountry) return
    opts.reload(loadStored(base, settings.country))
  })
}
