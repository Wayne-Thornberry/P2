<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePlannerStore } from '../stores/plannerStore'
import type { SimulationItem } from '../stores/plannerStore'
import { useTransactionStore } from '../stores/transactionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useAccountStore } from '../stores/accountStore'
import { cleanTxName } from '../utils/txNameCleaner'
import { useConfirm } from '../composables/useConfirm'

const store        = usePlannerStore()
const txStore      = useTransactionStore()
const settings     = useSettingsStore()
const accountStore = useAccountStore()
const { confirm }  = useConfirm()

const accountBankIdMap = computed(() =>
  new Map(accountStore.accounts.map(a => [a.id, a.bankId ?? null]))
)

function txClean(tx: { name: string; accountId?: string | null }): string {
  const bankId = tx.accountId ? (accountBankIdMap.value.get(tx.accountId) ?? null) : null
  return cleanTxName(tx.name, bankId)
}

function fmt(v: number): string { return settings.formatMoney(v) }

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatMonth(ym: string): string {
  if (!ym) return ''
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

// ── Top-level tabs ─────────────────────────────────────────────
type Tab = 'quick' | 'month'
const activeTab = ref<Tab>('quick')

// ── Sub-view (list / sim detail) ───────────────────────────────
type View = 'list' | 'sim'
const view        = ref<View>('list')
const activeSimId = ref<number | null>(null)
const activeSim   = computed(() => store.simulations.find(s => s.id === activeSimId.value) ?? null)

function openSim(id: number): void {
  activeSimId.value = id
  view.value = 'sim'
  incomeAddMode.value   = null
  expenseAddMode.value  = null
}
function backToList(): void {
  view.value        = 'list'
  activeSimId.value = null
}

// ── Quick Planner: income ──────────────────────────────────────
const incomeStr = ref(store.income > 0 ? String(store.income) : '')
function applyIncome(): void {
  const v = parseFloat(incomeStr.value)
  if (!isNaN(v) && v >= 0) store.setIncome(v)
}

// ── Quick Planner: commitment add ─────────────────────────────
const showAddForm  = ref(false)
const newName      = ref('')
const newAmountStr = ref('')
function openAdd(): void { showAddForm.value = true; newName.value = ''; newAmountStr.value = '' }
function cancelAdd(): void { showAddForm.value = false }
function submitAdd(): void {
  const name = newName.value.trim()
  const amt  = parseFloat(newAmountStr.value)
  if (!name || isNaN(amt) || amt <= 0) return
  store.addItem(name, amt)
  showAddForm.value = false
}

// ── Quick Planner: commitment edit ────────────────────────────
const editingId  = ref<number | null>(null)
const editName   = ref('')
const editAmtStr = ref('')
function startEdit(id: number, name: string, amount: number): void { editingId.value = id; editName.value = name; editAmtStr.value = String(amount) }
function cancelEdit(): void { editingId.value = null }
function submitEdit(): void {
  const id  = editingId.value
  const amt = parseFloat(editAmtStr.value)
  if (!id || isNaN(amt) || amt <= 0) return
  store.updateItem(id, { name: editName.value, amount: amt })
  editingId.value = null
}
async function removeCommitment(id: number, name: string): Promise<void> {
  const ok = await confirm({ title: 'Remove commitment?', message: `Remove "${name}"?`, confirmLabel: 'Remove', danger: true })
  if (ok) store.removeItem(id)
}

const commitBalances = computed(() => store.runningBalances())
function commitRemainingClass(): string {
  const r = store.remaining()
  return r > 0 ? 'planner-remaining--positive' : r < 0 ? 'planner-remaining--negative' : 'planner-remaining--zero'
}

// ── Month Planner: new sim form ────────────────────────────────
const showNewSimForm = ref(false)
const newSimName     = ref('')
const newSimMonth    = ref(currentMonth())

function openNewSim(): void {
  newSimMonth.value = currentMonth()
  newSimName.value  = formatMonth(newSimMonth.value)
  showNewSimForm.value = true
}
function cancelNewSim(): void { showNewSimForm.value = false }
function submitNewSim(): void {
  const name  = newSimName.value.trim() || formatMonth(newSimMonth.value)
  if (!newSimMonth.value) return
  const sim = store.addSimulation(name, newSimMonth.value)
  showNewSimForm.value = false
  openSim(sim.id)
}
function onNewSimMonthChange(): void {
  newSimName.value = formatMonth(newSimMonth.value)
}

const sortedSimulations = computed(() =>
  [...store.simulations].sort((a, b) => b.month.localeCompare(a.month))
)

async function deleteSim(id: number, name: string): Promise<void> {
  const ok = await confirm({ title: 'Delete simulation?', message: `Delete "${name}"?`, confirmLabel: 'Delete', danger: true })
  if (ok) { store.removeSimulation(id); if (activeSimId.value === id) backToList() }
}

// ── Sim detail: rename ─────────────────────────────────────────
const editingSimName = ref(false)
const editSimNameStr = ref('')
function startEditSimName(): void { if (!activeSim.value) return; editSimNameStr.value = activeSim.value.name; editingSimName.value = true }
function submitEditSimName(): void { if (!activeSim.value || !editSimNameStr.value.trim()) return; store.updateSimulation(activeSim.value.id, { name: editSimNameStr.value }); editingSimName.value = false }
function cancelEditSimName(): void { editingSimName.value = false }
function onSimMonthChange(e: Event): void { if (!activeSim.value) return; store.updateSimulation(activeSim.value.id, { month: (e.target as HTMLInputElement).value }) }

// ── Sim detail: ideal ──────────────────────────────────────────
function toggleIdeal(): void {
  if (!activeSim.value) return
  store.setIdeal(activeSim.value.isIdeal ? null : activeSim.value.id)
}

// ── Sim detail: items split by kind ───────────────────────────
const incomeItems  = computed(() => activeSim.value?.items.filter(i => i.kind === 'income')  ?? [])
const expenseItems = computed(() => activeSim.value?.items.filter(i => i.kind === 'expense') ?? [])

// ── Sim detail: results ────────────────────────────────────────
const totalIncome   = computed(() => incomeItems.value.reduce((s, i) => s + i.amount, 0))
const totalExpenses = computed(() => expenseItems.value.reduce((s, i) => s + i.amount, 0))
const simRemaining  = computed(() => totalIncome.value - totalExpenses.value)

const expenseWaterfall = computed(() => {
  let bal = totalIncome.value
  return expenseItems.value.map(item => { bal -= item.amount; return { item, balance: bal } })
})

function simRemainingClass(): string {
  const r = simRemaining.value
  return r > 0 ? 'planner-remaining--positive' : r < 0 ? 'planner-remaining--negative' : 'planner-remaining--zero'
}

// ── Sim detail: inline edit ────────────────────────────────────
const editingSimItemId  = ref<number | null>(null)
const editSimName       = ref('')
const editSimAmt        = ref('')
function startEditSimItem(item: SimulationItem): void { editingSimItemId.value = item.id; editSimName.value = item.name; editSimAmt.value = String(item.amount) }
function cancelEditSimItem(): void { editingSimItemId.value = null }
function submitEditSimItem(): void {
  const id = editingSimItemId.value; const amt = parseFloat(editSimAmt.value)
  if (!id || !activeSim.value || isNaN(amt) || amt <= 0) return
  store.updateSimulationItem(activeSim.value.id, id, { name: editSimName.value, amount: amt })
  editingSimItemId.value = null
}
async function removeSimItem(itemId: number, name: string): Promise<void> {
  if (!activeSim.value) return
  const ok = await confirm({ title: 'Remove item?', message: `Remove "${name}"?`, confirmLabel: 'Remove', danger: true })
  if (ok) store.removeSimulationItem(activeSim.value!.id, itemId)
}

// ── Sim detail: income add panel ──────────────────────────────
type IncomeAddMode = null | 'form' | 'picker'
const incomeAddMode  = ref<IncomeAddMode>(null)
const incomeFormName = ref('')
const incomeFormAmt  = ref('')
const incomeTxSearch = ref('')

function submitIncomeForm(): void {
  if (!activeSim.value) return
  const name = incomeFormName.value.trim(); const amt = parseFloat(incomeFormAmt.value)
  if (!name || isNaN(amt) || amt <= 0) return
  store.addSimulationItem(activeSim.value.id, name, amt, 'income', 'custom')
  incomeFormName.value = ''; incomeFormAmt.value = ''
}

const addedTxIds = computed(() => {
  if (!activeSim.value) return new Set<number>()
  return new Set(activeSim.value.items.filter(i => i.transactionId != null).map(i => i.transactionId!))
})

const incomeTxList = computed(() => {
  if (!activeSim.value) return []
  const month = activeSim.value.month
  const q = incomeTxSearch.value.toLowerCase().trim()
  return txStore.transactions
    .filter(t => t.date.startsWith(month) && t.type === 'in' && !addedTxIds.value.has(t.id) && (!q || txClean(t).toLowerCase().includes(q)))
    .sort((a, b) => b.amount - a.amount)
})

function addIncomeTx(txId: number, tx: { name: string; accountId?: string | null }, amount: number): void {
  if (!activeSim.value) return
  store.addSimulationItem(activeSim.value.id, txClean(tx), amount, 'income', 'transaction', txId)
}

// ── Sim detail: expense add panel ─────────────────────────────
type ExpenseAddMode = null | 'form' | 'planner' | 'picker'
const expenseAddMode  = ref<ExpenseAddMode>(null)
const expFormName     = ref('')
const expFormAmt      = ref('')
const expTxSearch     = ref('')

function submitExpenseForm(): void {
  if (!activeSim.value) return
  const name = expFormName.value.trim(); const amt = parseFloat(expFormAmt.value)
  if (!name || isNaN(amt) || amt <= 0) return
  store.addSimulationItem(activeSim.value.id, name, amt, 'expense', 'custom')
  expFormName.value = ''; expFormAmt.value = ''
}

const addedPlannerIds = computed(() => {
  if (!activeSim.value) return new Set<number>()
  return new Set(activeSim.value.items.filter(i => i.plannerItemId != null).map(i => i.plannerItemId!))
})

function addFromPlanner(id: number, name: string, amount: number): void {
  if (!activeSim.value) return
  store.addSimulationItem(activeSim.value.id, name, amount, 'expense', 'planner', undefined, id)
}

const expenseTxList = computed(() => {
  if (!activeSim.value) return []
  const month = activeSim.value.month
  const q = expTxSearch.value.toLowerCase().trim()
  return txStore.transactions
    .filter(t => t.date.startsWith(month) && t.type === 'out' && !addedTxIds.value.has(t.id) && (!q || txClean(t).toLowerCase().includes(q)))
    .sort((a, b) => txClean(a).localeCompare(txClean(b)))
})

function addExpenseTx(txId: number, tx: { name: string; accountId?: string | null }, amount: number): void {
  if (!activeSim.value) return
  store.addSimulationItem(activeSim.value.id, txClean(tx), amount, 'expense', 'transaction', txId)
}
</script>

<template>
  <div class="planner-root">

    <!-- ── Page header ──────────────────────────────────────── -->
    <div class="planner-header" v-if="view === 'list'">
      <div>
        <h1 class="planner-title">Planner</h1>
        <p class="planner-subtitle">Plan your income commitments and simulate months ahead.</p>
      </div>
    </div>

    <!-- ── Top tabs (only in list view) ───────────────────────── -->
    <div v-if="view === 'list'" class="planner-tabs">
      <button :class="['planner-tab', activeTab === 'quick' ? 'planner-tab--active' : '']" @click="activeTab = 'quick'">Quick Planner</button>
      <button :class="['planner-tab', activeTab === 'month' ? 'planner-tab--active' : '']" @click="activeTab = 'month'">Month Planner</button>
    </div>

    <!-- ════════════════════════════════════════════════════════ -->
    <!-- QUICK PLANNER TAB                                        -->
    <!-- ════════════════════════════════════════════════════════ -->
    <template v-if="view === 'list' && activeTab === 'quick'">

      <div class="planner-income-row">
        <label class="planner-income-label" for="planner-income">Income</label>
        <div class="planner-income-inputs">
          <input id="planner-income" v-model="incomeStr" type="number" min="0" step="0.01"
            placeholder="e.g. 3200" class="planner-income-input"
            @change="applyIncome" @keydown.enter="applyIncome" />
          <button class="planner-income-apply" @click="applyIncome">Apply</button>
        </div>
      </div>

      <div class="planner-table-wrap">
        <div class="planner-row planner-row--income">
          <span class="planner-row-icon"><i class="pi pi-arrow-circle-down" /></span>
          <span class="planner-row-name">Income</span>
          <span class="planner-row-deduction"></span>
          <span class="planner-row-balance planner-row-balance--income">{{ fmt(store.income) }}</span>
          <span class="planner-row-actions"></span>
        </div>
        <div v-if="store.items.length === 0" class="planner-empty">
          <i class="pi pi-inbox planner-empty-icon" /><p>No commitments yet.</p>
        </div>
        <template v-for="(item, idx) in store.items" :key="item.id">
          <div v-if="editingId === item.id" class="planner-row planner-row--editing">
            <span class="planner-row-icon"><i class="pi pi-minus-circle" /></span>
            <input v-model="editName" type="text" class="planner-edit-name" placeholder="Name" @keydown.enter="submitEdit" @keydown.escape="cancelEdit" />
            <input v-model="editAmtStr" type="number" min="0.01" step="0.01" class="planner-edit-amt" @keydown.enter="submitEdit" @keydown.escape="cancelEdit" />
            <span class="planner-row-balance"></span>
            <span class="planner-row-actions">
              <button class="planner-btn planner-btn--save" @click="submitEdit"><i class="pi pi-check" /></button>
              <button class="planner-btn planner-btn--cancel" @click="cancelEdit"><i class="pi pi-times" /></button>
            </span>
          </div>
          <div v-else class="planner-row planner-row--item" :class="commitBalances[idx] < 0 ? 'planner-row--overdrawn' : ''">
            <span class="planner-row-icon"><i class="pi pi-minus-circle" /></span>
            <span class="planner-row-name">{{ item.name }}</span>
            <span class="planner-row-deduction">−{{ fmt(item.amount) }}</span>
            <span class="planner-row-balance" :class="commitBalances[idx] < 0 ? 'planner-row-balance--negative' : 'planner-row-balance--neutral'">{{ fmt(commitBalances[idx]) }}</span>
            <span class="planner-row-actions">
              <button class="planner-btn planner-btn--move" :disabled="idx === 0" @click="store.moveItem(item.id, 'up')"><i class="pi pi-angle-up" /></button>
              <button class="planner-btn planner-btn--move" :disabled="idx === store.items.length - 1" @click="store.moveItem(item.id, 'down')"><i class="pi pi-angle-down" /></button>
              <button class="planner-btn planner-btn--edit" @click="startEdit(item.id, item.name, item.amount)"><i class="pi pi-pencil" /></button>
              <button class="planner-btn planner-btn--delete" @click="removeCommitment(item.id, item.name)"><i class="pi pi-trash" /></button>
            </span>
          </div>
        </template>
      </div>

      <div v-if="store.income > 0 || store.items.length > 0" class="planner-summary">
        <div class="planner-summary-item"><span class="planner-summary-label">Income</span><span class="planner-summary-value planner-summary-value--income">{{ fmt(store.income) }}</span></div>
        <div class="planner-summary-sep"><i class="pi pi-minus" /></div>
        <div class="planner-summary-item"><span class="planner-summary-label">Committed</span><span class="planner-summary-value planner-summary-value--committed">{{ fmt(store.totalCommitted()) }}</span></div>
        <div class="planner-summary-sep"><i class="pi pi-equals" /></div>
        <div class="planner-summary-item"><span class="planner-summary-label">Remaining</span><span class="planner-summary-value" :class="commitRemainingClass()">{{ fmt(store.remaining()) }}</span></div>
      </div>

      <div class="planner-add-section">
        <div v-if="!showAddForm">
          <button class="planner-add-btn" @click="openAdd"><i class="pi pi-plus" /> Add commitment</button>
        </div>
        <div v-else class="planner-add-form">
          <h3 class="planner-add-form-title">New commitment</h3>
          <div class="planner-add-form-fields">
            <div class="planner-field"><label class="planner-field-label">Name</label><input v-model="newName" type="text" class="planner-field-input" placeholder="e.g. Rent" @keydown.enter="submitAdd" @keydown.escape="cancelAdd" /></div>
            <div class="planner-field"><label class="planner-field-label">Amount</label><input v-model="newAmountStr" type="number" min="0.01" step="0.01" class="planner-field-input" placeholder="e.g. 800" @keydown.enter="submitAdd" @keydown.escape="cancelAdd" /></div>
          </div>
          <div class="planner-add-form-actions">
            <button class="planner-action-btn planner-action-btn--primary" @click="submitAdd">Add</button>
            <button class="planner-action-btn planner-action-btn--ghost" @click="cancelAdd">Cancel</button>
          </div>
        </div>
      </div>

    </template>

    <!-- ════════════════════════════════════════════════════════ -->
    <!-- MONTH PLANNER TAB — SIMULATION LIST                     -->
    <!-- ════════════════════════════════════════════════════════ -->
    <template v-else-if="view === 'list' && activeTab === 'month'">

      <div class="planner-section-header planner-section-header--spaced">
        <div>
          <span class="planner-section-title">Month Planner</span>
          <span class="planner-section-desc">Build what-if scenarios for any month</span>
        </div>
        <button class="planner-new-sim-btn" @click="openNewSim"><i class="pi pi-plus" /> New simulation</button>
      </div>

      <div v-if="showNewSimForm" class="planner-add-form">
        <h3 class="planner-add-form-title">New simulation</h3>
        <div class="planner-add-form-fields">
          <div class="planner-field"><label class="planner-field-label">Month</label><input v-model="newSimMonth" type="month" class="planner-field-input" @change="onNewSimMonthChange" /></div>
          <div class="planner-field"><label class="planner-field-label">Name</label><input v-model="newSimName" type="text" class="planner-field-input" placeholder="e.g. May – Tight" @keydown.enter="submitNewSim" @keydown.escape="cancelNewSim" /></div>
        </div>
        <div class="planner-add-form-actions">
          <button class="planner-action-btn planner-action-btn--primary" @click="submitNewSim">Create</button>
          <button class="planner-action-btn planner-action-btn--ghost" @click="cancelNewSim">Cancel</button>
        </div>
      </div>

      <div v-if="sortedSimulations.length === 0 && !showNewSimForm" class="planner-sim-empty">
        <i class="pi pi-calendar planner-empty-icon" />
        <p>No simulations yet. Create one to model a future month.</p>
      </div>

      <div v-else class="planner-sim-list">
        <div v-for="sim in sortedSimulations" :key="sim.id" class="planner-sim-card" :class="sim.isIdeal ? 'planner-sim-card--ideal' : ''" @click="openSim(sim.id)">
          <div class="planner-sim-card-main">
            <span class="planner-sim-card-month">{{ formatMonth(sim.month) }}</span>
            <div class="planner-sim-card-name-row">
              <span class="planner-sim-card-name">{{ sim.name }}</span>
              <span v-if="sim.isIdeal" class="planner-ideal-badge"><i class="pi pi-star-fill" /> Ideal</span>
            </div>
          </div>
          <div class="planner-sim-card-summary">
            <span class="planner-sim-card-stat">
              <span class="planner-sim-stat-label">Income</span>
              <span class="planner-sim-stat-val planner-sim-stat-val--income">{{ fmt(store.simSummary(sim.id).totalIncome) }}</span>
            </span>
            <span class="planner-sim-card-stat">
              <span class="planner-sim-stat-label">Remaining</span>
              <span class="planner-sim-stat-val" :class="store.simSummary(sim.id).remaining >= 0 ? 'planner-remaining--positive' : 'planner-remaining--negative'">{{ fmt(store.simSummary(sim.id).remaining) }}</span>
            </span>
          </div>
          <div class="planner-sim-card-actions">
            <button class="planner-btn planner-btn--delete" title="Delete" @click.stop="deleteSim(sim.id, sim.name)"><i class="pi pi-trash" /></button>
            <i class="pi pi-angle-right planner-sim-card-arrow" />
          </div>
        </div>
      </div>

    </template>

    <!-- ════════════════════════════════════════════════════════ -->
    <!-- SIMULATION DETAIL — THREE-PANEL VIEW                    -->
    <!-- ════════════════════════════════════════════════════════ -->
    <template v-else-if="view === 'sim' && activeSim">

      <!-- Header -->
      <div class="planner-sim-nav">
        <button class="planner-back-btn" @click="backToList"><i class="pi pi-arrow-left" /> Month Planner</button>
        <div class="planner-sim-title-row">
          <template v-if="editingSimName">
            <input v-model="editSimNameStr" type="text" class="planner-sim-title-input" @keydown.enter="submitEditSimName" @keydown.escape="cancelEditSimName" />
            <button class="planner-btn planner-btn--save" @click="submitEditSimName"><i class="pi pi-check" /></button>
            <button class="planner-btn planner-btn--cancel" @click="cancelEditSimName"><i class="pi pi-times" /></button>
          </template>
          <template v-else>
            <h1 class="planner-sim-title">{{ activeSim.name }}</h1>
            <button class="planner-btn planner-btn--edit" @click="startEditSimName"><i class="pi pi-pencil" /></button>
          </template>
          <button class="planner-ideal-toggle" :class="activeSim.isIdeal ? 'planner-ideal-toggle--active' : ''" @click="toggleIdeal" :title="activeSim.isIdeal ? 'Remove ideal designation' : 'Mark as Ideal month'">
            <i :class="activeSim.isIdeal ? 'pi pi-star-fill' : 'pi pi-star'" />
            {{ activeSim.isIdeal ? 'Ideal month' : 'Mark as Ideal' }}
          </button>
        </div>
        <div class="planner-sim-month-row">
          <i class="pi pi-calendar text-zinc-400 text-xs" />
          <input :value="activeSim.month" type="month" class="planner-sim-month-input" @change="onSimMonthChange" />
        </div>
      </div>

      <!-- Three panels -->
      <div class="sim-panels">

        <!-- ── LEFT: Income panel ─────────────────────────── -->
        <div class="sim-panel sim-panel--income">
          <div class="sim-panel-header">
            <span class="sim-panel-title"><i class="pi pi-arrow-circle-down" /> Income</span>
            <span class="sim-panel-total planner-row-balance--income">{{ fmt(totalIncome) }}</span>
          </div>

          <div class="sim-panel-list">
            <div v-if="incomeItems.length === 0" class="sim-panel-empty">No income added yet.</div>
            <template v-for="item in incomeItems" :key="item.id">
              <div v-if="editingSimItemId === item.id" class="sim-panel-item sim-panel-item--editing">
                <input v-model="editSimName" type="text" class="planner-edit-name" @keydown.enter="submitEditSimItem" @keydown.escape="cancelEditSimItem" />
                <input v-model="editSimAmt" type="number" min="0.01" step="0.01" class="planner-edit-amt" @keydown.enter="submitEditSimItem" @keydown.escape="cancelEditSimItem" />
                <button class="planner-btn planner-btn--save" @click="submitEditSimItem"><i class="pi pi-check" /></button>
                <button class="planner-btn planner-btn--cancel" @click="cancelEditSimItem"><i class="pi pi-times" /></button>
              </div>
              <div v-else class="sim-panel-item">
                <span class="sim-item-name">{{ item.name }}<span v-if="item.source !== 'custom'" class="planner-row-source-badge">{{ item.source === 'transaction' ? 'tx' : 'rec' }}</span></span>
                <span class="sim-item-amount sim-item-amount--income">{{ fmt(item.amount) }}</span>
                <span class="sim-item-actions">
                  <button class="planner-btn planner-btn--edit" @click="startEditSimItem(item)"><i class="pi pi-pencil" /></button>
                  <button class="planner-btn planner-btn--delete" @click="removeSimItem(item.id, item.name)"><i class="pi pi-trash" /></button>
                </span>
              </div>
            </template>
          </div>

          <!-- Income add controls -->
          <div class="sim-panel-add-bar">
            <button class="planner-panel-btn" :class="incomeAddMode === 'form' ? 'planner-panel-btn--active' : ''" @click="incomeAddMode = incomeAddMode === 'form' ? null : 'form'"><i class="pi pi-plus" /> Custom</button>
            <button class="planner-panel-btn" :class="incomeAddMode === 'picker' ? 'planner-panel-btn--active' : ''" @click="incomeAddMode = incomeAddMode === 'picker' ? null : 'picker'"><i class="pi pi-search" /> From log</button>
          </div>

          <div v-if="incomeAddMode === 'form'" class="sim-panel-add-form">
            <input v-model="incomeFormName" type="text" class="planner-field-input" placeholder="Name" @keydown.enter="submitIncomeForm" />
            <input v-model="incomeFormAmt" type="number" min="0.01" step="0.01" class="planner-field-input" placeholder="Amount" @keydown.enter="submitIncomeForm" />
            <button class="planner-action-btn planner-action-btn--primary" @click="submitIncomeForm">Add</button>
          </div>

          <div v-else-if="incomeAddMode === 'picker'" class="sim-panel-picker">
            <input v-model="incomeTxSearch" type="text" class="planner-tx-search-input" placeholder="Search income…" />
            <div v-if="incomeTxList.length === 0" class="planner-panel-empty">No income transactions for {{ formatMonth(activeSim.month) }}{{ incomeTxSearch ? ' matching search' : '' }}.</div>
            <div v-else class="planner-picker-list">
              <div v-for="tx in incomeTxList" :key="tx.id" class="planner-picker-row">
                <span class="planner-picker-name">{{ txClean(tx) }}</span>
                <span class="planner-picker-amt sim-item-amount--income">{{ fmt(tx.amount) }}</span>
                <button class="planner-picker-add-btn" @click="addIncomeTx(tx.id, tx, tx.amount)"><i class="pi pi-plus" /></button>
              </div>
            </div>
          </div>
        </div>

        <!-- ── MIDDLE: Expense panel ──────────────────────── -->
        <div class="sim-panel sim-panel--expense">
          <div class="sim-panel-header">
            <span class="sim-panel-title"><i class="pi pi-minus-circle" /> Expenses</span>
            <span class="sim-panel-total sim-panel-total--expense">{{ fmt(totalExpenses) }}</span>
          </div>

          <div class="sim-panel-list">
            <div v-if="expenseItems.length === 0" class="sim-panel-empty">No expenses added yet.</div>
            <template v-for="item in expenseItems" :key="item.id">
              <div v-if="editingSimItemId === item.id" class="sim-panel-item sim-panel-item--editing">
                <input v-model="editSimName" type="text" class="planner-edit-name" @keydown.enter="submitEditSimItem" @keydown.escape="cancelEditSimItem" />
                <input v-model="editSimAmt" type="number" min="0.01" step="0.01" class="planner-edit-amt" @keydown.enter="submitEditSimItem" @keydown.escape="cancelEditSimItem" />
                <button class="planner-btn planner-btn--save" @click="submitEditSimItem"><i class="pi pi-check" /></button>
                <button class="planner-btn planner-btn--cancel" @click="cancelEditSimItem"><i class="pi pi-times" /></button>
              </div>
              <div v-else class="sim-panel-item">
                <span class="sim-item-name">{{ item.name }}<span v-if="item.source !== 'custom'" class="planner-row-source-badge">{{ item.source === 'transaction' ? 'tx' : 'rec' }}</span></span>
                <span class="sim-item-amount sim-item-amount--expense">{{ fmt(item.amount) }}</span>
                <span class="sim-item-actions">
                  <button class="planner-btn planner-btn--edit" @click="startEditSimItem(item)"><i class="pi pi-pencil" /></button>
                  <button class="planner-btn planner-btn--delete" @click="removeSimItem(item.id, item.name)"><i class="pi pi-trash" /></button>
                </span>
              </div>
            </template>
          </div>

          <!-- Expense add controls -->
          <div class="sim-panel-add-bar">
            <button class="planner-panel-btn" :class="expenseAddMode === 'form' ? 'planner-panel-btn--active' : ''" @click="expenseAddMode = expenseAddMode === 'form' ? null : 'form'"><i class="pi pi-plus" /> Custom</button>
            <button class="planner-panel-btn" :class="expenseAddMode === 'planner' ? 'planner-panel-btn--active' : ''" @click="expenseAddMode = expenseAddMode === 'planner' ? null : 'planner'"><i class="pi pi-list" /> Recurring</button>
            <button class="planner-panel-btn" :class="expenseAddMode === 'picker' ? 'planner-panel-btn--active' : ''" @click="expenseAddMode = expenseAddMode === 'picker' ? null : 'picker'"><i class="pi pi-search" /> From log</button>
          </div>

          <div v-if="expenseAddMode === 'form'" class="sim-panel-add-form">
            <input v-model="expFormName" type="text" class="planner-field-input" placeholder="Name" @keydown.enter="submitExpenseForm" />
            <input v-model="expFormAmt" type="number" min="0.01" step="0.01" class="planner-field-input" placeholder="Amount" @keydown.enter="submitExpenseForm" />
            <button class="planner-action-btn planner-action-btn--primary" @click="submitExpenseForm">Add</button>
          </div>

          <div v-else-if="expenseAddMode === 'planner'" class="sim-panel-picker">
            <div v-if="store.items.length === 0" class="planner-panel-empty">No recurring commitments saved.</div>
            <div v-else class="planner-picker-list">
              <div v-for="item in store.items" :key="item.id" class="planner-picker-row" :class="addedPlannerIds.has(item.id) ? 'planner-picker-row--added' : ''">
                <span class="planner-picker-name">{{ item.name }}</span>
                <span class="planner-picker-amt">{{ fmt(item.amount) }}</span>
                <button v-if="!addedPlannerIds.has(item.id)" class="planner-picker-add-btn" @click="addFromPlanner(item.id, item.name, item.amount)"><i class="pi pi-plus" /></button>
                <span v-else class="planner-picker-added-badge"><i class="pi pi-check" /></span>
              </div>
            </div>
          </div>

          <div v-else-if="expenseAddMode === 'picker'" class="sim-panel-picker">
            <input v-model="expTxSearch" type="text" class="planner-tx-search-input" placeholder="Search expenses…" />
            <div v-if="expenseTxList.length === 0" class="planner-panel-empty">No expense transactions for {{ formatMonth(activeSim.month) }}{{ expTxSearch ? ' matching search' : '' }}.</div>
            <div v-else class="planner-picker-list">
              <div v-for="tx in expenseTxList" :key="tx.id" class="planner-picker-row" :class="addedTxIds.has(tx.id) ? 'planner-picker-row--added' : ''">
                <span class="planner-picker-name">{{ txClean(tx) }}</span>
                <span class="planner-picker-amt">{{ fmt(tx.amount) }}</span>
                <button v-if="!addedTxIds.has(tx.id)" class="planner-picker-add-btn" @click="addExpenseTx(tx.id, tx, tx.amount)"><i class="pi pi-plus" /></button>
                <span v-else class="planner-picker-added-badge"><i class="pi pi-check" /></span>
              </div>
            </div>
          </div>
        </div>

        <!-- ── RIGHT: Results panel ───────────────────────── -->
        <div class="sim-panel sim-panel--results">
          <div class="sim-panel-header">
            <span class="sim-panel-title"><i class="pi pi-chart-bar" /> Results</span>
          </div>

          <!-- Summary -->
          <div class="sim-results-summary">
            <div class="sim-results-row sim-results-row--income">
              <span class="sim-results-label">Income</span>
              <span class="sim-results-value planner-row-balance--income">{{ fmt(totalIncome) }}</span>
            </div>
            <div class="sim-results-row sim-results-row--expenses">
              <span class="sim-results-label">Expenses</span>
              <span class="sim-results-value sim-panel-total--expense">{{ fmt(totalExpenses) }}</span>
            </div>
            <div class="sim-results-divider" />
            <div class="sim-results-row sim-results-row--remaining">
              <span class="sim-results-label">Remaining</span>
              <span class="sim-results-value sim-results-remaining" :class="simRemainingClass()">{{ fmt(simRemaining) }}</span>
            </div>
          </div>

          <!-- Waterfall breakdown -->
          <div v-if="expenseItems.length > 0" class="sim-results-waterfall">
            <div class="sim-waterfall-header">
              <span>Expense</span>
              <span>Balance after</span>
            </div>
            <div class="sim-waterfall-start">
              <span>Start (income)</span>
              <span class="planner-row-balance--income">{{ fmt(totalIncome) }}</span>
            </div>
            <div v-for="row in expenseWaterfall" :key="row.item.id" class="sim-waterfall-row" :class="row.balance < 0 ? 'sim-waterfall-row--overdrawn' : ''">
              <span class="sim-waterfall-name">{{ row.item.name }}</span>
              <span class="sim-waterfall-balance" :class="row.balance < 0 ? 'planner-row-balance--negative' : 'planner-row-balance--neutral'">{{ fmt(row.balance) }}</span>
            </div>
          </div>

          <!-- Ideal designation note -->
          <div v-if="activeSim.isIdeal" class="sim-results-ideal-note">
            <i class="pi pi-star-fill" /> This simulation is your <strong>Ideal Month</strong>. It is used as the reference in the Budget and Performance pages.
          </div>
        </div>

      </div>
    </template>

  </div>
</template>
