<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError, changePassword, problemWithNewPassword, signOut } from '../shared'
import { refreshSession, username } from '../state'

const router = useRouter()

const current = ref('')
const next = ref('')
const confirm = ref('')
const error = ref<string | null>(null)
const done = ref(false)
const busy = ref(false)

async function submit() {
  if (busy.value) return

  const problem = problemWithNewPassword(next.value, confirm.value)
  if (problem !== null) {
    error.value = problem
    return
  }

  busy.value = true
  error.value = null
  done.value = false

  try {
    // The API signs out every other browser and hands this one a new token; the client
    // stores it, so this page stays signed in.
    await changePassword(current.value, next.value)
    refreshSession()

    current.value = ''
    next.value = ''
    confirm.value = ''
    done.value = true
  } catch (failure) {
    error.value = failure instanceof ApiError ? failure.message : 'The site could not be reached.'
  } finally {
    busy.value = false
  }
}

async function leave() {
  await signOut()
  refreshSession()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <section class="stack stack--roomy">
    <div>
      <h1>Account</h1>
      <p class="muted">Signed in as {{ username }}.</p>
    </div>

    <form class="panel stack" @submit.prevent="submit">
      <h2>Change password</h2>
      <p class="muted">Every other browser is signed out when this changes.</p>

      <label class="field">
        <span>Current password</span>
        <input v-model="current" name="currentPassword" type="password" autocomplete="current-password" required />
      </label>

      <label class="field">
        <span>New password</span>
        <input v-model="next" name="newPassword" type="password" autocomplete="new-password" required />
      </label>

      <label class="field">
        <span>New password again</span>
        <input v-model="confirm" name="confirmPassword" type="password" autocomplete="new-password" required />
      </label>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-else-if="done" class="notice" role="status">Password changed.</p>

      <div class="row row--end">
        <button type="submit" class="button" :disabled="busy">
          {{ busy ? 'Saving…' : 'Change password' }}
        </button>
      </div>
    </form>

    <div>
      <button type="button" class="button button--quiet" @click="leave">Sign out</button>
    </div>
  </section>
</template>
