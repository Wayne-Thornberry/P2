/**
 * Shared localStorage helpers for country-scoped store persistence.
 *
 * All Folio store data lives under `folio_<feature>[_<country>]` keys.
 * When a user first sets a country, data is migrated from the bare key into the
 * country-scoped key. Optionally, a legacy `p2_` key is also migrated on first load.
 */

/**
 * One-time bulk migration: rename every `clearbook_*` key to its `folio_*` equivalent.
 * Must be called before any store initialises so that stores read the correct keys.
 * Safe to call on every startup — it is a no-op once all clearbook_ keys are gone.
 * Overwrites any empty stubs that may have been written on a previous bad startup.
 */
export function runLegacyMigration(): void {
  const toMigrate: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith('clearbook_')) toMigrate.push(k)
  }
  for (const oldKey of toMigrate) {
    const newKey = 'folio_' + oldKey.slice('clearbook_'.length)
    const raw = localStorage.getItem(oldKey)
    if (raw !== null) {
      localStorage.setItem(newKey, raw)
      localStorage.removeItem(oldKey)
    }
  }
}

/** Returns the country-scoped localStorage key. */
export function storageKey(base: string, country: string): string {
  return country ? `${base}_${country}` : base
}

/**
 * Load JSON from localStorage with automatic key migration.
 * - Reads the country-scoped key `base_country` (or bare `base` when country is empty).
 * - If missing and country is set, migrates data from the bare `base` key.
 * - If still missing and a `legacyKey` is provided, migrates from that key.
 */
export function loadStored(base: string, country: string, legacyKey?: string): any {
  try {
    const key = storageKey(base, country)
    let raw = localStorage.getItem(key)

    // One-time migration: bare key → country-scoped key
    if (raw === null && country) {
      raw = localStorage.getItem(base)
      if (raw !== null) {
        localStorage.setItem(key, raw)
        localStorage.removeItem(base)
      }
    }

    // One-time migration: legacy key (try country-scoped variant first, then bare)
    if (raw === null && legacyKey) {
      const legacyCountryKey = country ? `${legacyKey}_${country}` : legacyKey
      raw = localStorage.getItem(legacyCountryKey)
      if (raw !== null) {
        localStorage.setItem(key, raw)
        localStorage.removeItem(legacyCountryKey)
      }
      if (raw === null) {
        raw = localStorage.getItem(legacyKey)
        if (raw !== null) {
          localStorage.setItem(key, raw)
          localStorage.removeItem(legacyKey)
        }
      }
    }

    return JSON.parse(raw ?? 'null')
  } catch {
    return null
  }
}
