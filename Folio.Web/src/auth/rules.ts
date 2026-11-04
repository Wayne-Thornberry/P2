/**
 * What a username, a password and a PIN have to be.
 *
 * The API keeps its own copy in `AccountRules` and re-checks every one of these, so this is
 * not a security boundary -- it is what lets the form say what is wrong without a round
 * trip, in the same words the refusal would use.
 */
export const USERNAME_MIN = 3
export const USERNAME_MAX = 32
export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 128
export const PIN_LENGTH = 6

/** Why this username cannot be used, or null when it can. */
export function usernameProblem(username: string): string | null {
  if (username.trim().length === 0) return 'An account needs a username.'
  if (username.length < USERNAME_MIN) return `A username is at least ${USERNAME_MIN} characters.`
  if (username.length > USERNAME_MAX) return `A username is at most ${USERNAME_MAX} characters.`
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(username)) {
    return 'A username is letters, digits, dots, dashes and underscores, starting with a letter or a digit.'
  }

  return null
}

/** Why this password cannot be used, or null when it can. */
export function passwordProblem(password: string, username = ''): string | null {
  if (password.length === 0) return 'A password is needed.'
  if (password.length < PASSWORD_MIN) return `A password is at least ${PASSWORD_MIN} characters.`
  if (password.length > PASSWORD_MAX) return `A password is at most ${PASSWORD_MAX} characters.`
  if (password.trim().length === 0) return 'A password cannot be all spaces.'
  if (username && password.toLowerCase() === username.toLowerCase()) return 'A password cannot be the username.'

  return null
}

/** Why this PIN cannot be used, or null when it can. */
export function pinProblem(pin: string): string | null {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin) ? null : `A PIN is ${PIN_LENGTH} digits.`
}
