import type { RouteRecordRaw } from 'vue-router'

/**
 * Folio, served at /folio.
 *
 * One module, not one per page: the budget, the accounts and the reports all read the
 * same transactions, so they are one app with its own pages inside it. The sidebar it
 * brings is that app's own navigation.
 */
export const folioRoute: RouteRecordRaw = {
  path: '/folio',
  name: 'folio',
  component: () => import('./FolioView.vue'),
}
