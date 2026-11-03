import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, request } from './api'

function respond(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  })
}

describe('a request to the API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends no credentials of any kind', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, { hello: 'there' }))
    vi.stubGlobal('fetch', fetchMock)

    await request('/api/thing')

    const [, init] = fetchMock.mock.calls[0]
    expect(new Headers(init.headers).get('Authorization')).toBeNull()
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(400, { error: 'A country is needed.' })))

    const failure = await request('/api/thing').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as ApiError).message).toBe('A country is needed.')
    expect((failure as ApiError).status).toBe(400)
  })

  it('falls back to the status when the refusal is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>oops</html>', { status: 500 })))

    const failure = await request('/api/thing').catch((error: unknown) => error)

    expect((failure as ApiError).message).toBe('The server answered 500.')
  })

  it('answers nothing at all for a no-content response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(204)))

    await expect(api.delete('/api/thing/1')).resolves.toBeUndefined()
  })
})
