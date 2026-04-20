<script setup lang="ts">
const props = defineProps<{ currentPage: string; isOpen?: boolean }>()
const emit = defineEmits<{ navigate: [page: string] }>()
</script>

<template>
  <aside :class="[
    'flex flex-col w-52 shrink-0 border-r-2 border-zinc-300 dark:border-zinc-600 bg-zinc-200 dark:bg-zinc-800',
    'fixed md:static inset-y-0 left-0 z-50 transition-transform duration-300',
    props.isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
  ]">

    <!-- Brand -->
    <div class="px-5 py-5 border-b-2 border-zinc-300 dark:border-zinc-600">
      <p class="text-lg font-black uppercase tracking-tight text-zinc-900 dark:text-zinc-100 leading-tight">Clearbook</p>
      <p class="text-xs font-mono text-zinc-400 dark:text-zinc-500">Budget Tracker</p>
    </div>

    <!-- Nav -->
    <nav class="flex-1 px-3 py-4 flex flex-col gap-1">
      <a href="#"
        :class="['flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors', props.currentPage === 'dashboard' ? 'bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900' : 'text-zinc-500 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700']"
        @click.prevent="emit('navigate', 'dashboard')">
        <i class="pi pi-home text-xs" />
        Dashboard
      </a>
      <a href="#"
        :class="['flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors', props.currentPage === 'template' ? 'bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900' : 'text-zinc-500 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700']"
        @click.prevent="emit('navigate', 'template')">
        <i class="pi pi-table text-xs" />
        Template
      </a>
      <a href="#"
        :class="['flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors', props.currentPage === 'budget' ? 'bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900' : 'text-zinc-500 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700']"
        @click.prevent="emit('navigate', 'budget')">
        <i class="pi pi-wallet text-xs" />
        Budget
      </a>
      <a href="#"
        :class="['flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors', props.currentPage === 'transactions' ? 'bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900' : 'text-zinc-500 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700']"
        @click.prevent="emit('navigate', 'transactions')">
        <i class="pi pi-list text-xs" />
        Transactions
      </a>
      <a href="#"
        :class="['flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors', props.currentPage === 'accounts' ? 'bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900' : 'text-zinc-500 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700']"
        @click.prevent="emit('navigate', 'accounts')">
        <i class="pi pi-credit-card text-xs" />
        Accounts
      </a>
      <a href="#"
        :class="['flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors', props.currentPage === 'reports' ? 'bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900' : 'text-zinc-500 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700']"
        @click.prevent="emit('navigate', 'reports')">
        <i class="pi pi-chart-bar text-xs" />
        Reports
      </a>
      <a href="#"
        :class="['flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors', props.currentPage === 'savings' ? 'bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900' : 'text-zinc-500 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700']"
        @click.prevent="emit('navigate', 'savings')">
        <i class="pi pi-flag text-xs" />
        Savings Goals
      </a>
      <a href="#"
        :class="['flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors', props.currentPage === 'finance' ? 'bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900' : 'text-zinc-500 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700']"
        @click.prevent="emit('navigate', 'finance')">
        <i class="pi pi-percentage text-xs" />
        Finance
      </a>
      <a href="#"
        :class="['flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors', props.currentPage === 'settings' ? 'bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900' : 'text-zinc-500 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700']"
        @click.prevent="emit('navigate', 'settings')">
        <i class="pi pi-cog text-xs" />
        Settings
      </a>
      <a href="#"
        :class="['flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors', props.currentPage === 'about' ? 'bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900' : 'text-zinc-500 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700']"
        @click.prevent="emit('navigate', 'about')">
        <i class="pi pi-info-circle text-xs" />
        About
      </a>
    </nav>

  </aside>
</template>
