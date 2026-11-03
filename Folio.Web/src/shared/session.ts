/**
 * The signed-in session, kept in the browser rather than in a cookie.
 *
 * Every page on the site is one origin, and every module is a route inside it, so this
 * is just the app's own storage: signing in once signs you in to every app. It is
 * localStorage rather than memory so a reload, or a link opened in a new tab, stays
 * signed in.
 */
export interface Session {
  token: string
  username: string
  /** ISO timestamp, as the API answered it. */
  expiresAt: string
}

const STORAGE_KEY = 'Folio.session'

/** The stored session, or null when there is none or it no longer reads. */
export function readSession(): Session | null {
  const raw = storage()?.getItem(STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<Session>

    if (typeof parsed.token !== 'string' || parsed.token.length === 0) return null
    if (typeof parsed.username !== 'string') return null
    if (typeof parsed.expiresAt !== 'string') return null

    return { token: parsed.token, username: parsed.username, expiresAt: parsed.expiresAt }
  } catch {
    // Something else wrote to the key, or half of it was written. Either way there is
    // no session to use.
    return null
  }
}

export function saveSession(session: Session): void {
  storage()?.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function clearSession(): void {
  storage()?.removeItem(STORAGE_KEY)
}

/**
 * Whether there is a session to use.
 *
 * The expiry is checked here as well as by the API: a token that is known to be spent
 * should send the browser to sign in rather than produce a page of 401s.
 */
export function isSignedIn(now: number = Date.now()): boolean {
  const session = readSession()
  if (session === null) return false

  const expires = Date.parse(session.expiresAt)
  return Number.isFinite(expires) && expires > now
}

/** localStorage, or undefined where there is none (a test, or a build run in node). */
function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    // A browser with storage disabled throws on access rather than returning null.
    return undefined
  }
}
