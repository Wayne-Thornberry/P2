/**
 * The rule a new password has to pass, here so the form can say what is wrong before
 * anything is sent. The API's copy is the authority: these numbers match
 * Folio.Api\Modules\Core\PasswordPolicy.
 */
export const MIN_PASSWORD = 8
export const MAX_PASSWORD = 256

/** Why this password cannot be used, or null when it can. */
export function problemWithPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `A password needs at least ${MIN_PASSWORD} characters.`
  if (password.length > MAX_PASSWORD) return `A password is at most ${MAX_PASSWORD} characters.`
  if (password.trim().length === 0) return 'A password cannot be only spaces.'

  return null
}

/**
 * The first thing wrong with a new password and its confirmation, in the order a person
 * fills them in: the password itself, then whether the two match.
 */
export function problemWithNewPassword(password: string, confirmation: string): string | null {
  const problem = problemWithPassword(password)
  if (problem !== null) return problem

  return password === confirmation ? null : 'The two passwords are not the same.'
}
