import { apiUrl } from './config'
import { clearSession, readSession } from './session'

/**
 * Everything that went wrong on the way to the API, with the API's own words for it.
 *
 * The API answers a refusal as `{ "error": "why" }` whatever the module, so the
 * message here is always something worth showing a person.
 */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }

  /** Whether the session was refused rather than the request being wrong. */
  get isSignedOut(): boolean {
    return this.status === 401
  }
}

/**
 * A request to the API, carrying the session when there is one.
 *
 * A 401 clears the stored session: the token has expired or been signed out
 * elsewhere, and continuing to send it only produces more of the same.
 */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)

  const session = readSession()
  if (session) headers.set('Authorization', `Bearer ${session.token}`)

  if (init.body !== undefined) headers.set('Content-Type', 'application/json')

  const response = await fetch(apiUrl(path), { ...init, headers })

  if (response.status === 401) clearSession()

  if (!response.ok) throw new ApiError(response.status, await errorMessage(response))

  // 204 has nothing to say, and asking it for JSON would throw.
  if (response.status === 204) return undefined as T

  return (await response.json()) as T
}

/** The API's own words for a refusal, or the status when it did not give any. */
async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }

    if (typeof body?.error === 'string' && body.error.length > 0) return body.error
  } catch {
    // Not JSON: the fallback below is all that can be said.
  }

  return `The server answered ${response.status}.`
}

/** The API, in four verbs. Modules use this rather than fetch, so they all agree. */
export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path)
  },

  post<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) })
  },

  put<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) })
  },

  delete(path: string): Promise<void> {
    return request<void>(path, { method: 'DELETE' })
  },
}
