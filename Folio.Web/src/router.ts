import { createRouter, createWebHistory, type Router, type RouterHistory, type RouteRecordRaw } from 'vue-router'
import { isSignedIn } from './shared'
import { modules } from './modules/registry'
import { refreshSession } from './state'

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('./views/HomeView.vue'), meta: { requiresSignIn: true } },
  { path: '/login', name: 'login', component: () => import('./views/LoginView.vue') },
  { path: '/account', name: 'account', component: () => import('./views/AccountView.vue'), meta: { requiresSignIn: true } },

  // One route per module, each loaded on arrival.
  ...modules,

  // A module that was removed leaves stale links, and a mistyped address is not a page.
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

/**
 * The site's router.
 *
 * Signing in is the app's only gate, and everything except the sign-in page needs it,
 * so the guard is here rather than repeated in each page. Signing in from the sign-in
 * page while already signed in goes on to wherever it was going instead of asking
 * again.
 */
export function createFolioRouter(history: RouterHistory): Router {
  const router = createRouter({ history, routes })

  router.beforeEach((to) => {
    if (to.meta.requiresSignIn && !isSignedIn()) {
      return { name: 'login', query: { return: to.fullPath } }
    }

    if (to.name === 'login' && isSignedIn()) {
      return { name: 'home' }
    }

    return true
  })

  // Keeps the header's idea of who is signed in up to date, including after the API
  // layer has discarded a token it was refused.
  router.afterEach(() => refreshSession())

  return router
}

export const router = createFolioRouter(createWebHistory())
