/**
 * Where to go after signing in, taken from `?return=`.
 *
 * It comes from the address bar, so it is only ever allowed to be a path on this site.
 * `//evil.example` and `https://evil.example` both leave, and a sign-in page that
 * forwards people off-site is worth more to an attacker than one that does not -- so
 * anything that is not a single-slash path goes home instead.
 */
export function safeReturn(raw: unknown, fallback = '/'): string {
  if (typeof raw !== 'string' || raw.length === 0) return fallback

  // A backslash is a slash to some browsers, so it is not a prefix to trust either.
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback

  return raw
}
