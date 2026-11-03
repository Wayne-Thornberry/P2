import { beforeEach, describe, expect, it } from 'vitest'
import { clearSession, isSignedIn, readSession, saveSession, type Session } from './session'

const session: Session = {
  token: 'abc123',
  username: 'wayne',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
}

describe('the stored session', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('reads back what was saved', () => {
    saveSession(session)

    expect(readSession()).toEqual(session)
  })

  it('is nothing at all after signing out', () => {
    saveSession(session)
    clearSession()

    expect(readSession()).toBeNull()
    expect(isSignedIn()).toBe(false)
  })

  it('is signed in while the expiry is in the future', () => {
    saveSession(session)

    expect(isSignedIn()).toBe(true)
  })

  it('is signed out once the expiry has passed, without asking the API', () => {
    saveSession({ ...session, expiresAt: new Date(Date.now() - 1_000).toISOString() })

    expect(isSignedIn()).toBe(false)
  })

  it('ignores an expiry that is not a date', () => {
    saveSession({ ...session, expiresAt: 'whenever' })

    expect(isSignedIn()).toBe(false)
  })

  it('treats a damaged value as no session rather than throwing', () => {
    window.localStorage.setItem('Folio.session', '{ not json')

    expect(readSession()).toBeNull()
  })

  it('needs a token, not just a shape', () => {
    window.localStorage.setItem(
      'Folio.session',
      JSON.stringify({ token: '', username: 'wayne', expiresAt: session.expiresAt }),
    )

    expect(readSession()).toBeNull()
  })
})
