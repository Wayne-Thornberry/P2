import { ref } from 'vue'
import { useSettingsStore } from '../stores/settingsStore'
import type { Transaction } from '../types/transaction'

/**
 * Owns the cross-page navigation state and handlers used by App.vue.
 *
 * Holds:
 *   - the currently rendered page and the highlighted sidebar item
 *   - transient filters consumed by TransactionLog (month / account / item / name / type / focusSearch)
 *   - cross-page focus state for ReportsPage, SavingsGoalsPage and FinancePage
 *
 * Every page-targeted handler resets the filters/focus state for the *other* pages, so
 * the destination always sees a clean slate unless it's the page being navigated to.
 */
export function useNavigation() {
  const settings = useSettingsStore()

  // ── Page state ─────────────────────────────────────────────
  const currentPage   = ref('dashboard')
  const activeNavItem = ref('dashboard')

  // ── Transaction-log filters ────────────────────────────────
  const txMonthFilter   = ref('')
  const txAccountFilter = ref<string | undefined>(undefined)
  const txItemFilter    = ref<number | undefined>(undefined)
  const txNameFilter    = ref('')
  const txTypeFilter    = ref<'all' | 'in' | 'out'>('all')
  const txFocusSearch   = ref(false)

  // ── Cross-page focus state ─────────────────────────────────
  const reportsInitAccountId      = ref<string | undefined>(undefined)
  const reportsInitBreakdownMonth = ref<string | undefined>(undefined)
  const savingsGoalFocusId        = ref<number | undefined>(undefined)
  const financeFocusKind          = ref<'loan' | 'savings' | undefined>(undefined)
  const financeFocusId            = ref<number | undefined>(undefined)

  function _resetTxFilters(): void {
    txMonthFilter.value   = ''
    txAccountFilter.value = undefined
    txItemFilter.value    = undefined
    txNameFilter.value    = ''
    txTypeFilter.value    = 'all'
    txFocusSearch.value   = false
  }

  function _resetCrossPageFocus(): void {
    reportsInitAccountId.value      = undefined
    reportsInitBreakdownMonth.value = undefined
    savingsGoalFocusId.value        = undefined
    financeFocusKind.value          = undefined
    financeFocusId.value            = undefined
  }

  function navigate(page: string): void {
    settings.deactivateConversion()
    if (page === 'transactions') _resetTxFilters()
    _resetCrossPageFocus()
    activeNavItem.value = page
    currentPage.value   = page
  }

  function goToTransactions(opts: {
    month?:     string
    accountId?: string
    itemId?:    number
    name?:      string
    type?:      'all' | 'in' | 'out'
  }): void {
    settings.deactivateConversion()
    txMonthFilter.value   = opts.month ?? ''
    txAccountFilter.value = opts.accountId
    txItemFilter.value    = opts.itemId
    txNameFilter.value    = opts.name ?? ''
    txTypeFilter.value    = opts.type ?? 'all'
    txFocusSearch.value   = false
    activeNavItem.value   = 'transactions'
    currentPage.value     = 'transactions'
  }

  // ── Inbound event handlers ─────────────────────────────────
  function onGlobalSearchSelect(tx: Transaction): void {
    goToTransactions({ name: tx.name })
  }
  function onViewTransactions(yearMonth: string): void {
    goToTransactions({ month: yearMonth })
  }
  function onViewTransactionByName(txName: string, yearMonth: string): void {
    goToTransactions({ month: yearMonth, name: txName })
  }
  function onViewAccountTransactions(accountId: string): void {
    goToTransactions({ accountId })
  }
  function onViewItemTransactions(itemId: number, yearMonth: string): void {
    goToTransactions({ month: yearMonth, itemId })
  }
  function onReportViewTransactions(opts: { month?: string; accountId?: string; name?: string; type?: 'in' | 'out' }): void {
    goToTransactions({ month: opts.month, accountId: opts.accountId, name: opts.name, type: opts.type })
  }

  function onViewAccountInReports(accountId: string): void {
    settings.deactivateConversion()
    reportsInitAccountId.value      = accountId
    reportsInitBreakdownMonth.value = undefined
    activeNavItem.value = 'reports'
    currentPage.value   = 'reports'
  }

  function onViewBreakdown(month: string, accountId: string): void {
    settings.deactivateConversion()
    reportsInitAccountId.value      = accountId
    reportsInitBreakdownMonth.value = month
    activeNavItem.value = 'reports'
    currentPage.value   = 'reports'
  }

  function onViewSavingsGoal(goalId: number): void {
    settings.deactivateConversion()
    savingsGoalFocusId.value = goalId
    activeNavItem.value = 'savings'
    currentPage.value   = 'savings'
  }

  function onViewFinance(kind: 'loan' | 'savings', id: number): void {
    settings.deactivateConversion()
    financeFocusKind.value = kind
    financeFocusId.value   = id
    activeNavItem.value = 'finance'
    currentPage.value   = 'finance'
  }

  return {
    // state
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
    // handlers
    navigate,
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
  }
}
