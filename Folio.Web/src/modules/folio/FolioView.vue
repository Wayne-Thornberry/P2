<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
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
import FinancePage from './components/FinancePage.vue'
import PlannerPage from './components/PlannerPage.vue'
import PerformancePage from './components/PerformancePage.vue'
import CalendarPage   from './components/CalendarPage.vue'
import GlobalSearch from './components/GlobalSearch.vue'
import SetupScreen from './components/SetupScreen.vue'
import CsvImportDialog from './components/CsvImportDialog.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import { useSettingsStore } from './stores/settingsStore'
import { SUPPORTED_COUNTRIES, getCountryById } from './data/countries'
import { useFileDrop } from './composables/useFileDrop'
import { useNavigation } from './composables/useNavigation'
import { clearAndImport } from './utils/persistence'
import { flushSaves } from './workspace'
import { useConfirm } from './composables/useConfirm'

const settings         = useSettingsStore()
const currentCountry   = computed(() => getCountryById(settings.country))

const sidebarOpen      = ref(false)
const countryMenuOpen  = ref(false)
const convCurrStr      = ref('')
const convRateStr      = ref('')

const nav = useNavigation()
const {
  currentPage,
  activeNavItem,
  txMonthFilter,
  txAccountFilter,
  txItemFilter,
  txNameFilter,
  txTypeFilter,
  txFocusSearch,
  reportsInitAccountId,
  reportsInitBreakdownMonth,
  savingsGoalFocusId,
  financeFocusKind,
  financeFocusId,
  goToTransactions,
  onGlobalSearchSelect,
  onViewTransactions,
  onViewTransactionByName,
  onViewAccountTransactions,
  onViewItemTransactions,
  onReportViewTransactions,
  onViewAccountInReports,
  onViewBreakdown,
  onViewSavingsGoal,
  onViewFinance,
} = nav

// Wrap nav.navigate so the mobile sidebar closes on every page change.
function navigate(page: string): void {
  sidebarOpen.value = false
  nav.navigate(page)
}

function applyConversion(): void {
  const rate = parseFloat(convRateStr.value)
  const cur  = convCurrStr.value.trim().toUpperCase()
  if (!rate || rate <= 0 || cur.length < 3) return
  settings.activateConversion(rate, cur)
}

function revertConversion(): void {
  settings.deactivateConversion()
}

const countryLoading = ref(false)

async function switchCountry(id: string): Promise<void> {
  countryMenuOpen.value = false
  if (id === settings.country) return
  settings.setCountry(id)
  // Pre-paint the page background to match the current theme, preventing a white flash on reload
  const dark = ['dark', 'midnight', 'forest', 'purple', 'slate'].includes(settings.theme)
  document.documentElement.style.backgroundColor = dark ? '#18181b' : '#f4f4f5'
  document.documentElement.style.colorScheme     = dark ? 'dark'    : 'light'
  countryLoading.value = true
  // The reload asks the API for the new country's budget, so the choice of country has to
  // be saved before the page goes: otherwise the reload asks for the one it just left.
  await nextTick()
  await flushSaves()
  setTimeout(() => window.location.reload(), 80)
}
const {
  isDraggingOver, csvDialogVisible, pendingCsvFiles, pendingStatement, readingStatement, statementError,
  backupDropVisible, pendingBackupJson, closeImportDialog, onDragEnter, onDragOver, onDragLeave, onDrop,
} = useFileDrop()
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

// A statement that could not be read says why, in the same toast an import result uses.
watch(statementError, (message) => {
  if (!message) return
  if (_csvMsgTimer) clearTimeout(_csvMsgTimer)
  csvImportMsg.value   = message
  csvImportCount.value = 0
  _csvMsgTimer = setTimeout(() => { csvImportMsg.value = '' }, 6000)
})

function confirmBackupRestore(): void {
  const json = pendingBackupJson.value
  backupDropVisible.value = false
  pendingBackupJson.value = ''
  void clearAndImport(json)
}

// ── Breadcrumb ─────────────────────────────────────────────────
interface BreadcrumbSegment {
  label: string
  icon?: string
  page?: string   // if set, this segment is clickable and navigates to that page
}

const PAGE_BREADCRUMBS: Record<string, BreadcrumbSegment[]> = {
  dashboard:    [{ icon: 'pi-home',        label: 'Dashboard'    }],
  calendar:     [{ icon: 'pi-calendar',    label: 'Calendar'     }],
  budget:       [{ icon: 'pi-wallet',      label: 'Budget'       }, { label: 'Overview'      }],
  template:     [{ icon: 'pi-wallet',      label: 'Budget',       page: 'budget' }, { label: 'Template' }],
  transactions: [{ icon: 'pi-list',        label: 'Transactions' }, { label: 'Log'           }],
  accounts:     [{ icon: 'pi-credit-card', label: 'Accounts'     }],
  reports:      [{ icon: 'pi-chart-bar',   label: 'Reports'      }],
  savings:      [{ icon: 'pi-flag',        label: 'Savings Goals' }],
  finance:      [{ icon: 'pi-percentage',  label: 'Finance'       }, { label: 'Loans & Savings' }],
  planner:      [{ icon: 'pi-calculator',  label: 'Quick Calculator' }],
  performance:  [{ icon: 'pi-chart-line',   label: 'Performance' }],
  settings:     [{ icon: 'pi-cog',         label: 'Settings'     }],
  about:        [{ icon: 'pi-info-circle', label: 'About'        }],
}

const breadcrumbSegments = computed(() =>
  PAGE_BREADCRUMBS[activeNavItem.value] ?? [{ label: activeNavItem.value }]
)
</script>

<template>
  <div
    class="flex h-full bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 transition-colors duration-200"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >

    <!-- First-run setup overlay -->
    <SetupScreen v-if="!settings.setupComplete" />

    <!-- Country-switch loading overlay -->
    <Transition name="fade">
      <div v-if="countryLoading" class="app-loading-overlay">
        <i class="pi pi-spin pi-spinner app-loading-spinner" />
        <span class="app-loading-label">Switching country…</span>
      </div>
    </Transition>

    <!-- Global CSV drop overlay -->
    <Transition name="fade">
      <div v-if="isDraggingOver" class="app-drop-overlay">
        <i class="pi pi-upload app-drop-icon" />
        <span class="app-drop-label">Drop to import &mdash; a CSV, a statement PDF, or JSON to restore backup</span>
      </div>
    </Transition>

    <!-- Reading a dropped statement -->
    <Transition name="fade">
      <div v-if="readingStatement" class="app-loading-overlay">
        <i class="pi pi-spin pi-spinner app-loading-spinner" />
        <span class="app-loading-label">Reading the statement&hellip;</span>
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
        <nav class="flex items-center gap-1.5 min-w-0 overflow-hidden shrink" aria-label="Breadcrumb">
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
        <GlobalSearch class="ml-auto min-w-0" @viewTransaction="onGlobalSearchSelect" />

        <!-- FX conversion widget -->
        <div class="fx-widget shrink-0">
          <template v-if="!settings.isConverting">
            <input
              v-model="convCurrStr"
              placeholder="USD"
              maxlength="4"
              class="fx-input fx-input--cur"
              title="Target currency code (e.g. USD)"
              spellcheck="false"
            />
            <input
              v-model="convRateStr"
              placeholder="1.00"
              type="number"
              min="0.000001"
              step="0.0001"
              class="fx-input fx-input--rate"
              title="Conversion rate (multiply by)"
            />
            <button
              class="fx-btn"
              title="Convert all money values"
              @click="applyConversion"
            >FX</button>
          </template>
          <template v-else>
            <span class="fx-active-label">
              {{ settings.conversionCurrency }} &times;{{ settings.conversionRate }}
            </span>
            <button class="fx-btn fx-btn--revert" title="Revert to original currency" @click="revertConversion">
              <i class="pi pi-times" />
            </button>
          </template>
        </div>

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
          @viewSearchFor="(name) => goToTransactions({ name })"
        />
        <CalendarPage      v-else-if="currentPage === 'calendar'" />
        <BudgetTabs v-else-if="currentPage === 'budget'" @navigate="navigate($event)" @viewTransactions="onViewTransactions" @viewItemTransactions="onViewItemTransactions" @viewTransaction="onViewTransactionByName" />
        <TemplatePage v-else-if="currentPage === 'template'" />
        <TransactionLog v-else-if="currentPage === 'transactions'" :monthFilter="txMonthFilter" :accountFilter="txAccountFilter" :itemFilter="txItemFilter" :nameFilter="txNameFilter" :typeFilter="txTypeFilter" :focusSearch="txFocusSearch" />
        <AccountsPage v-else-if="currentPage === 'accounts'" @viewTransactions="onViewAccountTransactions" @viewInReports="onViewAccountInReports" @viewBreakdown="onViewBreakdown" @viewSavingsGoal="onViewSavingsGoal" @viewFinance="onViewFinance" />
        <ReportsPage  v-else-if="currentPage === 'reports'" :initialAccountId="reportsInitAccountId" :initialBreakdownMonth="reportsInitBreakdownMonth" @viewTransactions="onReportViewTransactions" @navigate="navigate" />
        <SavingsGoalsPage v-else-if="currentPage === 'savings'" :focusGoalId="savingsGoalFocusId" />
        <FinancePage          v-else-if="currentPage === 'finance'" :focusKind="financeFocusKind" :focusId="financeFocusId" />
        <PlannerPage         v-else-if="currentPage === 'planner'" />
        <PerformancePage     v-else-if="currentPage === 'performance'" @navigate="navigate" />
        <SettingsPage v-else-if="currentPage === 'settings'" />
        <AboutPage    v-else-if="currentPage === 'about'" />
      </main>
    </div>

  </div>

  <!-- Global transactions import dialog: a CSV the site parsed, or a statement the API read -->
  <CsvImportDialog
    :visible="csvDialogVisible"
    :csvFiles="pendingCsvFiles"
    :statement="pendingStatement"
    @close="closeImportDialog"
    @done="onCsvDone"
  />

  <!-- Global themed confirm dialog (handles all confirm() calls including backup restore) -->
  <ConfirmDialog />
</template>
