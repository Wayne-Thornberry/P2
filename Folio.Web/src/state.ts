import { computed, ref } from 'vue'
import { readSession, type Session } from './shared'

/**
 * The signed-in account, as the page sees it.
 *
 * The browser's storage is the one copy of the session; this is a reactive view of it
 * so the header can show who is signed in without every component reading localStorage
 * itself. The router refreshes it on each navigation, which is also what picks up a
 * token the API layer has just thrown away because it was refused.
 */
const current = ref<Session | null>(readSession())

export const session = computed(() => current.value)

/** Whether there is a usable session, by the expiry the API gave it. */
export const signedIn = computed(() => {
  const expires = Date.parse(current.value?.expiresAt ?? '')
  return Number.isFinite(expires) && expires > Date.now()
})

export const username = computed(() => current.value?.username ?? '')

/** Re-reads the session from storage. Called after signing in or out, and on navigation. */
export function refreshSession(): void {
  current.value = readSession()
}
