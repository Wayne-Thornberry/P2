/**
 * Where the site finds the API.
 *
 * The API is its own IIS site on its own port, so the browser calls it directly and
 * its origin has to be allowed by the API's CORS policy. The host comes from the page
 * the browser already loaded, so one build works on localhost, a LAN address or a
 * public name -- set VITE_API_ORIGIN to pin it.
 *
 * In development this stays empty: the dev server proxies /api to the API, so requests
 * are same-origin and no CORS is involved.
 */
export function apiOrigin(): string {
  const explicit = import.meta.env.VITE_API_ORIGIN as string | undefined
  if (explicit) return explicit.replace(/\/+$/, '')
  if (!import.meta.env.PROD) return ''

  const port = (import.meta.env.VITE_API_PORT as string | undefined) ?? '5423'
  return `${window.location.protocol}//${window.location.hostname}:${port}`
}

/** An absolute URL for an API path, whichever origin that is. */
export function apiUrl(path: string): string {
  const base = apiOrigin()
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}
