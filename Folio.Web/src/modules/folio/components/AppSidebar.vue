<script setup lang="ts">
const props = defineProps<{ currentPage: string; isOpen?: boolean }>()
const emit = defineEmits<{ navigate: [page: string] }>()

const sections = [
  {
    label: null,
    items: [
      { page: 'dashboard', icon: 'pi-home',     label: 'Dashboard' },
    ],
  },
  {
    label: 'Planning',
    items: [
      { page: 'budget',   icon: 'pi-wallet',   label: 'Budget' },
      { page: 'calendar', icon: 'pi-calendar', label: 'Calendar' },
      { page: 'template', icon: 'pi-table',    label: 'Template' },
    ],
  },
  {
    label: 'Money',
    items: [
      { page: 'transactions', icon: 'pi-list',        label: 'Transactions' },
      { page: 'accounts',     icon: 'pi-credit-card', label: 'Accounts' },
      { page: 'savings',      icon: 'pi-flag',        label: 'Savings Goals' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { page: 'reports',     icon: 'pi-chart-bar',  label: 'Reports' },
      { page: 'performance', icon: 'pi-chart-line', label: 'Performance' },
    ],
  },
  {
    label: 'Tools',
    items: [
      { page: 'finance', icon: 'pi-percentage', label: 'Finance' },
      { page: 'planner', icon: 'pi-calculator', label: 'Quick Calc' },
    ],
  },
]

const bottomItems = [
  { page: 'settings', icon: 'pi-cog',          label: 'Settings' },
  { page: 'about',    icon: 'pi-info-circle',  label: 'About' },
]
</script>

<template>
  <aside :class="[
    'flex flex-col w-56 shrink-0 border-r-2 border-zinc-300 dark:border-zinc-600 bg-zinc-200 dark:bg-zinc-800',
    'fixed md:sticky md:top-0 md:h-screen inset-y-0 left-0 z-50 transition-transform duration-300',
    props.isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
  ]">

    <!-- Brand -->
    <button
      class="px-5 py-5 border-b-2 border-zinc-300 dark:border-zinc-600 text-left w-full hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors shrink-0"
      @click="emit('navigate', 'dashboard')"
    >
      <p class="text-lg font-black uppercase tracking-tight text-zinc-900 dark:text-zinc-100 leading-tight">Folio</p>
      <p class="text-xs font-mono text-zinc-400 dark:text-zinc-500">Personal Finance</p>
    </button>

    <!-- Main nav — scrollable if screen is short -->
    <nav class="flex-1 overflow-y-auto flex flex-col py-2 min-h-0">

      <template v-for="section in sections" :key="section.label ?? '_top'">
        <!-- Section label -->
        <p v-if="section.label" class="px-4 pt-3 pb-1 text-[0.58rem] font-black uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500 select-none">
          {{ section.label }}
        </p>

        <!-- Nav items -->
        <a
          v-for="item in section.items"
          :key="item.page"
          href="#"
          :class="[
            'flex items-center gap-2.5 px-4 py-[0.42rem] text-[0.8rem] font-semibold transition-colors',
            props.currentPage === item.page
              ? 'bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900'
              : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-100',
          ]"
          @click.prevent="emit('navigate', item.page)"
        >
          <i :class="['pi', item.icon, 'text-[0.75rem] shrink-0']" />
          {{ item.label }}
        </a>
      </template>

    </nav>

    <!-- Bottom items: always pinned, never scrolled away -->
    <div class="border-t-2 border-zinc-300 dark:border-zinc-600 py-1 shrink-0">
      <a
        v-for="item in bottomItems"
        :key="item.page"
        href="#"
        :class="[
          'flex items-center gap-2.5 px-4 py-[0.42rem] text-[0.8rem] font-semibold transition-colors',
          props.currentPage === item.page
            ? 'bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900'
            : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-100',
        ]"
        @click.prevent="emit('navigate', item.page)"
      >
        <i :class="['pi', item.icon, 'text-[0.75rem] shrink-0']" />
        {{ item.label }}
      </a>
    </div>

  </aside>
</template>
