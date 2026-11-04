import { describe, expect, it } from 'vitest'
import { passwordProblem, pinProblem, usernameProblem } from './rules'

describe('what an account may be', () => {
  it('takes a username of letters, digits and a few punctuation marks', () => {
    for (const username of ['wayne', 'wayne.thornberry', 'w_1-ster', 'abc']) {
      expect(usernameProblem(username)).toBeNull()
    }
  })

  it('refuses a username that is not one', () => {
    expect(usernameProblem('')).toBe('An account needs a username.')
    expect(usernameProblem('ab')).toContain('at least')
    expect(usernameProblem('has space')).toContain('letters, digits')
    expect(usernameProblem('.leading')).toContain('letters, digits')
    expect(usernameProblem('a'.repeat(33))).toContain('at most')
  })

  it('takes a password of the right length', () => {
    expect(passwordProblem('a-good-password')).toBeNull()
    expect(passwordProblem('with spaces inside')).toBeNull()
  })

  it('refuses a password that is not one', () => {
    expect(passwordProblem('')).toBe('A password is needed.')
    expect(passwordProblem('short')).toContain('at least')
    expect(passwordProblem('          ')).toContain('all spaces')
    expect(passwordProblem('waynethornberry', 'waynethornberry')).toContain('username')
  })

  it('takes a PIN of six digits and nothing else', () => {
    expect(pinProblem('123456')).toBeNull()
    expect(pinProblem('000000')).toBeNull()

    for (const pin of ['', '12345', '1234567', '12345a', '12 456']) {
      expect(pinProblem(pin)).toContain('6 digits')
    }
  })
})
