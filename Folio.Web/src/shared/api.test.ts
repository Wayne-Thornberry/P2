import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, request } from './api'
import { readSession, saveSession } from './session'

function respond(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  })
}

describe('a request to the API', () => {
  beforeEach(() => {
    window.localStorage.clear()
    saveSession({
      token: 'the-token',
      username: 'wayne',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('carries the session token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, { hello: 'there' }))
    vi.stubGlobal('fetch', fetchMock)

    await request('/api/thing')

    const [, init] = fetchMock.mock.calls[0]
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer the-token')
  })

  it('sends a body as JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, {}))
    vi.stubGlobal('fetch', fetchMock)

    await api.post('/api/thing', { title: 'a note' })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"title":"a note"}')
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
  })

  it("surfaces the API's own message when it refuses", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(400, { error: 'A note needs a title.' })))

    const failure = await request('/api/thing').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as ApiError).message).toBe('A note needs a title.')
    expect((failure as ApiError).status).toBe(400)
    expect((failure as ApiError).isSignedOut).toBe(false)
  })

  it('falls back to the status when the refusal is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>oops</html>', { status: 500 })))

    const failure = await request('/api/thing').catch((error: unknown) => error)

    expect((failure as ApiError).message).toBe('The server answered 500.')
  })

  it('forgets the session when the token is refused', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(401, { error: 'Not signed in.' })))

    const failure = await request('/api/thing').catch((error: unknown) => error)

    expect((failure as ApiError).isSignedOut).toBe(true)
    expect(readSession()).toBeNull()
  })

  it('answers nothing at all for a no-content response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(204)))

    await expect(api.delete('/api/thing/1')).resolves.toBeUndefined()
  })
})
