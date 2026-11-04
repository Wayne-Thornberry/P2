import { ref } from 'vue'
import { api } from '../../shared'
import { storageKey } from './utils/storeStorage'

/**
 * Folio's saved data, as the API keeps it.
 *
 * The app was written to keep each area of its state in localStorage, one JSON blob per
 * collection, and to rewrite the blob whenever anything in it changed. That is still how
 * it works: this file is the only part that knows the blob is a row in SQL Server rather
 * than a key in the browser. It primes the browser's copy from the server before the app
 * starts, and sends a changed collection back after it has changed.
 *
 * The browser's copy is kept as well, so a failure to reach the API is a save that is
 * retried on the next change rather than a page of errors.
 */

/** The endpoint each store's collection is saved under. */
const RESOURCES: Record<string, string> = {
  folio_accounts: 'accounts',
  folio_transactions: 'transactions',
  folio_upcoming: 'upcoming',
  folio_budget: 'budget',
  folio_template: 'template',
  folio_savings_goals: 'savings-goals',
  folio_finance: 'finance',
  folio_planner: 'planner',
  folio_import_history: 'import-history',
}

/** Settings are per account rather than per country, so they have their own key and endpoint. */
const SETTINGS_KEY = 'folio_settings'

/** How long after the last change a collection is sent, so a burst of edits is one request. */
const SETTLE_MS = 500

/**
 * Counts the saves that have reached the server.
 *
 * What the API works out for the site -- the health score today -- is only true for what
 * has been saved, so a view watching this number asks again once an edit has landed
 * instead of showing a figure that describes the budget before it.
 */
export const saved = ref(0)

interface PendingSave {
  timer: ReturnType<typeof setTimeout>
  task: () => Promise<unknown>
}

const pending = new Map<string, PendingSave>()

/** Saves are sent one after another, so a slow write cannot overtake a newer one. */
let queue: Promise<unknown> = Promise.resolve()

/**
 * Fetches what the account has saved, and puts it where the stores already look for it.
 *
 * Called once before the app is mounted. With no session -- the mock server, a first run,
 * a test -- it does nothing and the browser's own copy is what the app reads.
 */
export async function loadWorkspace(): Promise<void> {

  let settings: Record<string, unknown> | null

  try {
    settings = (await api.get<Record<string, unknown> | undefined>('/api/folio/settings')) ?? null
  } catch (error) {
    warn('The saved settings could not be read', error)
    return
  }

  if (settings === null) {
    // Nothing has been saved for this account yet. Whatever this browser already holds is
    // the first copy, so it is sent up: a browser that has been using Folio locally keeps
    // its budget the first time it signs in to this site.
    adoptLocalCopy()
    return
  }

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))

  const country = typeof settings.country === 'string' ? settings.country : ''
  if (!country) return

  try {
    const workspace = await api.get<Record<string, unknown>>(
      `/api/folio/workspace?country=${encodeURIComponent(country)}`,
    )

    for (const base of Object.keys(RESOURCES)) {
      const blob = workspace[base]

      // The server is the source of truth: a collection it does not have is removed here
      // rather than left behind from an older page load.
      if (blob === undefined) localStorage.removeItem(storageKey(base, country))
      else localStorage.setItem(storageKey(base, country), JSON.stringify(blob))
    }
  } catch (error) {
    warn('The saved budget could not be read', error)
  }
}

/**
 * Sends one collection back to the server, once the user has stopped changing it.
 *
 * Debounced because dragging money between envelopes fires a change per pixel: the point
 * is to save the budget, not to describe every step of arriving at it.
 */
export function queueStoreSave(base: string, country: string, blob: unknown): void {
  if (!country || !RESOURCES[base]) return

  const key = `${base}:${country}`
  const task = () =>
    api.put<void>(`/api/folio/${RESOURCES[base]}?country=${encodeURIComponent(country)}`, blob)

  const waiting = pending.get(key)
  if (waiting) clearTimeout(waiting.timer)

  pending.set(key, {
    task,
    timer: setTimeout(() => {
      pending.delete(key)
      enqueue(task)
    }, SETTLE_MS),
  })
}

/** Saves the account's settings. Not debounced: a country change has to land before the reload. */
export function queueSettingsSave(blob: unknown): void {

  enqueue(() => api.put<void>('/api/folio/settings', blob))
}

/**
 * Sends up everything this browser already holds for its country.
 *
 * This is the one-time move from "the data is in the browser" to "the data is in SQL
 * Server": it runs only when the account has never saved anything.
 */
function adoptLocalCopy(): void {
  let settings: Record<string, unknown> | null = null

  try {
    settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null')
  } catch {
    settings = null
  }

  if (settings === null) return

  queueSettingsSave(settings)

  const country = typeof settings.country === 'string' ? settings.country : ''
  if (!country) return

  for (const base of Object.keys(RESOURCES)) {
    const raw = localStorage.getItem(storageKey(base, country))
    if (raw === null) continue

    try {
      queueStoreSave(base, country, JSON.parse(raw))
    } catch {
      // A blob that will not parse is one the app is about to replace anyway.
    }
  }
}

/** Runs a save after the ones already queued, so requests leave in the order they were made. */
function enqueue(task: () => Promise<unknown>): void {
  queue = queue
    .then(task)
    .then(() => {
      saved.value += 1
    })
    .catch((error: unknown) => {
      warn('A change could not be saved to the server; it is still in this browser', error)
    })
}

/** Waits for everything queued to be sent, for a caller about to leave the page. */
export async function flushSaves(): Promise<void> {
  for (const [key, save] of [...pending]) {
    clearTimeout(save.timer)
    pending.delete(key)
    enqueue(save.task)
  }

  await queue
}

/**
 * Throws away a country's saved data, on the server as well as here.
 *
 * The settings are kept, and pending saves for that country are dropped before they are
 * sent: otherwise a change made a moment ago would put the rows straight back.
 */
export async function deleteWorkspace(country: string): Promise<void> {
  for (const key of [...pending.keys()]) {
    if (!key.endsWith(`:${country}`)) continue

    const save = pending.get(key)!
    clearTimeout(save.timer)
    pending.delete(key)
  }

  if (!country) return

  await api.delete(`/api/folio/workspace?country=${encodeURIComponent(country)}`)
}

/** Every country this account has saved, according to the server. */
export async function savedCountries(): Promise<string[]> {
  try {
    return await api.get<string[]>('/api/folio/countries')
  } catch (error) {
    warn('The list of saved countries could not be read', error)
    return []
  }
}

/**
 * One country's collections, for an export.
 *
 * The server's copy is what is exported; the browser's is used where the server has
 * nothing, which is what a mock or an unreachable API leaves.
 */
export async function readCountry(country: string): Promise<Record<string, unknown>> {
  const local = readLocal(country)

  try {
    const remote = await api.get<Record<string, unknown>>(
      `/api/folio/workspace?country=${encodeURIComponent(country)}`,
    )

    return { ...local, ...remote }
  } catch (error) {
    warn(`The saved budget for ${country} could not be read`, error)
    return local
  }
}

/** Everything this browser holds for a country, keyed as the API keys it. */
function readLocal(country: string): Record<string, unknown> {
  const blobs: Record<string, unknown> = {}

  for (const base of Object.keys(RESOURCES)) {
    const raw = localStorage.getItem(storageKey(base, country))
    if (raw === null) continue

    try {
      blobs[base] = JSON.parse(raw)
    } catch {
      // A blob that will not parse is one the app is about to replace anyway.
    }
  }

  return blobs
}

function warn(message: string, error: unknown): void {
  console.warn(`[folio] ${message}.`, error)
}
