import { createRouter, createWebHistory, type Router, type RouterHistory, type RouteRecordRaw } from 'vue-router'
import { home, modules } from './modules/registry'

export const routes: RouteRecordRaw[] = [
  // The site opens on its one app, so the bare address is the budget rather than a menu
  // with one thing on it.
  { path: '/', redirect: home.path },

  // One route per module, each loaded on arrival.
  ...modules,

  // A module that was removed leaves stale links, and a mistyped address is not a page.
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

/**
 * The site's router.
 *
 * There is no guard: nothing on this site is behind a sign-in, because it runs on a
 * private box that only its owner can reach.
 */
export function createFolioRouter(history: RouterHistory): Router {
  return createRouter({ history, routes })
}

export const router = createFolioRouter(createWebHistory())
