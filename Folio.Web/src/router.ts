import { createRouter, createWebHistory, type Router, type RouterHistory, type RouteRecordRaw } from 'vue-router'
import { isSignedIn, load, mustChangePassword } from './auth/session'
import { home, modules } from './modules/registry'
import { loadWorkspace } from './modules/folio/workspace'

/**
 * The site, and the two pages about being allowed to see it.
 *
 * A route marked `open` is reachable while signed out; everything else is the budget, and
 * the gate below sends a visitor to the sign-in page with the address they asked for so
 * they land on it once they are in.
 */
export const routes: RouteRecordRaw[] = [
  // The site opens on its one app, so the bare address is the budget rather than a menu
  // with one thing on it.
  { path: '/', redirect: home.path },

  {
    path: '/signin',
    name: 'signin',
    component: () => import('./auth/SignInView.vue'),
    meta: { open: true },
  },
  { path: '/account', name: 'account', component: () => import('./auth/AccountView.vue') },

  // One route per module, each loaded on arrival.
  ...modules,

  // A module that was removed leaves stale links, and a mistyped address is not a page.
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

/**
 * The site's router, and the sign-in in front of it.
 *
 * The budget is somebody's, so every page that shows it is closed until a session says
 * whose it is. What the session is worth is decided by the API; this only asks.
 */
export function createFolioRouter(history: RouterHistory): Router {
  const router = createRouter({ history, routes })

  // The stores read the browser's copy the first time they are used, so the server's copy
  // has to be in place before the budget is first shown -- once per sign-in, not on every
  // navigation.
  let primed = false

  router.beforeEach(async (to) => {
    // Asked once per load, and the answer is what the whole page believes until a reload.
    await load()

    if (to.name === 'signin' && isSignedIn() && !mustChangePassword()) return { path: '/' }
    if (to.meta.open === true) return true

    if (!isSignedIn()) {
      primed = false

      return { name: 'signin', query: to.fullPath === '/' ? {} : { next: to.fullPath } }
    }

    // A password somebody was handed has to become theirs before anything else opens.
    if (mustChangePassword() && to.name !== 'account') return { name: 'account' }

    if (!primed) {
      primed = true

      await loadWorkspace()
    }

    return true
  })

  return router
}

export const router = createFolioRouter(createWebHistory())
