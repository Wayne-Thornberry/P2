<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiError } from '../shared'
import { passwordProblem, pinProblem, usernameProblem } from './rules'
import { account, claimAccount, resetWithPin, signIn } from './session'

const route = useRoute()
const router = useRouter()

type Panel = 'signin' | 'reset'

const panel = ref<Panel>('signin')
const busy = ref(false)
const error = ref('')
const notice = ref('')

const username = ref('')
const password = ref('')
const pin = ref('')
const newPassword = ref('')

// Where to go once this works: the page that sent you here, and never anywhere else.
const next = computed(() => {
  const wanted = route.query.next

  return typeof wanted === 'string' && wanted.startsWith('/') && !wanted.startsWith('//') ? wanted : '/'
})

const claiming = computed(() => account.needsFirstAccount)

watch(
  () => route.name,
  () => {
    // Signing in again after a password was set here: say so, once.
    notice.value = route.query.reset === '1' ? 'That is the new password. Sign in with it.' : ''
  },
)

async function submitSignIn() {
  error.value = ''
  notice.value = ''

  const problem = claiming.value ? usernameProblem(username.value) : null

  if (problem !== null) {
    error.value = problem
    return
  }

  const badPassword = passwordProblem(password.value, username.value)

  if (claiming.value && badPassword !== null) {
    error.value = badPassword
    return
  }

  busy.value = true

  try {
    if (claiming.value) await claimAccount(username.value.trim(), password.value)
    else await signIn(username.value.trim(), password.value)

    await router.replace(next.value)
  } catch (failure) {
    error.value = failure instanceof ApiError ? failure.message : 'The site could not be reached.'
  } finally {
    busy.value = false
  }
}

async function submitReset() {
  error.value = ''
  notice.value = ''

  const problem = usernameProblem(username.value) ?? pinProblem(pin.value) ?? passwordProblem(newPassword.value)

  if (problem !== null) {
    error.value = problem
    return
  }

  busy.value = true

  try {
    await resetWithPin(username.value.trim(), pin.value, newPassword.value)
    await router.replace(next.value)
  } catch (failure) {
    error.value = failure instanceof ApiError ? failure.message : 'The site could not be reached.'
  } finally {
    busy.value = false
  }
}

function show(to: Panel) {
  panel.value = to
  error.value = ''
  notice.value = ''
  pin.value = ''
  newPassword.value = ''
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-zinc-100 dark:bg-zinc-900 p-6">
    <div class="w-full max-w-sm bg-zinc-200 dark:bg-zinc-800 border-2 border-zinc-300 dark:border-zinc-600 p-6 flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <p class="text-xs font-mono text-zinc-400 dark:text-zinc-500">Folio</p>

        <h1 class="text-lg font-black uppercase tracking-tight text-zinc-900 dark:text-zinc-100">
          <template v-if="claiming">Make your account</template>
          <template v-else-if="panel === 'reset'">Set a new password</template>
          <template v-else>Sign in</template>
        </h1>

        <p v-if="claiming" class="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
          This site has no account yet. Pick a username and a password: the budget already here
          becomes yours, and this is the only account that can be made from this page.
        </p>
        <p v-else-if="panel === 'reset'" class="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
          Your PIN is what stands in for a forgotten password. Setting a new one signs every
          other browser out.
        </p>
      </div>

      <form v-if="panel === 'signin'" class="flex flex-col gap-3" @submit.prevent="submitSignIn">
        <label class="flex flex-col gap-1">
          <span class="text-[0.58rem] font-black uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">Username</span>
          <input
            v-model="username"
            name="username"
            autocomplete="username"
            autocapitalize="off"
            spellcheck="false"
            class="px-3 py-2 text-sm bg-white dark:bg-zinc-900 border-2 border-zinc-300 dark:border-zinc-600 outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-[0.58rem] font-black uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">Password</span>
          <input
            v-model="password"
            type="password"
            name="password"
            :autocomplete="claiming ? 'new-password' : 'current-password'"
            class="px-3 py-2 text-sm bg-white dark:bg-zinc-900 border-2 border-zinc-300 dark:border-zinc-600 outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
          />
        </label>

        <p v-if="error" class="text-xs text-red-600 dark:text-red-400" role="alert">{{ error }}</p>
        <p v-if="notice" class="text-xs text-emerald-700 dark:text-emerald-400" role="status">{{ notice }}</p>

        <button
          type="submit"
          :disabled="busy"
          class="px-4 py-2 text-xs font-black uppercase tracking-wide bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900 hover:opacity-90 disabled:opacity-50"
        >
          {{ busy ? 'Working…' : claiming ? 'Make the account' : 'Sign in' }}
        </button>

        <button
          v-if="!claiming"
          type="button"
          class="self-center text-xs text-zinc-500 dark:text-zinc-400 underline hover:text-zinc-900 dark:hover:text-zinc-100"
          @click="show('reset')"
        >
          Forgotten the password?
        </button>
      </form>

      <form v-else class="flex flex-col gap-3" @submit.prevent="submitReset">
        <label class="flex flex-col gap-1">
          <span class="text-[0.58rem] font-black uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">Username</span>
          <input
            v-model="username"
            name="username"
            autocomplete="username"
            autocapitalize="off"
            spellcheck="false"
            class="px-3 py-2 text-sm bg-white dark:bg-zinc-900 border-2 border-zinc-300 dark:border-zinc-600 outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-[0.58rem] font-black uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">PIN</span>
          <input
            v-model="pin"
            name="pin"
            inputmode="numeric"
            maxlength="6"
            autocomplete="off"
            class="px-3 py-2 text-sm bg-white dark:bg-zinc-900 border-2 border-zinc-300 dark:border-zinc-600 outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-[0.58rem] font-black uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">New password</span>
          <input
            v-model="newPassword"
            type="password"
            name="newPassword"
            autocomplete="new-password"
            class="px-3 py-2 text-sm bg-white dark:bg-zinc-900 border-2 border-zinc-300 dark:border-zinc-600 outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
          />
        </label>

        <p v-if="error" class="text-xs text-red-600 dark:text-red-400" role="alert">{{ error }}</p>

        <button
          type="submit"
          :disabled="busy"
          class="px-4 py-2 text-xs font-black uppercase tracking-wide bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900 hover:opacity-90 disabled:opacity-50"
        >
          {{ busy ? 'Working…' : 'Set the new password' }}
        </button>

        <button
          type="button"
          class="self-center text-xs text-zinc-500 dark:text-zinc-400 underline hover:text-zinc-900 dark:hover:text-zinc-100"
          @click="show('signin')"
        >
          Back to signing in
        </button>
      </form>
    </div>
  </div>
</template>
