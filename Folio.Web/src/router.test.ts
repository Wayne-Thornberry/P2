import { describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { createFolioRouter } from './router'

describe('the site router', () => {
  it('serves the portal at the root', async () => {
    const router = createFolioRouter(createMemoryHistory())

    await router.push('/')

    expect(router.currentRoute.value.name).toBe('home')
  })

  it('serves a module at its own path', async () => {
    const router = createFolioRouter(createMemoryHistory())

    await router.push('/folio')

    expect(router.currentRoute.value.name).toBe('folio')
  })

  it('sends an address with no page home rather than nowhere', async () => {
    const router = createFolioRouter(createMemoryHistory())

    await router.push('/no-such-app')

    expect(router.currentRoute.value.name).toBe('home')
  })

  it('has no sign-in page, because there is no sign-in', () => {
    const router = createFolioRouter(createMemoryHistory())

    expect(router.hasRoute('login')).toBe(false)
    expect(router.hasRoute('account')).toBe(false)
  })
})
