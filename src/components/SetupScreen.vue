<script setup lang="ts">
import { useSettingsStore } from '../stores/settingsStore'
import { SUPPORTED_COUNTRIES } from '../data/countries'

const settings = useSettingsStore()

function choose(countryId: string): void {
  settings.setCountry(countryId)
  // Reload so all stores reinitialize from the correct country-scoped localStorage keys,
  // preventing stale data from a previous country appearing in the new one.
  window.location.reload()
}
</script>

<template>
  <div class="setup-backdrop">
    <div class="setup-card">
      <div class="setup-logo">
        <i class="pi pi-book" />
        <span>Folio</span>
      </div>
      <h1 class="setup-title">Welcome</h1>
      <p class="setup-subtitle">Choose your country to get started. This sets your currency and available banks.</p>

      <div class="setup-country-grid">
        <button
          v-for="c in SUPPORTED_COUNTRIES"
          :key="c.id"
          class="setup-country-btn"
          @click="choose(c.id)"
        >
          <span class="setup-country-flag">{{ c.flag }}</span>
          <span class="setup-country-name">{{ c.name }}</span>
          <span class="setup-country-currency">{{ c.currency }}</span>
        </button>
      </div>

      <p class="setup-note">You can change this later in Settings.</p>
    </div>
  </div>
</template>
