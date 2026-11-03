import type { RouteRecordRaw } from 'vue-router'
import { folioRoute } from './folio'

/**
 * Every app on the site, as routes.
 *
 * One line per module. Each module's own folder holds its pages and its logic, and the
 * route is loaded when it is first visited, so a module still ships as its own chunk.
 *
 * The API knows the same modules by name and supplies the title and description the
 * home page shows, so adding an app is: an API module, a folder, and a line here.
 */
export const modules: RouteRecordRaw[] = [folioRoute]

/** The path a module is served at, by the name the API knows it by. */
export function pathOf(moduleName: string): string | undefined {
  return modules.find((route) => route.name === moduleName)?.path
}
