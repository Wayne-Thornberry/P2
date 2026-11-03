<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { ApiError, login, problemWithNewPassword, resetPassword } from '../shared'
import { safeReturn } from '../returnPath'

const route = useRoute()

const mode = ref<'signin' | 'reset'>('signin')

const username = ref('')
const password = ref('')

const recoveryCode = ref('')
const newPassword = ref('')
const confirm = ref('')

const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const busy = ref(false)

async function signIn() {
  if (busy.value) return

  busy.value = true
  error.value = null

  try {
    // The client stores the session, so every app on the site is signed in too.
    await login(username.value.trim(), password.value)

    // A whole page load rather than a route change: the budget is fetched before the app
    // starts, and it is fetched for the account that has just signed in. `?return=` comes
    // from the address bar, so it is checked before it is used.
    window.location.assign(safeReturn(route.query.return))
  } catch (failure) {
    error.value = failure instanceof ApiError ? failure.message : 'The site could not be reached.'
  } finally {
    busy.value = false
  }
}

async function reset() {
  if (busy.value) return

  const problem = problemWithNewPassword(newPassword.value, confirm.value)
  if (problem !== null) {
    error.value = problem
    return
  }

  busy.value = true
  error.value = null

  try {
    await resetPassword(username.value.trim(), recoveryCode.value, newPassword.value)

    // Back to the sign-in form with the username kept: the new password is what to use.
    password.value = ''
    recoveryCode.value = ''
    newPassword.value = ''
    confirm.value = ''
    mode.value = 'signin'
    notice.value = 'Password changed. Sign in with the new one.'
  } catch (failure) {
    error.value = failure instanceof ApiError ? failure.message : 'The site could not be reached.'
  } finally {
    busy.value = false
  }
}

function switchTo(next: 'signin' | 'reset') {
  mode.value = next
  error.value = null
  notice.value = null
}
</script>

<template>
  <section class="panel panel--narrow">
    <template v-if="mode === 'signin'">
      <h1>Sign in</h1>
      <p class="muted">One password for everything on this site.</p>

      <form class="stack" @submit.prevent="signIn">
        <label class="field">
          <span>Username</span>
          <input v-model="username" name="username" autocomplete="username" autocapitalize="none" required />
        </label>

        <label class="field">
          <span>Password</span>
          <input v-model="password" name="password" type="password" autocomplete="current-password" required />
        </label>

        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p v-else-if="notice" class="notice" role="status">{{ notice }}</p>

        <button type="submit" class="button" :disabled="busy">
          {{ busy ? 'Signing in…' : 'Sign in' }}
        </button>

        <button type="button" class="linkish" @click="switchTo('reset')">Forgotten the password?</button>
      </form>
    </template>

    <template v-else>
      <h1>Reset password</h1>
      <p class="muted">Needs the recovery code, which is in the site's configuration.</p>

      <form class="stack" @submit.prevent="reset">
        <label class="field">
          <span>Username</span>
          <input v-model="username" name="resetUsername" autocomplete="username" autocapitalize="none" required />
        </label>

        <label class="field">
          <span>Recovery code</span>
          <input v-model="recoveryCode" name="recoveryCode" autocomplete="off" required />
        </label>

        <label class="field">
          <span>New password</span>
          <input v-model="newPassword" name="resetPassword" type="password" autocomplete="new-password" required />
        </label>

        <label class="field">
          <span>New password again</span>
          <input v-model="confirm" name="resetConfirm" type="password" autocomplete="new-password" required />
        </label>

        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <button type="submit" class="button" :disabled="busy">
          {{ busy ? 'Resetting…' : 'Reset password' }}
        </button>

        <button type="button" class="linkish" @click="switchTo('signin')">Back to sign in</button>
      </form>
    </template>
  </section>
</template>
