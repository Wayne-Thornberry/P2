import type { RouteRecordRaw } from 'vue-router'
import { folioRoute } from './folio'

/**
 * Every app on the site, as routes.
 *
 * One line per module. Each module's own folder holds its pages and its logic, and the
 * route is loaded when it is first visited, so a module still ships as its own chunk.
 */
export const modules: RouteRecordRaw[] = [folioRoute]

/**
 * The app the site opens on.
 *
 * There is no page listing the apps: a site of this shape has one, and a card that links
 * to the only card is a click for nothing. A second app would be linked from the first.
 */
export const home = folioRoute
