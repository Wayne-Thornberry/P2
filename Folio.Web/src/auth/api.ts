import { api } from '../shared'

/** What the site knows about who is asking, before and after signing in. */
export interface AccountState {
  needsFirstAccount: boolean
  signedIn: boolean
  username: string | null
  mustChangePassword: boolean
  hasPin: boolean
}

export const NOBODY: AccountState = {
  needsFirstAccount: false,
  signedIn: false,
  username: null,
  mustChangePassword: false,
  hasPin: false,
}

export function fetchState(): Promise<AccountState> {
  return api.get<AccountState>('/api/auth/state')
}

/** The first account, made from the page because there is nobody to be handed a password. */
export function claim(username: string, password: string): Promise<AccountState> {
  return api.post<AccountState>('/api/auth/claim', { username, password })
}

export function signIn(username: string, password: string): Promise<AccountState> {
  return api.post<AccountState>('/api/auth/signin', { username, password })
}

export function signOut(): Promise<void> {
  return api.post<void>('/api/auth/signout', {})
}

export function changePassword(currentPassword: string, newPassword: string): Promise<AccountState> {
  return api.post<AccountState>('/api/auth/password', { currentPassword, newPassword })
}

export function setPin(password: string, pin: string): Promise<AccountState> {
  return api.post<AccountState>('/api/auth/pin', { password, pin })
}

export function resetWithPin(username: string, pin: string, newPassword: string): Promise<AccountState> {
  return api.post<AccountState>('/api/auth/reset', { username, pin, newPassword })
}
