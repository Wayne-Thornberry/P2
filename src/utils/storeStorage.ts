/**
 * Shared localStorage helpers for country-scoped store persistence.
 *
 * All ClearBook store data lives under `clearbook_<feature>[_<country>]` keys.
 * When a user first sets a country, data is migrated from the bare key into the
 * country-scoped key. Optionally, a legacy `p2_` key is also migrated on first load.
 */

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

    // One-time migration: legacy p2_ key
    if (raw === null && legacyKey) {
      raw = localStorage.getItem(legacyKey)
      if (raw !== null) localStorage.removeItem(legacyKey)
    }

    return JSON.parse(raw ?? 'null')
  } catch {
    return null
  }
}
