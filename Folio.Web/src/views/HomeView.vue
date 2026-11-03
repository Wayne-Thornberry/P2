<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { api, ApiError } from '../shared'
import { pathOf } from '../modules/registry'

/** One of the little apps, as the API describes it. */
interface ModuleSummary {
  name: string
  title: string
  description: string
}

/** An app this build actually has a page for. */
interface Card extends ModuleSummary {
  path: string
}

const cards = ref<Card[]>([])
const error = ref<string | null>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    const catalog = await api.get<ModuleSummary[]>('/api/core/modules')

    // The API says which modules exist; this build says which of them have a page. A
    // module the API knows and the site does not is one halfway through being added, so
    // it is left off the page rather than offered as a link to nowhere.
    cards.value = catalog.flatMap((module) => {
      const path = pathOf(module.name)
      return path === undefined ? [] : [{ ...module, path }]
    })
  } catch (failure) {
    error.value = failure instanceof ApiError ? failure.message : 'The site could not be reached.'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="stack stack--roomy">
    <div>
      <h1>Apps</h1>
      <p class="muted">Small things built for one person, which happens to be you.</p>
    </div>

    <p v-if="loading" class="muted">Loading…</p>

    <p v-else-if="error" class="error" role="alert">{{ error }}</p>

    <p v-else-if="cards.length === 0" class="muted">
      There is nothing here yet. Add a module and it appears on this page by itself.
    </p>

    <ul v-else class="cards">
      <li v-for="card in cards" :key="card.name" class="card">
        <RouterLink class="card__link" :to="card.path">
          <h2>{{ card.title }}</h2>
          <p class="muted">{{ card.description }}</p>
        </RouterLink>
      </li>
    </ul>
  </section>
</template>
