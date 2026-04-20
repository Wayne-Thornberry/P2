<script setup lang="ts">
import { computed } from 'vue'
import { useConfirmDialog } from '../composables/useConfirm'

const { pending } = useConfirmDialog()

const options  = computed(() => pending.value?.options)
const visible  = computed(() => pending.value !== null)

function choose(result: boolean): void {
  const p = pending.value
  if (!p) return
  pending.value = null
  p.resolve(result)
}
</script>

<template>
  <Transition name="confirm-fade">
    <div v-if="visible" class="confirm-overlay" @mousedown.self="choose(false)">
      <div class="confirm-dialog" role="dialog" aria-modal="true">
        <p class="confirm-title">{{ options?.title }}</p>
        <p class="confirm-body">{{ options?.message }}</p>
        <div class="confirm-actions">
          <button class="confirm-btn confirm-btn-ghost" @click="choose(false)">
            {{ options?.cancelLabel ?? 'Cancel' }}
          </button>
          <button
            class="confirm-btn"
            :class="options?.danger ? 'confirm-btn-danger' : 'confirm-btn-primary'"
            @click="choose(true)"
          >
            {{ options?.confirmLabel ?? 'Confirm' }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.confirm-dialog {
  background: white;
  border: 2px solid var(--color-zinc-900);
  padding: 1.5rem;
  max-width: 420px;
  width: calc(100% - 2rem);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}

.dark .confirm-dialog {
  background: var(--color-zinc-900);
  border-color: var(--color-zinc-200);
}

.confirm-title {
  font-size: 0.72rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin: 0 0 0.6rem;
  color: var(--color-zinc-900);
}

.dark .confirm-title {
  color: var(--color-zinc-100);
}

.confirm-body {
  font-size: 0.8rem;
  color: var(--color-zinc-600);
  line-height: 1.55;
  margin: 0 0 1.5rem;
  white-space: pre-line;
}

.dark .confirm-body {
  color: var(--color-zinc-400);
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.confirm-btn {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.45rem 1rem;
  border: 2px solid transparent;
  cursor: pointer;
  transition: background-color 0.12s, border-color 0.12s;
}

.confirm-btn-ghost {
  background: transparent;
  border-color: var(--color-zinc-400);
  color: var(--color-zinc-600);
}
.confirm-btn-ghost:hover {
  border-color: var(--color-zinc-600);
  color: var(--color-zinc-900);
}
.dark .confirm-btn-ghost {
  border-color: var(--color-zinc-500);
  color: var(--color-zinc-400);
}
.dark .confirm-btn-ghost:hover {
  border-color: var(--color-zinc-300);
  color: var(--color-zinc-100);
}

.confirm-btn-primary {
  background: var(--color-zinc-900);
  border-color: var(--color-zinc-900);
  color: #ffffff;
}
.confirm-btn-primary:hover {
  background: var(--color-zinc-700);
  border-color: var(--color-zinc-700);
}
.dark .confirm-btn-primary {
  background: var(--color-zinc-100);
  border-color: var(--color-zinc-100);
  color: var(--color-zinc-900);
}
.dark .confirm-btn-primary:hover {
  background: var(--color-zinc-300);
  border-color: var(--color-zinc-300);
}

.confirm-btn-danger {
  background: #dc2626;
  border-color: #dc2626;
  color: #ffffff;
}
.confirm-btn-danger:hover {
  background: #b91c1c;
  border-color: #b91c1c;
}

/* transition */
.confirm-fade-enter-active,
.confirm-fade-leave-active { transition: opacity 0.15s ease; }
.confirm-fade-enter-from,
.confirm-fade-leave-to    { opacity: 0; }
</style>
