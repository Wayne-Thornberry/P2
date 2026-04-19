<script setup lang="ts">
import { ref } from 'vue'
import AppSidebar from './components/AppSidebar.vue'
import BudgetTabs from './components/BudgetTabs.vue'
import TransactionLog from './components/TransactionLog.vue'
import SettingsPage from './components/SettingsPage.vue'
import AccountsPage from './components/AccountsPage.vue'
import ReportsPage from './components/ReportsPage.vue'
import TemplatePage from './components/TemplatePage.vue'
import AboutPage from './components/AboutPage.vue'
import { useSettingsStore } from './stores/settingsStore'

const currentPage      = ref('budget')
const sidebarOpen      = ref(false)
const txMonthFilter    = ref('')
const txAccountFilter  = ref<string | undefined>(undefined)
const txItemFilter     = ref<number | undefined>(undefined)
const txNameFilter     = ref('')
const txTypeFilter     = ref<'all' | 'in' | 'out'>('all')
useSettingsStore()

function navigate(page: string): void {
  sidebarOpen.value = false
  if (page === 'transactions') {
    txMonthFilter.value   = ''
    txAccountFilter.value = undefined
    txItemFilter.value    = undefined
    txNameFilter.value    = ''
    txTypeFilter.value    = 'all'
  }
  currentPage.value = page
}

function onViewTransactions(yearMonth: string): void {
  txMonthFilter.value   = yearMonth
  txAccountFilter.value = undefined
  txItemFilter.value    = undefined
  currentPage.value     = 'transactions'
}

function onViewAccountTransactions(accountId: string): void {
  txMonthFilter.value   = ''
  txAccountFilter.value = accountId
  txItemFilter.value    = undefined
  currentPage.value     = 'transactions'
}

function onViewItemTransactions(itemId: number, yearMonth: string): void {
  txMonthFilter.value   = yearMonth
  txAccountFilter.value = undefined
  txItemFilter.value    = itemId
  txNameFilter.value    = ''
  currentPage.value     = 'transactions'
}

function onReportViewTransactions(opts: { month?: string; accountId?: string; name?: string; type?: 'in' | 'out' }): void {
  txMonthFilter.value   = opts.month ?? ''
  txAccountFilter.value = opts.accountId ?? undefined
  txItemFilter.value    = undefined
  txNameFilter.value    = opts.name ?? ''
  txTypeFilter.value    = opts.type ?? 'all'
  currentPage.value     = 'transactions'
}

const breadcrumbs: Record<string, string> = {
  template: 'Budget › Template',
  budget: 'Budget › Overview',
  transactions: 'Transactions › Log',
  accounts: 'Accounts › Manage',
  reports: 'Reports',
  settings: 'Settings',
  about: 'About',
}
</script>

<template>
  <div class="flex min-h-screen bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 transition-colors duration-200">

    <!-- Mobile backdrop -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-40 bg-black/40 md:hidden"
      @click="sidebarOpen = false"
    />

    <AppSidebar :currentPage="currentPage" :isOpen="sidebarOpen" @navigate="navigate" />

    <!-- Main content -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Page header bar -->
      <div class="h-12 border-b-2 border-zinc-300 dark:border-zinc-600 bg-zinc-200 dark:bg-zinc-800 flex items-center px-3 md:px-6 gap-3">
        <button
          class="md:hidden flex items-center justify-center w-8 h-8 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          @click="sidebarOpen = !sidebarOpen"
          aria-label="Toggle menu"
        >
          <i class="pi pi-bars" />
        </button>
        <span class="text-xs font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">{{ breadcrumbs[currentPage] }}</span>
      </div>

      <!-- Page content -->
      <main class="flex-1 px-3 py-4 sm:px-6 sm:py-8 overflow-auto">
        <BudgetTabs v-if="currentPage === 'budget'" @navigate="currentPage = $event" @viewTransactions="onViewTransactions" @viewItemTransactions="onViewItemTransactions" />
        <TemplatePage v-else-if="currentPage === 'template'" />
        <TransactionLog v-else-if="currentPage === 'transactions'" :monthFilter="txMonthFilter" :accountFilter="txAccountFilter" :itemFilter="txItemFilter" :nameFilter="txNameFilter" :typeFilter="txTypeFilter" />
        <AccountsPage v-else-if="currentPage === 'accounts'" @viewTransactions="onViewAccountTransactions" />
        <ReportsPage  v-else-if="currentPage === 'reports'" @viewTransactions="onReportViewTransactions" />
        <SettingsPage v-else-if="currentPage === 'settings'" />
        <AboutPage    v-else-if="currentPage === 'about'" />
      </main>
    </div>

  </div>
</template>
