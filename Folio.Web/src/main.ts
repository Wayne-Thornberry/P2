import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Aura from '@primevue/themes/aura'
import ToastService from 'primevue/toastservice'
import 'primeicons/primeicons.css'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { whenUnauthorized } from './shared'
import { forget } from './auth/session'
import { runLegacyMigration } from './modules/folio/utils/storeStorage'

// A refused request means the session has gone -- expired, or ended somewhere else -- so
// the page stops believing it is signed in and sends the browser to the way back in.
whenUnauthorized(() => {
  forget()

  if (router.currentRoute.value.name !== 'signin') {
    void router.replace({
      name: 'signin',
      query: router.currentRoute.value.fullPath === '/' ? {} : { next: router.currentRoute.value.fullPath },
    })
  }
})

/**
 * The site starts once the app has been mounted.
 *
 * Every store in Folio reads its saved state synchronously the first time it is used, so
 * the server's copy has to be in the browser before the first component asks for it. That
 * is the router's job, once a session says whose budget it is: the first navigation into
 * the app fetches it.
 */
function start() {
  // Storage written under the old names is renamed before anything reads it.
  runLegacyMigration()

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

start()
