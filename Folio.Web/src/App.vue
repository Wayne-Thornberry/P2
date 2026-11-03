<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'

const route = useRoute()

/** Folio fills the window; the portal's pages are a column on it. */
const isApp = computed(() => route.path.startsWith('/folio'))
</script>

<template>
  <div class="site">
    <main class="content" :class="isApp ? 'content--app' : 'content--portal'">
      <RouterView />
    </main>
  </div>
</template>
