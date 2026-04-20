<script setup lang="ts">
import { ref, computed, watch } from 'vue'
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
import SetupScreen from './components/SetupScreen.vue'
import CsvImportDialog from './components/CsvImportDialog.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import { useSettingsStore } from './stores/settingsStore'
import { SUPPORTED_COUNTRIES, getCountryById } from './data/countries'
import { useCsvDrop } from './composables/useCsvDrop'
import { clearAndImport } from './utils/persistence'
import { useConfirm } from './composables/useConfirm'
import type { Transaction } from './types/transaction'

const currentPage      = ref('dashboard')
const activeNavItem    = ref('dashboard')
const sidebarOpen      = ref(false)
const txMonthFilter    = ref('')
const countryMenuOpen  = ref(false)
const txAccountFilter  = ref<string | undefined>(undefined)
const txItemFilter     = ref<number | undefined>(undefined)
const txNameFilter     = ref('')
const txTypeFilter     = ref<'all' | 'in' | 'out'>('all')
const txFocusSearch    = ref(false)
const settings         = useSettingsStore()
const currentCountry   = computed(() => getCountryById(settings.country))

function switchCountry(id: string): void {
  countryMenuOpen.value = false
  if (id === settings.country) return
  settings.setCountry(id)
  window.location.reload()
}
const { isDraggingOver, csvDialogVisible, pendingCsvFiles, backupDropVisible, pendingBackupJson, onDragEnter, onDragOver, onDragLeave, onDrop } = useCsvDrop()
const { confirm } = useConfirm()

// Watch for dropped JSON backup — trigger themed confirm dialog
watch(backupDropVisible, async (show) => {
  if (!show) return
  const ok = await confirm({
    title: 'Restore backup?',
    message: 'This will DELETE all existing data for this country and replace it with the data from the dropped backup file.\n\nThis cannot be undone.',
    confirmLabel: 'Restore',
    danger: true,
  })
  backupDropVisible.value = false
  if (!ok) { pendingBackupJson.value = ''; return }
  confirmBackupRestore()
})

const csvImportMsg   = ref('')
const csvImportCount = ref(0)
let _csvMsgTimer: ReturnType<typeof setTimeout> | null = null

function onCsvDone(count: number): void {
  if (_csvMsgTimer) clearTimeout(_csvMsgTimer)
  csvImportMsg.value   = count > 0 ? `Imported ${count} transaction${count !== 1 ? 's' : ''}.` : 'No new transactions found in file(s).'
  csvImportCount.value = count
  _csvMsgTimer = setTimeout(() => { csvImportMsg.value = ''; csvImportCount.value = 0 }, 4000)
}

function confirmBackupRestore(): void {
  const json = pendingBackupJson.value
  backupDropVisible.value = false
  pendingBackupJson.value = ''
  clearAndImport(json)
}

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
  <div
    class="flex min-h-screen bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 transition-colors duration-200"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >

    <!-- First-run setup overlay -->
    <SetupScreen v-if="!settings.setupComplete" />

    <!-- Global CSV drop overlay -->
    <Transition name="fade">
      <div v-if="isDraggingOver" class="app-drop-overlay">
        <i class="pi pi-upload app-drop-icon" />
        <span class="app-drop-label">Drop to import &mdash; CSV for transactions &middot; JSON to restore backup</span>
      </div>
    </Transition>

    <!-- Global import toast -->
    <Transition name="fade">
      <div v-if="csvImportMsg" class="app-import-toast" :class="csvImportCount > 0 ? 'app-import-toast--ok' : 'app-import-toast--warn'">
        <i :class="csvImportCount > 0 ? 'pi pi-check-circle' : 'pi pi-exclamation-triangle'" />
        {{ csvImportMsg }}
      </div>
    </Transition>

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

        <!-- Country switcher -->
        <div class="relative shrink-0">
          <button
            class="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-bold text-zinc-500 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
            :title="'Current country: ' + (currentCountry?.name ?? '')"
            @click="countryMenuOpen = !countryMenuOpen"
          >
            <span class="text-sm leading-none">{{ currentCountry?.flag }}</span>
            <span class="hidden sm:inline uppercase tracking-wider">{{ currentCountry?.id?.slice(0,3).toUpperCase() }}</span>
            <i class="pi pi-angle-down text-[0.6rem]" />
          </button>

          <!-- Click-outside backdrop -->
          <div v-if="countryMenuOpen" class="fixed inset-0 z-10" @click="countryMenuOpen = false" />

          <!-- Dropdown -->
          <div v-if="countryMenuOpen" class="absolute right-0 top-full mt-1 z-20 bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded shadow-lg overflow-hidden min-w-[11rem]">
            <button
              v-for="c in SUPPORTED_COUNTRIES"
              :key="c.id"
              class="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-left transition-colors"
              :class="c.id === settings.country
                ? 'bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900'
                : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'"
              @click="switchCountry(c.id)"
            >
              <span class="text-base leading-none">{{ c.flag }}</span>
              <span class="flex-1">{{ c.name }}</span>
              <span class="font-mono text-[0.65rem] opacity-60">{{ c.currency }}</span>
            </button>
          </div>
        </div>
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

  <!-- Global CSV import dialog -->
  <CsvImportDialog
    :visible="csvDialogVisible"
    :csvFiles="pendingCsvFiles"
    @close="csvDialogVisible = false"
    @done="onCsvDone"
  />

  <!-- Global themed confirm dialog (handles all confirm() calls including backup restore) -->
  <ConfirmDialog />
</template>

<style scoped>
/* ── Global CSV drop overlay ─────────────────────────────────── */
.app-drop-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
  pointer-events: none;
}

.app-drop-icon {
  font-size: 3rem;
  color: #ffffff;
  opacity: 0.9;
}

.app-drop-label {
  font-size: 1.25rem;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: 0.02em;
}

/* ── Global import toast ─────────────────────────────────────── */
.app-import-toast {
  position: fixed;
  bottom: 1.5rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9100;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1.1rem;
  border-radius: 0.375rem;
  font-size: 0.8rem;
  font-weight: 600;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
  pointer-events: none;
  white-space: nowrap;
}

.app-import-toast--ok {
  background: #16a34a;
  color: #ffffff;
}

.app-import-toast--warn {
  background: #ca8a04;
  color: #ffffff;
}

/* ── Fade transition ─────────────────────────────────────────── */
.fade-enter-active,
.fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from,
.fade-leave-to    { opacity: 0; }
</style>

<!-- Global themed confirm dialog (outside the root div, no z-index conflict) -->
<ConfirmDialog />
