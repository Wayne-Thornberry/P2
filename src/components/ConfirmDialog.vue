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
