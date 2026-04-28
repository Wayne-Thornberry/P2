# Copilot Instructions — Folio

Folio is a **privacy-first, offline personal budget tracker** built with Vue 3 + TypeScript. All data lives in `localStorage` only. There are no backend API calls, no auth, and no external data services.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Vue 3 (Composition API, `<script setup lang="ts">`) |
| Language | TypeScript (strict) |
| State | Pinia — **setup-store style** only |
| UI | PrimeVue 4 + Tailwind CSS 4 |
| Charts | Chart.js |
| Build | Vite |
| Persistence | `localStorage` with `folio_` prefixed keys |

---

## Project Conventions

### Vue Components
- Always use `<script setup lang="ts">` — never Options API or class components.
- Keep component templates clean; extract repeated logic to composables or computed properties.
- Components live in `src/components/`. One component per file, PascalCase filename.
- Scoped styles go in `src/styles/<feature>.css` — do not add `<style>` blocks inside `.vue` files unless absolutely necessary.

### Pinia Stores
- All stores use the **setup-store** pattern (`defineStore('id', () => { ... })`).
- Store files live in `src/stores/<feature>Store.ts` and export a `useXxxStore` composable.
- Persist state to `localStorage` inside a `watch` within the store. Use the `folio_<feature>` key convention (include country suffix where relevant, e.g. `folio_budget_IE`).
- Keep raw storage reads in a private `_loadXxx()` helper at the top of the store.

### Composables
- Composables live in `src/composables/useXxx.ts` and are named `useXxx`.
- Prefer `shallowRef` over `ref` for object/array state that is replaced wholesale.

### TypeScript / Types
- Shared domain types live in `src/types/`. Add new types there — do not inline complex interfaces in components or stores.
- Use `type` imports (`import type { ... }`) wherever the value is only used as a type.
- Prefer `interface` for object shapes and `type` for unions/aliases.

### Utilities & Adapters
- Pure utility functions go in `src/utils/`.
- Each CSV bank adapter must implement the `CsvAdapter` interface from `src/utils/csvAdapters.ts`.
- Adapters live in `src/utils/adapters/` and are registered in `src/utils/csvUtils.ts`.

### Naming
| Thing | Convention |
|-------|-----------|
| Components | `PascalCase.vue` |
| Stores | `useXxxStore` → `xxxStore.ts` |
| Composables | `useXxx` → `useXxx.ts` |
| Types/Interfaces | `PascalCase` |
| Private store helpers | `_camelCase` |
| localStorage keys | `folio_<feature>[_<country>]` |

### Code Style
- Section dividers inside large files use `// ── Section Name ───────────...` (em-dash ruler pattern).
- Prefer `const` over `let`; never use `var`.
- Avoid default exports — use named exports everywhere.
- No `console.log` in production code.

---

## Architecture Reminders

- **No network requests** of any kind. The app is fully offline.
- **Multi-country support**: country is stored in `settingsStore` as an ISO code and influences localStorage key namespacing.
- **Data versioning**: export/import format is versioned (`EXPORT_VERSION`). When adding new fields to persisted data, handle missing values gracefully (backwards-compatible reads).
- **Currency conversion** is an opt-in display-layer feature (`settingsStore.activateConversion`) — it never mutates stored amounts.
- The `useConfirm` composable is the app-wide mechanism for destructive-action dialogs — always prefer it over `window.confirm`.

---

## What to Avoid

- Do not add `vue-router` — navigation is handled by a `currentPage` ref in `App.vue`.
- Do not add any authentication, user accounts, or server-side persistence.
- Do not use `localStorage` keys that don't start with `folio_` (legacy `clearbook_` and `p2_` keys exist only for one-time migration).
- Do not use the Options API or `defineComponent` wrapper.
- Do not add `<style>` blocks to `.vue` files; use the corresponding `src/styles/*.css` file.
