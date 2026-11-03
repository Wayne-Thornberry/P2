<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { signOut } from './shared'
import { refreshSession, signedIn, username } from './state'

const route = useRoute()
const router = useRouter()

/** Folio fills the window; the portal's pages are a column on it. */
const isApp = computed(() => route.path.startsWith('/folio'))

async function leave() {
  await signOut()
  refreshSession()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <div class="site">
    <header class="masthead masthead--bar">
      <div class="masthead__brand">
        <RouterLink class="wordmark" to="/">Folio</RouterLink>
        <p class="tagline">A private budget, kept on your own box</p>
      </div>

      <!-- Who is signed in belongs to the site, not to one page. -->
      <div v-if="signedIn" class="masthead__account">
        <RouterLink class="masthead__who" to="/account">{{ username }}</RouterLink>
        <button type="button" class="button button--quiet" @click="leave">Sign out</button>
      </div>
    </header>

    <main class="content" :class="{ 'content--app': isApp }">
      <RouterView />
    </main>
  </div>
</template>
