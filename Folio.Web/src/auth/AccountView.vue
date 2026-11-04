<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '../shared'
import { passwordProblem, pinProblem } from './rules'
import { account, changePassword, setPin, signOut } from './session'

const router = useRouter()

const error = ref('')
const notice = ref('')
const busy = ref('')

const currentPassword = ref('')
const newPassword = ref('')
const pinPassword = ref('')
const pin = ref('')

// A password somebody was handed is not theirs yet: everything else waits until it is.
const mustChange = computed(() => account.mustChangePassword)

const field = 'px-3 py-2 text-sm bg-white dark:bg-zinc-900 border-2 border-zinc-300 dark:border-zinc-600 outline-none focus:border-zinc-900 dark:focus:border-zinc-100'
const label = 'text-[0.58rem] font-black uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500'
const button = 'px-4 py-2 text-xs font-black uppercase tracking-wide bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900 hover:opacity-90 disabled:opacity-50'

async function savePassword() {
  error.value = ''
  notice.value = ''

  const problem = passwordProblem(newPassword.value, account.username ?? '')

  if (problem !== null) {
    error.value = problem
    return
  }

  busy.value = 'password'

  try {
    const wasForced = mustChange.value

    await changePassword(currentPassword.value, newPassword.value)

    currentPassword.value = ''
    newPassword.value = ''
    notice.value = wasForced ? 'That is your password now.' : 'Your password is changed.'
  } catch (failure) {
    error.value = failure instanceof ApiError ? failure.message : 'The site could not be reached.'
  } finally {
    busy.value = ''
  }
}

async function savePin() {
  error.value = ''
  notice.value = ''

  const problem = pinProblem(pin.value)

  if (problem !== null) {
    error.value = problem
    return
  }

  busy.value = 'pin'

  try {
    await setPin(pinPassword.value, pin.value)

    pinPassword.value = ''
    pin.value = ''
    notice.value = 'The PIN is saved. With it you can set a new password if this one is forgotten.'
  } catch (failure) {
    error.value = failure instanceof ApiError ? failure.message : 'The site could not be reached.'
  } finally {
    busy.value = ''
  }
}

async function leave() {
  await signOut()
  await router.replace({ name: 'signin' })
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-zinc-100 dark:bg-zinc-900 p-6">
    <div class="w-full max-w-md bg-zinc-200 dark:bg-zinc-800 border-2 border-zinc-300 dark:border-zinc-600 p-6 flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <p class="text-xs font-mono text-zinc-400 dark:text-zinc-500">Folio</p>

        <h1 class="text-lg font-black uppercase tracking-tight text-zinc-900 dark:text-zinc-100">Your account</h1>

        <p class="text-xs text-zinc-500 dark:text-zinc-400">
          Signed in as <strong class="text-zinc-800 dark:text-zinc-200">{{ account.username }}</strong>.
        </p>
      </div>

      <p v-if="mustChange" class="text-xs text-amber-700 dark:text-amber-400 leading-relaxed" role="status">
        Your password is one you were given. Choose your own to carry on: nothing else on the
        site opens until you do.
      </p>

      <p v-if="error" class="text-xs text-red-600 dark:text-red-400" role="alert">{{ error }}</p>
      <p v-if="notice" class="text-xs text-emerald-700 dark:text-emerald-400" role="status">{{ notice }}</p>

      <form class="flex flex-col gap-3" @submit.prevent="savePassword">
        <h2 class="text-xs font-black uppercase tracking-wide text-zinc-900 dark:text-zinc-100">
          {{ mustChange ? 'Choose your password' : 'Change your password' }}
        </h2>

        <label class="flex flex-col gap-1">
          <span :class="label">{{ mustChange ? 'The password you were given' : 'Your password now' }}</span>
          <input v-model="currentPassword" type="password" autocomplete="current-password" :class="field" />
        </label>

        <label class="flex flex-col gap-1">
          <span :class="label">New password</span>
          <input v-model="newPassword" type="password" autocomplete="new-password" :class="field" />
        </label>

        <button type="submit" :disabled="busy === 'password'" :class="button">
          {{ busy === 'password' ? 'Saving…' : 'Save the password' }}
        </button>
      </form>

      <template v-if="!mustChange">
        <form class="flex flex-col gap-3" @submit.prevent="savePin">
          <h2 class="text-xs font-black uppercase tracking-wide text-zinc-900 dark:text-zinc-100">
            {{ account.hasPin ? 'Change the PIN' : 'Set a PIN' }}
          </h2>

          <p class="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
            Six digits is all it takes to set a new password on the sign-in page when you have
            forgotten this one. It is the second way in, so it is worth keeping somewhere other
            than the password.
          </p>

          <label class="flex flex-col gap-1">
            <span :class="label">Your password</span>
            <input v-model="pinPassword" type="password" autocomplete="current-password" :class="field" />
          </label>

          <label class="flex flex-col gap-1">
            <span :class="label">PIN</span>
            <input v-model="pin" inputmode="numeric" maxlength="6" autocomplete="off" :class="field" />
          </label>

          <button type="submit" :disabled="busy === 'pin'" :class="button">
            {{ busy === 'pin' ? 'Saving…' : account.hasPin ? 'Save the PIN' : 'Set the PIN' }}
          </button>
        </form>

        <div class="flex items-center justify-between border-t-2 border-zinc-300 dark:border-zinc-600 pt-3">
          <RouterLink
            to="/"
            class="text-xs text-zinc-500 dark:text-zinc-400 underline hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Back to the budget
          </RouterLink>

          <button
            type="button"
            class="text-xs text-zinc-500 dark:text-zinc-400 underline hover:text-zinc-900 dark:hover:text-zinc-100"
            @click="leave"
          >
            Sign out
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
