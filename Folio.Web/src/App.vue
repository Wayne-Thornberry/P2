<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'

const route = useRoute()

/** Folio fills the window; the portal's pages are a column on it. */
const isApp = computed(() => route.path.startsWith('/folio'))
</script>

<template>
  <div class="site">
    <header class="masthead masthead--bar">
      <div class="masthead__brand">
        <RouterLink class="wordmark" to="/">Folio</RouterLink>
        <p class="tagline">A private budget, kept on your own box</p>
      </div>
    </header>

    <main class="content" :class="{ 'content--app': isApp }">
      <RouterView />
    </main>
  </div>
</template>
