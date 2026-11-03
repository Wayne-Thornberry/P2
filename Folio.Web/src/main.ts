import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Aura from '@primevue/themes/aura'
import ToastService from 'primevue/toastservice'
import 'primeicons/primeicons.css'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { loadWorkspace } from './modules/folio/workspace'
import { runLegacyMigration } from './modules/folio/utils/storeStorage'

/**
 * The site starts once the saved workspace has been fetched.
 *
 * Every store in Folio reads its saved state synchronously the first time it is used, so
 * the server's copy has to be in the browser before the first component asks for it.
 * Fetching first also means a failure to reach the API is a slow start rather than a page
 * that shows stale data and then corrects itself.
 */
async function start() {
  // Storage written under the old names is renamed before anything reads it, and before
  // the server's copy is put where the stores look.
  runLegacyMigration()

  await loadWorkspace()

  const app = createApp(App)

  app.use(createPinia())
  app.use(router)
  app.use(PrimeVue, {
    theme: {
      preset: Aura,
      options: {
        darkModeSelector: '.dark',
      },
    },
  })
  app.use(ToastService)

  app.mount('#app')
}

void start()
