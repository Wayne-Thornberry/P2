import { reactive, readonly } from 'vue'
import * as auth from './api'
import type { AccountState } from './api'

/**
 * Who is signed in, for the whole page.
 *
 * The server is the authority -- there is a session row behind every answer -- and this is
 * the browser's copy of the last thing it said. Every call here that changes something
 * replaces this with the state the API answered with, so the two cannot drift.
 */
const state = reactive<AccountState>({ ...auth.NOBODY })

let loading: Promise<AccountState> | null = null

export const account = readonly(state)

export function isSignedIn(): boolean {
  return state.signedIn
}

export function mustChangePassword(): boolean {
  return state.mustChangePassword
}

function adopt(next: AccountState) {
  Object.assign(state, next)

  return next
}

/**
 * Asks the API who is asking. Done once, on the first navigation, unless it is forced: a
 * reload is the only thing that changes the answer behind the page's back.
 */
export function load(force = false): Promise<AccountState> {
  if (!force && loading !== null) return loading

  loading = auth
    .fetchState()
    .then(adopt)
    .catch(() => {
      // An API that cannot be reached is not "signed in"; the page says so when it tries
      // to use anything.
      loading = null

      return adopt({ ...auth.NOBODY })
    })

  return loading
}

export async function claimAccount(username: string, password: string) {
  return adopt(await auth.claim(username, password))
}

export async function signIn(username: string, password: string) {
  return adopt(await auth.signIn(username, password))
}

export async function signOut() {
  try {
    await auth.signOut()
  } finally {
    forget()
  }
}

export async function changePassword(currentPassword: string, newPassword: string) {
  return adopt(await auth.changePassword(currentPassword, newPassword))
}

export async function setPin(password: string, pin: string) {
  return adopt(await auth.setPin(password, pin))
}

export async function resetWithPin(username: string, pin: string, newPassword: string) {
  return adopt(await auth.resetWithPin(username, pin, newPassword))
}

/** The session is gone -- signed out, or expired under the page -- so the state says so. */
export function forget() {
  loading = null

  return adopt({ ...auth.NOBODY })
}
