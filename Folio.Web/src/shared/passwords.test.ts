import { describe, expect, it } from 'vitest'
import { MAX_PASSWORD, MIN_PASSWORD, problemWithNewPassword, problemWithPassword } from './passwords'

describe('a password on its way to the API', () => {
  it('is fine at the minimum length', () => {
    expect(problemWithPassword('x'.repeat(MIN_PASSWORD))).toBeNull()
  })

  it('is refused below the minimum', () => {
    expect(problemWithPassword('short')).toBe(`A password needs at least ${MIN_PASSWORD} characters.`)
  })

  it('is refused when it is absurdly long', () => {
    expect(problemWithPassword('x'.repeat(MAX_PASSWORD + 1))).toBe(`A password is at most ${MAX_PASSWORD} characters.`)
  })

  it('is refused when it is only spaces', () => {
    expect(problemWithPassword('          ')).toBe('A password cannot be only spaces.')
  })
})

describe('a new password and its confirmation', () => {
  it('passes when they match', () => {
    expect(problemWithNewPassword('a-good-password', 'a-good-password')).toBeNull()
  })

  it('reports a mismatch only after the password itself is acceptable', () => {
    expect(problemWithNewPassword('a-good-password', 'a-good-passwerd')).toBe('The two passwords are not the same.')
    expect(problemWithNewPassword('short', 'short')).toContain('at least')
  })
})
