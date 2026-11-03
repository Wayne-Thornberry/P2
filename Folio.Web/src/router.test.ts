import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { saveSession } from './shared'
import { createFolioRouter } from './router'

function signedIn() {
  saveSession({
    token: 'a-token',
    username: 'wayne',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  })
}

describe('the site router', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('sends a signed-out visitor to sign in, remembering where they were going', async () => {
    const router = createFolioRouter(createMemoryHistory())

    await router.push('/?from=bookmark')

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.return).toBe('/?from=bookmark')
  })

  it('lets a signed-in visitor straight in', async () => {
    signedIn()
    const router = createFolioRouter(createMemoryHistory())

    await router.push('/')

    expect(router.currentRoute.value.name).toBe('home')
  })

  it('does not ask a signed-in visitor to sign in again', async () => {
    signedIn()
    const router = createFolioRouter(createMemoryHistory())

    await router.push('/login')

    expect(router.currentRoute.value.name).toBe('home')
  })

  it('keeps the sign-in page reachable once the session has gone', async () => {
    signedIn()
    window.localStorage.clear()
    const router = createFolioRouter(createMemoryHistory())

    await router.push('/login')

    expect(router.currentRoute.value.name).toBe('login')
  })

  it('guards a module the same way as the rest of the site', async () => {
    const router = createFolioRouter(createMemoryHistory())

    await router.push('/folio')

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.return).toBe('/folio')
  })

  it('serves a module once signed in', async () => {
    signedIn()
    const router = createFolioRouter(createMemoryHistory())

    await router.push('/folio')

    expect(router.currentRoute.value.name).toBe('folio')
  })

  it('sends an address with no page home rather than nowhere', async () => {
    signedIn()
    const router = createFolioRouter(createMemoryHistory())

    await router.push('/no-such-app')

    expect(router.currentRoute.value.name).toBe('home')
  })
})
