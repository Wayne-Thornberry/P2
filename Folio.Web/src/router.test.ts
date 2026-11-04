import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { createFolioRouter } from './router'

// The site asks the API who is asking before it shows anything, and primes the budget from
// it. Neither is what this file is about: the shape of the routes and the way in are.
const session = vi.hoisted(() => ({ signedIn: true, changing: false }))

vi.mock('./auth/session', () => ({
  load: async () => ({}),
  isSignedIn: () => session.signedIn,
  mustChangePassword: () => session.changing,
}))

vi.mock('./modules/folio/workspace', () => ({ loadWorkspace: async () => {} }))

beforeEach(() => {
  session.signedIn = true
  session.changing = false
})

describe('the site router', () => {
  it('opens the site on its app, with no menu in between', async () => {
    const router = createFolioRouter(createMemoryHistory())

    await router.push('/')

    expect(router.currentRoute.value.name).toBe('folio')
    expect(router.currentRoute.value.path).toBe('/folio')
  })

  it('serves a module at its own path', async () => {
    const router = createFolioRouter(createMemoryHistory())

    await router.push('/folio')

    expect(router.currentRoute.value.name).toBe('folio')
  })

  it('sends an address with no page to the app rather than nowhere', async () => {
    const router = createFolioRouter(createMemoryHistory())

    await router.push('/no-such-app')

    expect(router.currentRoute.value.name).toBe('folio')
  })

  it('sends a visitor who is not signed in to the way in, remembering the page', async () => {
    session.signedIn = false

    const router = createFolioRouter(createMemoryHistory())

    await router.push('/folio')

    expect(router.currentRoute.value.name).toBe('signin')
    expect(router.currentRoute.value.query.next).toBe('/folio')
  })

  it('lets a signed-in visitor stay out of the sign-in page', async () => {
    const router = createFolioRouter(createMemoryHistory())

    await router.push('/signin')

    expect(router.currentRoute.value.name).toBe('folio')
  })

  it('opens the account page and nothing else while a handed-over password stands', async () => {
    session.changing = true

    const router = createFolioRouter(createMemoryHistory())

    await router.push('/folio')

    expect(router.currentRoute.value.name).toBe('account')
  })
})
