<script setup lang="ts">
import { ref, computed } from 'vue'
import AppSidebar from './components/AppSidebar.vue'
import BudgetTabs from './components/BudgetTabs.vue'
import TransactionLog from './components/TransactionLog.vue'
import SettingsPage from './components/SettingsPage.vue'
import AccountsPage from './components/AccountsPage.vue'
import ReportsPage from './components/ReportsPage.vue'
import TemplatePage from './components/TemplatePage.vue'
import AboutPage from './components/AboutPage.vue'
import DashboardPage from './components/DashboardPage.vue'
import SavingsGoalsPage from './components/SavingsGoalsPage.vue'
import GlobalSearch from './components/GlobalSearch.vue'
import { useSettingsStore } from './stores/settingsStore'
import type { Transaction } from './types/transaction'

const currentPage      = ref('dashboard')
const activeNavItem    = ref('dashboard')
const sidebarOpen      = ref(false)
const txMonthFilter    = ref('')
const txAccountFilter  = ref<string | undefined>(undefined)
const txItemFilter     = ref<number | undefined>(undefined)
const txNameFilter     = ref('')
const txTypeFilter     = ref<'all' | 'in' | 'out'>('all')
const txFocusSearch    = ref(false)
useSettingsStore()

function navigate(page: string): void {
  sidebarOpen.value = false
  if (page === 'transactions') {
    txMonthFilter.value   = ''
    txAccountFilter.value = undefined
    txItemFilter.value    = undefined
    txNameFilter.value    = ''
    txTypeFilter.value    = 'all'
    txFocusSearch.value   = false
  }
  activeNavItem.value = page
  currentPage.value = page
}

function onGlobalSearchSelect(tx: Transaction): void {
  txMonthFilter.value   = ''
  txAccountFilter.value = undefined
  txItemFilter.value    = undefined
  txNameFilter.value    = tx.name
  txTypeFilter.value    = 'all'
  txFocusSearch.value   = false
  activeNavItem.value   = 'transactions'
  currentPage.value     = 'transactions'
}

function onViewTransactions(yearMonth: string): void {
  txMonthFilter.value   = yearMonth
  txAccountFilter.value = undefined
  txItemFilter.value    = undefined
  txFocusSearch.value   = false
  activeNavItem.value   = 'transactions'
  currentPage.value     = 'transactions'
}

function onViewAccountTransactions(accountId: string): void {
  txMonthFilter.value   = ''
  txAccountFilter.value = accountId
  txItemFilter.value    = undefined
  txFocusSearch.value   = false
  activeNavItem.value   = 'transactions'
  currentPage.value     = 'transactions'
}

function onViewItemTransactions(itemId: number, yearMonth: string): void {
  txMonthFilter.value   = yearMonth
  txAccountFilter.value = undefined
  txItemFilter.value    = itemId
  txNameFilter.value    = ''
  txFocusSearch.value   = false
  activeNavItem.value   = 'transactions'
  currentPage.value     = 'transactions'
}

function onReportViewTransactions(opts: { month?: string; accountId?: string; name?: string; type?: 'in' | 'out' }): void {
  txMonthFilter.value   = opts.month ?? ''
  txAccountFilter.value = opts.accountId ?? undefined
  txItemFilter.value    = undefined
  txNameFilter.value    = opts.name ?? ''
  txTypeFilter.value    = opts.type ?? 'all'
  txFocusSearch.value   = false
  activeNavItem.value   = 'transactions'
  currentPage.value     = 'transactions'
}

// ── Breadcrumb ─────────────────────────────────────────────────
interface BreadcrumbSegment {
  label: string
  icon?: string
  page?: string   // if set, this segment is clickable and navigates to that page
}

const PAGE_BREADCRUMBS: Record<string, BreadcrumbSegment[]> = {
  dashboard:    [{ icon: 'pi-home',        label: 'Dashboard'    }],
  budget:       [{ icon: 'pi-wallet',      label: 'Budget'       }, { label: 'Overview'      }],
  template:     [{ icon: 'pi-wallet',      label: 'Budget',       page: 'budget' }, { label: 'Template' }],
  transactions: [{ icon: 'pi-list',        label: 'Transactions' }, { label: 'Log'           }],
  accounts:     [{ icon: 'pi-credit-card', label: 'Accounts'     }],
  reports:      [{ icon: 'pi-chart-bar',   label: 'Reports'      }],
  savings:      [{ icon: 'pi-flag',        label: 'Savings Goals'}],
  settings:     [{ icon: 'pi-cog',         label: 'Settings'     }],
  about:        [{ icon: 'pi-info-circle', label: 'About'        }],
}

const breadcrumbSegments = computed(() =>
  PAGE_BREADCRUMBS[activeNavItem.value] ?? [{ label: activeNavItem.value }]
)
</script>

<template>
  <div class="flex min-h-screen bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 transition-colors duration-200">

    <!-- Mobile backdrop -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-40 bg-black/40 md:hidden"
      @click="sidebarOpen = false"
    />

    <AppSidebar :currentPage="activeNavItem" :isOpen="sidebarOpen" @navigate="navigate" />

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

        <!-- Breadcrumb -->
        <nav class="flex items-center gap-1.5 shrink-0" aria-label="Breadcrumb">
          <template v-for="(seg, i) in breadcrumbSegments" :key="i">
            <i v-if="i > 0" class="pi pi-angle-right text-zinc-400 dark:text-zinc-600 text-xs" />
            <i v-if="seg.icon" :class="`pi ${seg.icon} text-zinc-400 dark:text-zinc-500 text-[0.65rem]`" />
            <component
              :is="seg.page ? 'button' : 'span'"
              :class="[
                'text-xs font-black uppercase tracking-widest leading-none transition-colors',
                i === breadcrumbSegments.length - 1
                  ? 'text-zinc-700 dark:text-zinc-200'
                  : 'text-zinc-400 dark:text-zinc-500',
                seg.page ? 'hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer underline-offset-2 hover:underline' : '',
              ]"
              @click="seg.page ? navigate(seg.page) : undefined"
            >{{ seg.label }}</component>
          </template>
        </nav>

        <!-- Global search -->
        <GlobalSearch class="ml-auto" @viewTransaction="onGlobalSearchSelect" />
      </div>

      <!-- Page content -->
      <main class="flex-1 px-3 py-4 sm:px-6 sm:py-8 overflow-auto">
        <DashboardPage
          v-if="currentPage === 'dashboard'"
          @navigate="navigate"
          @viewTransactions="onViewTransactions"
          @viewSearchFor="(name) => { txMonthFilter = ''; txAccountFilter = undefined; txItemFilter = undefined; txNameFilter = name; txTypeFilter = 'all'; txFocusSearch = false; activeNavItem = 'transactions'; currentPage = 'transactions' }"
        />
        <BudgetTabs v-else-if="currentPage === 'budget'" @navigate="currentPage = $event" @viewTransactions="onViewTransactions" @viewItemTransactions="onViewItemTransactions" />
        <TemplatePage v-else-if="currentPage === 'template'" />
        <TransactionLog v-else-if="currentPage === 'transactions'" :monthFilter="txMonthFilter" :accountFilter="txAccountFilter" :itemFilter="txItemFilter" :nameFilter="txNameFilter" :typeFilter="txTypeFilter" :focusSearch="txFocusSearch" />
        <AccountsPage v-else-if="currentPage === 'accounts'" @viewTransactions="onViewAccountTransactions" />
        <ReportsPage  v-else-if="currentPage === 'reports'" @viewTransactions="onReportViewTransactions" />
        <SavingsGoalsPage v-else-if="currentPage === 'savings'" />
        <SettingsPage v-else-if="currentPage === 'settings'" />
        <AboutPage    v-else-if="currentPage === 'about'" />
      </main>
    </div>

  </div>
</template>
