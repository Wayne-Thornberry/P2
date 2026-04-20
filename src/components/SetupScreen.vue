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
        <span>ClearBook</span>
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

<style scoped>
.setup-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-zinc-100, #f4f4f5);
}

.dark .setup-backdrop {
  background: var(--color-zinc-900, #18181b);
}

.setup-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.25rem;
  padding: 2.5rem 2rem;
  max-width: 460px;
  width: 100%;
}

.setup-logo {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.1rem;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-zinc-500);
}

.setup-logo i {
  font-size: 1.4rem;
}

.setup-title {
  font-size: 1.5rem;
  font-weight: 900;
  letter-spacing: -0.02em;
  color: var(--color-zinc-900);
  margin: 0;
}

.dark .setup-title {
  color: var(--color-zinc-100);
}

.setup-subtitle {
  font-size: 0.82rem;
  color: var(--color-zinc-500);
  text-align: center;
  margin: 0;
  line-height: 1.55;
  max-width: 320px;
}

.setup-country-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 1rem;
  width: 100%;
  margin-top: 0.5rem;
}

.setup-country-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1.5rem 2rem;
  min-width: 140px;
  border: 2px solid var(--color-zinc-300, #d4d4d8);
  background: transparent;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s, transform 0.1s;
}

.dark .setup-country-btn {
  border-color: var(--color-zinc-700, #3f3f46);
}

.setup-country-btn:hover {
  border-color: var(--color-zinc-900, #18181b);
  background: var(--color-zinc-200, #e4e4e7);
  transform: translateY(-2px);
}

.dark .setup-country-btn:hover {
  border-color: var(--color-zinc-100, #f4f4f5);
  background: var(--color-zinc-800, #27272a);
}

.setup-country-flag {
  font-size: 2.5rem;
  line-height: 1;
}

.setup-country-name {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-zinc-900, #18181b);
}

.dark .setup-country-name {
  color: var(--color-zinc-100, #f4f4f5);
}

.setup-country-currency {
  font-size: 0.65rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-zinc-500, #71717a);
}

.setup-note {
  font-size: 0.7rem;
  color: var(--color-zinc-400, #a1a1aa);
  margin: 0;
}
</style>
