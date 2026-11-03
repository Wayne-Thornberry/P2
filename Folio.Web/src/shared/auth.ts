import { api } from './api'
import { clearSession, saveSession, type Session } from './session'

/** What signing in answers before the client reshapes it. */
interface SignInResponse {
  token: string
  expiresAt: string
  username: string
}

/** What the API says about the signed-in account. */
export interface Account {
  id: number
  username: string
}

/**
 * Signs in and keeps the session, so every app on the site is signed in too.
 *
 * Throws {@link import('./api').ApiError} with the API's message when the credentials
 * are wrong, which is what the sign-in screen shows.
 */
export async function login(username: string, password: string): Promise<Session> {
  const response = await api.post<SignInResponse>('/api/core/auth/login', { username, password })

  const session: Session = {
    token: response.token,
    username: response.username,
    expiresAt: response.expiresAt,
  }

  saveSession(session)
  return session
}

/** Who is signed in, according to the API rather than to the stored session. */
export function whoAmI(): Promise<Account> {
  return api.get<Account>('/api/core/auth/me')
}

/**
 * Signs out on the server and forgets the token here.
 *
 * The token is forgotten even when the call fails: leaving a token the API has already
 * refused in storage would only make the next page look signed in.
 */
export async function signOut(): Promise<void> {
  try {
    await api.post<void>('/api/core/auth/logout', {})
  } finally {
    clearSession()
  }
}

/**
 * Replaces the signed-in password, given the current one.
 *
 * The API hands back a new session, because changing a password signs out every other
 * browser. This one is stored, so the page that changed it stays signed in.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<Session> {
  const response = await api.post<SignInResponse>('/api/core/auth/change-password', {
    currentPassword,
    newPassword,
  })

  const session: Session = {
    token: response.token,
    username: response.username,
    expiresAt: response.expiresAt,
  }

  saveSession(session)
  return session
}

/**
 * Replaces a forgotten password with the recovery code from configuration. No session is
 * involved: this is the way back in when there is no password to use.
 */
export function resetPassword(username: string, recoveryCode: string, newPassword: string): Promise<void> {
  return api.post<void>('/api/core/auth/reset-password', { username, recoveryCode, newPassword })
}
