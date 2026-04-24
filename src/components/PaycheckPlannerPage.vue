<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePlannerStore } from '../stores/plannerStore'
import type { SimulationItem } from '../stores/plannerStore'
import { useTransactionStore } from '../stores/transactionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useConfirm } from '../composables/useConfirm'

const store   = usePlannerStore()
const txStore = useTransactionStore()
const settings = useSettingsStore()
const { confirm } = useConfirm()

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

// ── View state ─────────────────────────────────────────────────
type View = 'list' | 'sim'
const view        = ref<View>('list')
const activeSimId = ref<number | null>(null)
const activeSim   = computed(() => store.simulations.find(s => s.id === activeSimId.value) ?? null)

function openSim(id: number): void {
  activeSimId.value = id
  view.value        = 'sim'
  addPanelMode.value = null
}
function backToList(): void {
  view.value        = 'list'
  activeSimId.value = null
}

// ── Commitment: income input ───────────────────────────────────
const incomeStr = ref(store.income > 0 ? String(store.income) : '')
function applyIncome(): void {
  const v = parseFloat(incomeStr.value)
  if (!isNaN(v) && v >= 0) store.setIncome(v)
}

// ── Commitment: add form ───────────────────────────────────────
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

// ── Commitment: inline edit ────────────────────────────────────
const editingId  = ref<number | null>(null)
const editName   = ref('')
const editAmtStr = ref('')

function startEdit(id: number, name: string, amount: number): void {
  editingId.value  = id
  editName.value   = name
  editAmtStr.value = String(amount)
}
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

// ── New simulation form ────────────────────────────────────────
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
  const month = newSimMonth.value
  if (!month) return
  const sim = store.addSimulation(name, month)
  showNewSimForm.value = false
  openSim(sim.id)
}

// Watch month picker to auto-update name if user hasn't customised it
function onNewSimMonthChange(): void {
  const auto = formatMonth(newSimMonth.value)
  if (!newSimName.value || newSimName.value === formatMonth(newSimMonth.value.replace(/\d$/, String(Number(newSimMonth.value.slice(-1)) - 1)))) {
    newSimName.value = auto
  }
}

const sortedSimulations = computed(() =>
  [...store.simulations].sort((a, b) => b.month.localeCompare(a.month))
)

async function deleteSim(id: number, name: string): Promise<void> {
  const ok = await confirm({ title: 'Delete simulation?', message: `Delete "${name}"? This cannot be undone.`, confirmLabel: 'Delete', danger: true })
  if (ok) {
    store.removeSimulation(id)
    if (activeSimId.value === id) backToList()
  }
}

// ── Simulation: name edit ──────────────────────────────────────
const editingSimName = ref(false)
const editSimNameStr = ref('')

function startEditSimName(): void {
  if (!activeSim.value) return
  editSimNameStr.value = activeSim.value.name
  editingSimName.value = true
}
function submitEditSimName(): void {
  if (!activeSim.value || !editSimNameStr.value.trim()) return
  store.updateSimulation(activeSim.value.id, { name: editSimNameStr.value })
  editingSimName.value = false
}
function cancelEditSimName(): void { editingSimName.value = false }

function onSimMonthChange(e: Event): void {
  if (!activeSim.value) return
  store.updateSimulation(activeSim.value.id, { month: (e.target as HTMLInputElement).value })
}

// ── Simulation: income suggestions ────────────────────────────
const addedTxIds = computed(() => {
  if (!activeSim.value) return new Set<number>()
  return new Set(activeSim.value.items.filter(i => i.transactionId != null).map(i => i.transactionId!))
})

const incomeSuggestions = computed(() => {
  if (!activeSim.value) return []
  const month = activeSim.value.month
  return txStore.transactions
    .filter(t => t.date.startsWith(month) && t.type === 'in' && !addedTxIds.value.has(t.id))
    .sort((a, b) => b.amount - a.amount)
})

function addSuggestion(txId: number, name: string, amount: number): void {
  if (!activeSim.value) return
  store.addSimulationItem(activeSim.value.id, name, amount, 'income', 'transaction', txId)
}

// ── Simulation: waterfall ──────────────────────────────────────
const simBalances = computed(() => activeSim.value ? store.simRunningBalances(activeSim.value.id) : [])
const simSummary  = computed(() => activeSim.value ? store.simSummary(activeSim.value.id) : { totalIncome: 0, totalExpenses: 0, remaining: 0 })

function simRemainingClass(): string {
  const r = simSummary.value.remaining
  return r > 0 ? 'planner-remaining--positive' : r < 0 ? 'planner-remaining--negative' : 'planner-remaining--zero'
}

// ── Simulation: inline edit ────────────────────────────────────
const editingSimItemId   = ref<number | null>(null)
const editSimItemName    = ref('')
const editSimItemAmtStr  = ref('')
const editSimItemKind    = ref<SimulationItem['kind']>('expense')

function startEditSimItem(item: SimulationItem): void {
  editingSimItemId.value  = item.id
  editSimItemName.value   = item.name
  editSimItemAmtStr.value = String(item.amount)
  editSimItemKind.value   = item.kind
}
function cancelEditSimItem(): void { editingSimItemId.value = null }
function submitEditSimItem(): void {
  const id  = editingSimItemId.value
  const amt = parseFloat(editSimItemAmtStr.value)
  if (!id || !activeSim.value || isNaN(amt) || amt <= 0) return
  store.updateSimulationItem(activeSim.value.id, id, { name: editSimItemName.value, amount: amt, kind: editSimItemKind.value })
  editingSimItemId.value = null
}

async function removeSimItem(itemId: number, name: string): Promise<void> {
  if (!activeSim.value) return
  const ok = await confirm({ title: 'Remove item?', message: `Remove "${name}" from the simulation?`, confirmLabel: 'Remove', danger: true })
  if (ok) store.removeSimulationItem(activeSim.value!.id, itemId)
}

// ── Add panel ──────────────────────────────────────────────────
type AddPanelMode = null | 'custom' | 'planner' | 'transactions'
const addPanelMode = ref<AddPanelMode>(null)

function togglePanel(mode: AddPanelMode): void {
  addPanelMode.value = addPanelMode.value === mode ? null : mode
}

// Custom add form
const customName    = ref('')
const customAmtStr  = ref('')
const customKind    = ref<SimulationItem['kind']>('expense')

function submitCustom(): void {
  if (!activeSim.value) return
  const name = customName.value.trim()
  const amt  = parseFloat(customAmtStr.value)
  if (!name || isNaN(amt) || amt <= 0) return
  store.addSimulationItem(activeSim.value.id, name, amt, customKind.value, 'custom')
  customName.value   = ''
  customAmtStr.value = ''
}

// Planner commitments picker
const addedPlannerIds = computed(() => {
  if (!activeSim.value) return new Set<number>()
  return new Set(activeSim.value.items.filter(i => i.plannerItemId != null).map(i => i.plannerItemId!))
})

function addFromPlanner(id: number, name: string, amount: number): void {
  if (!activeSim.value) return
  store.addSimulationItem(activeSim.value.id, name, amount, 'expense', 'planner', undefined, id)
}

// Transaction log picker
const txSearch = ref('')
const txPickerList = computed(() => {
  if (!activeSim.value) return []
  const month = activeSim.value.month
  const q     = txSearch.value.toLowerCase().trim()
  return txStore.transactions
    .filter(t => t.date.startsWith(month) && (!q || t.name.toLowerCase().includes(q)))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'in' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
})

function addFromTx(txId: number, name: string, amount: number, type: 'in' | 'out'): void {
  if (!activeSim.value) return
  store.addSimulationItem(activeSim.value.id, name, amount, type === 'in' ? 'income' : 'expense', 'transaction', txId)
}
</script>

<template>
  <div class="planner-root">

    <!-- ══════════════════════════════════════════════════════ -->
    <!-- LIST VIEW                                              -->
    <!-- ══════════════════════════════════════════════════════ -->
    <template v-if="view === 'list'">

      <!-- Page header -->
      <div class="planner-header">
        <div>
          <h1 class="planner-title">Paycheck Planner</h1>
          <p class="planner-subtitle">Plan recurring commitments and simulate months ahead.</p>
        </div>
      </div>

      <!-- ── Quick Planner ──────────────────────────────────── -->
      <div class="planner-section-header">
        <span class="planner-section-title">Quick Planner</span>
        <span class="planner-section-desc">Income minus recurring commitments</span>
      </div>

      <!-- Income input -->
      <div class="planner-income-row">
        <label class="planner-income-label" for="planner-income">Income</label>
        <div class="planner-income-inputs">
          <input id="planner-income" v-model="incomeStr" type="number" min="0" step="0.01"
            placeholder="e.g. 3200" class="planner-income-input"
            @change="applyIncome" @keydown.enter="applyIncome" />
          <button class="planner-income-apply" @click="applyIncome">Apply</button>
        </div>
      </div>

      <!-- Waterfall table -->
      <div class="planner-table-wrap">
        <div class="planner-row planner-row--income">
          <span class="planner-row-icon"><i class="pi pi-arrow-circle-down" /></span>
          <span class="planner-row-name">Income</span>
          <span class="planner-row-deduction"></span>
          <span class="planner-row-balance planner-row-balance--income">{{ fmt(store.income) }}</span>
          <span class="planner-row-actions"></span>
        </div>

        <div v-if="store.items.length === 0" class="planner-empty">
          <i class="pi pi-inbox planner-empty-icon" />
          <p>No commitments yet. Add your first recurring expense below.</p>
        </div>

        <template v-for="(item, idx) in store.items" :key="item.id">
          <!-- Edit mode -->
          <div v-if="editingId === item.id" class="planner-row planner-row--editing">
            <span class="planner-row-icon"><i class="pi pi-minus-circle" /></span>
            <input v-model="editName" type="text" class="planner-edit-name" placeholder="Name"
              @keydown.enter="submitEdit" @keydown.escape="cancelEdit" />
            <input v-model="editAmtStr" type="number" min="0.01" step="0.01" class="planner-edit-amt" placeholder="Amount"
              @keydown.enter="submitEdit" @keydown.escape="cancelEdit" />
            <span class="planner-row-balance"></span>
            <span class="planner-row-actions">
              <button class="planner-btn planner-btn--save" title="Save" @click="submitEdit"><i class="pi pi-check" /></button>
              <button class="planner-btn planner-btn--cancel" title="Cancel" @click="cancelEdit"><i class="pi pi-times" /></button>
            </span>
          </div>
          <!-- Display mode -->
          <div v-else class="planner-row planner-row--item" :class="commitBalances[idx] < 0 ? 'planner-row--overdrawn' : ''">
            <span class="planner-row-icon"><i class="pi pi-minus-circle" /></span>
            <span class="planner-row-name">{{ item.name }}</span>
            <span class="planner-row-deduction">−{{ fmt(item.amount) }}</span>
            <span class="planner-row-balance" :class="commitBalances[idx] < 0 ? 'planner-row-balance--negative' : 'planner-row-balance--neutral'">
              {{ fmt(commitBalances[idx]) }}
            </span>
            <span class="planner-row-actions">
              <button class="planner-btn planner-btn--move" title="Move up" :disabled="idx === 0" @click="store.moveItem(item.id, 'up')"><i class="pi pi-angle-up" /></button>
              <button class="planner-btn planner-btn--move" title="Move down" :disabled="idx === store.items.length - 1" @click="store.moveItem(item.id, 'down')"><i class="pi pi-angle-down" /></button>
              <button class="planner-btn planner-btn--edit" title="Edit" @click="startEdit(item.id, item.name, item.amount)"><i class="pi pi-pencil" /></button>
              <button class="planner-btn planner-btn--delete" title="Remove" @click="removeCommitment(item.id, item.name)"><i class="pi pi-trash" /></button>
            </span>
          </div>
        </template>
      </div>

      <!-- Commitment summary -->
      <div v-if="store.income > 0 || store.items.length > 0" class="planner-summary">
        <div class="planner-summary-item">
          <span class="planner-summary-label">Income</span>
          <span class="planner-summary-value planner-summary-value--income">{{ fmt(store.income) }}</span>
        </div>
        <div class="planner-summary-sep"><i class="pi pi-minus" /></div>
        <div class="planner-summary-item">
          <span class="planner-summary-label">Committed</span>
          <span class="planner-summary-value planner-summary-value--committed">{{ fmt(store.totalCommitted()) }}</span>
        </div>
        <div class="planner-summary-sep"><i class="pi pi-equals" /></div>
        <div class="planner-summary-item">
          <span class="planner-summary-label">Remaining</span>
          <span class="planner-summary-value" :class="commitRemainingClass()">{{ fmt(store.remaining()) }}</span>
        </div>
      </div>

      <!-- Add commitment -->
      <div class="planner-add-section">
        <div v-if="!showAddForm">
          <button class="planner-add-btn" @click="openAdd"><i class="pi pi-plus" /> Add commitment</button>
        </div>
        <div v-else class="planner-add-form">
          <h3 class="planner-add-form-title">New commitment</h3>
          <div class="planner-add-form-fields">
            <div class="planner-field">
              <label class="planner-field-label">Name</label>
              <input v-model="newName" type="text" class="planner-field-input" placeholder="e.g. Rent"
                @keydown.enter="submitAdd" @keydown.escape="cancelAdd" />
            </div>
            <div class="planner-field">
              <label class="planner-field-label">Amount</label>
              <input v-model="newAmountStr" type="number" min="0.01" step="0.01" class="planner-field-input" placeholder="e.g. 800"
                @keydown.enter="submitAdd" @keydown.escape="cancelAdd" />
            </div>
          </div>
          <div class="planner-add-form-actions">
            <button class="planner-action-btn planner-action-btn--primary" @click="submitAdd">Add</button>
            <button class="planner-action-btn planner-action-btn--ghost" @click="cancelAdd">Cancel</button>
          </div>
        </div>
      </div>

      <!-- ── Month Simulations ───────────────────────────────── -->
      <div class="planner-section-header planner-section-header--spaced">
        <div>
          <span class="planner-section-title">Month Simulations</span>
          <span class="planner-section-desc">Build and save what-if scenarios for any month</span>
        </div>
        <button class="planner-new-sim-btn" @click="openNewSim">
          <i class="pi pi-plus" /> New simulation
        </button>
      </div>

      <!-- New simulation form -->
      <div v-if="showNewSimForm" class="planner-add-form">
        <h3 class="planner-add-form-title">New simulation</h3>
        <div class="planner-add-form-fields">
          <div class="planner-field">
            <label class="planner-field-label">Month</label>
            <input v-model="newSimMonth" type="month" class="planner-field-input" @change="onNewSimMonthChange" />
          </div>
          <div class="planner-field">
            <label class="planner-field-label">Name</label>
            <input v-model="newSimName" type="text" class="planner-field-input" placeholder="e.g. May 2026 – Tight"
              @keydown.enter="submitNewSim" @keydown.escape="cancelNewSim" />
          </div>
        </div>
        <div class="planner-add-form-actions">
          <button class="planner-action-btn planner-action-btn--primary" @click="submitNewSim">Create</button>
          <button class="planner-action-btn planner-action-btn--ghost" @click="cancelNewSim">Cancel</button>
        </div>
      </div>

      <!-- Simulation cards -->
      <div v-if="sortedSimulations.length === 0 && !showNewSimForm" class="planner-sim-empty">
        <i class="pi pi-calendar planner-empty-icon" />
        <p>No simulations yet. Create one to model a future month.</p>
      </div>

      <div v-else class="planner-sim-list">
        <div v-for="sim in sortedSimulations" :key="sim.id" class="planner-sim-card" @click="openSim(sim.id)">
          <div class="planner-sim-card-main">
            <span class="planner-sim-card-month">{{ formatMonth(sim.month) }}</span>
            <span class="planner-sim-card-name">{{ sim.name }}</span>
          </div>
          <div class="planner-sim-card-summary">
            <span class="planner-sim-card-stat">
              <span class="planner-sim-stat-label">Income</span>
              <span class="planner-sim-stat-val planner-sim-stat-val--income">{{ fmt(store.simSummary(sim.id).totalIncome) }}</span>
            </span>
            <span class="planner-sim-card-stat">
              <span class="planner-sim-stat-label">Remaining</span>
              <span class="planner-sim-stat-val"
                :class="store.simSummary(sim.id).remaining >= 0 ? 'planner-remaining--positive' : 'planner-remaining--negative'">
                {{ fmt(store.simSummary(sim.id).remaining) }}
              </span>
            </span>
          </div>
          <div class="planner-sim-card-actions">
            <button class="planner-btn planner-btn--delete" title="Delete simulation" @click.stop="deleteSim(sim.id, sim.name)">
              <i class="pi pi-trash" />
            </button>
            <i class="pi pi-angle-right planner-sim-card-arrow" />
          </div>
        </div>
      </div>

    </template>

    <!-- ══════════════════════════════════════════════════════ -->
    <!-- SIMULATION DETAIL VIEW                                 -->
    <!-- ══════════════════════════════════════════════════════ -->
    <template v-else-if="view === 'sim' && activeSim">

      <!-- Sim header -->
      <div class="planner-sim-nav">
        <button class="planner-back-btn" @click="backToList">
          <i class="pi pi-arrow-left" /> Back
        </button>
        <div class="planner-sim-title-row">
          <template v-if="editingSimName">
            <input v-model="editSimNameStr" type="text" class="planner-sim-title-input"
              @keydown.enter="submitEditSimName" @keydown.escape="cancelEditSimName" />
            <button class="planner-btn planner-btn--save" @click="submitEditSimName"><i class="pi pi-check" /></button>
            <button class="planner-btn planner-btn--cancel" @click="cancelEditSimName"><i class="pi pi-times" /></button>
          </template>
          <template v-else>
            <h1 class="planner-sim-title">{{ activeSim.name }}</h1>
            <button class="planner-btn planner-btn--edit" title="Rename" @click="startEditSimName"><i class="pi pi-pencil" /></button>
          </template>
        </div>
        <div class="planner-sim-month-row">
          <i class="pi pi-calendar text-zinc-400 text-xs" />
          <input :value="activeSim.month" type="month" class="planner-sim-month-input" @change="onSimMonthChange" />
        </div>
      </div>

      <!-- Income suggestions -->
      <div v-if="incomeSuggestions.length > 0" class="planner-detect-box">
        <div class="planner-detect-header">
          <i class="pi pi-bolt planner-detect-icon" />
          <span>Detected income for {{ formatMonth(activeSim.month) }}</span>
        </div>
        <div class="planner-detect-list">
          <div v-for="tx in incomeSuggestions" :key="tx.id" class="planner-detect-row">
            <span class="planner-detect-name">{{ tx.name }}</span>
            <span class="planner-detect-amt">{{ fmt(tx.amount) }}</span>
            <button class="planner-detect-add" @click="addSuggestion(tx.id, tx.name, tx.amount)">
              <i class="pi pi-plus" /> Add
            </button>
          </div>
        </div>
      </div>

      <!-- Simulation waterfall -->
      <div class="planner-table-wrap">
        <div v-if="activeSim.items.length === 0" class="planner-empty">
          <i class="pi pi-inbox planner-empty-icon" />
          <p>No items yet. Add income and expenses using the controls below.</p>
        </div>

        <template v-for="(item, idx) in activeSim.items" :key="item.id">
          <!-- Edit mode -->
          <div v-if="editingSimItemId === item.id" class="planner-row planner-row--editing">
            <span class="planner-row-icon">
              <i :class="editSimItemKind === 'income' ? 'pi pi-arrow-circle-down' : 'pi pi-minus-circle'" />
            </span>
            <input v-model="editSimItemName" type="text" class="planner-edit-name" placeholder="Name"
              @keydown.enter="submitEditSimItem" @keydown.escape="cancelEditSimItem" />
            <div class="planner-edit-kind-wrap">
              <select v-model="editSimItemKind" class="planner-edit-kind">
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </select>
              <input v-model="editSimItemAmtStr" type="number" min="0.01" step="0.01" class="planner-edit-amt" placeholder="Amount"
                @keydown.enter="submitEditSimItem" @keydown.escape="cancelEditSimItem" />
            </div>
            <span class="planner-row-balance"></span>
            <span class="planner-row-actions">
              <button class="planner-btn planner-btn--save" title="Save" @click="submitEditSimItem"><i class="pi pi-check" /></button>
              <button class="planner-btn planner-btn--cancel" title="Cancel" @click="cancelEditSimItem"><i class="pi pi-times" /></button>
            </span>
          </div>
          <!-- Display mode -->
          <div v-else class="planner-row"
            :class="[
              item.kind === 'income' ? 'planner-row--income' : 'planner-row--item',
              item.kind === 'expense' && simBalances[idx] < 0 ? 'planner-row--overdrawn' : '',
            ]">
            <span class="planner-row-icon">
              <i :class="item.kind === 'income' ? 'pi pi-arrow-circle-down' : 'pi pi-minus-circle'" />
            </span>
            <span class="planner-row-name">
              {{ item.name }}
              <span v-if="item.source !== 'custom'" class="planner-row-source-badge">
                {{ item.source === 'transaction' ? 'tx' : 'recurring' }}
              </span>
            </span>
            <span class="planner-row-deduction" :class="item.kind === 'income' ? 'planner-row-deduction--income' : ''">
              {{ item.kind === 'income' ? '+' : '−' }}{{ fmt(item.amount) }}
            </span>
            <span class="planner-row-balance"
              :class="simBalances[idx] >= 0 ? (item.kind === 'income' ? 'planner-row-balance--income' : 'planner-row-balance--neutral') : 'planner-row-balance--negative'">
              {{ fmt(simBalances[idx]) }}
            </span>
            <span class="planner-row-actions">
              <button class="planner-btn planner-btn--move" title="Move up" :disabled="idx === 0"
                @click="store.moveSimulationItem(activeSim!.id, item.id, 'up')"><i class="pi pi-angle-up" /></button>
              <button class="planner-btn planner-btn--move" title="Move down" :disabled="idx === activeSim.items.length - 1"
                @click="store.moveSimulationItem(activeSim!.id, item.id, 'down')"><i class="pi pi-angle-down" /></button>
              <button class="planner-btn planner-btn--edit" title="Edit" @click="startEditSimItem(item)"><i class="pi pi-pencil" /></button>
              <button class="planner-btn planner-btn--delete" title="Remove" @click="removeSimItem(item.id, item.name)"><i class="pi pi-trash" /></button>
            </span>
          </div>
        </template>
      </div>

      <!-- Simulation summary -->
      <div v-if="activeSim.items.length > 0" class="planner-summary">
        <div class="planner-summary-item">
          <span class="planner-summary-label">Income</span>
          <span class="planner-summary-value planner-summary-value--income">{{ fmt(simSummary.totalIncome) }}</span>
        </div>
        <div class="planner-summary-sep"><i class="pi pi-minus" /></div>
        <div class="planner-summary-item">
          <span class="planner-summary-label">Expenses</span>
          <span class="planner-summary-value planner-summary-value--committed">{{ fmt(simSummary.totalExpenses) }}</span>
        </div>
        <div class="planner-summary-sep"><i class="pi pi-equals" /></div>
        <div class="planner-summary-item">
          <span class="planner-summary-label">Remaining</span>
          <span class="planner-summary-value" :class="simRemainingClass()">{{ fmt(simSummary.remaining) }}</span>
        </div>
      </div>

      <!-- Add panel controls -->
      <div class="planner-sim-add-bar">
        <button class="planner-panel-btn" :class="addPanelMode === 'custom' ? 'planner-panel-btn--active' : ''" @click="togglePanel('custom')">
          <i class="pi pi-plus-circle" /> Custom item
        </button>
        <button class="planner-panel-btn" :class="addPanelMode === 'planner' ? 'planner-panel-btn--active' : ''" @click="togglePanel('planner')">
          <i class="pi pi-list" /> Recurring
        </button>
        <button class="planner-panel-btn" :class="addPanelMode === 'transactions' ? 'planner-panel-btn--active' : ''" @click="togglePanel('transactions')">
          <i class="pi pi-search" /> Transaction log
        </button>
      </div>

      <!-- Custom item panel -->
      <div v-if="addPanelMode === 'custom'" class="planner-add-panel">
        <div class="planner-add-panel-fields">
          <div class="planner-field">
            <label class="planner-field-label">Type</label>
            <div class="planner-kind-toggle">
              <button :class="['planner-kind-opt', customKind === 'expense' ? 'planner-kind-opt--active' : '']" @click="customKind = 'expense'">Expense</button>
              <button :class="['planner-kind-opt', customKind === 'income' ? 'planner-kind-opt--active' : '']" @click="customKind = 'income'">Income</button>
            </div>
          </div>
          <div class="planner-field">
            <label class="planner-field-label">Name</label>
            <input v-model="customName" type="text" class="planner-field-input" placeholder="e.g. Rent"
              @keydown.enter="submitCustom" />
          </div>
          <div class="planner-field">
            <label class="planner-field-label">Amount</label>
            <input v-model="customAmtStr" type="number" min="0.01" step="0.01" class="planner-field-input" placeholder="e.g. 800"
              @keydown.enter="submitCustom" />
          </div>
          <div class="planner-field planner-field--action">
            <label class="planner-field-label">&nbsp;</label>
            <button class="planner-action-btn planner-action-btn--primary" @click="submitCustom">Add</button>
          </div>
        </div>
      </div>

      <!-- Planner commitments panel -->
      <div v-else-if="addPanelMode === 'planner'" class="planner-add-panel">
        <div v-if="store.items.length === 0" class="planner-panel-empty">
          No recurring commitments saved. Add some in the Quick Planner above.
        </div>
        <div v-else class="planner-picker-list">
          <div v-for="item in store.items" :key="item.id" class="planner-picker-row"
            :class="addedPlannerIds.has(item.id) ? 'planner-picker-row--added' : ''">
            <span class="planner-picker-name">{{ item.name }}</span>
            <span class="planner-picker-amt">{{ fmt(item.amount) }}</span>
            <button v-if="!addedPlannerIds.has(item.id)" class="planner-picker-add-btn" @click="addFromPlanner(item.id, item.name, item.amount)">
              <i class="pi pi-plus" /> Add
            </button>
            <span v-else class="planner-picker-added-badge"><i class="pi pi-check" /> Added</span>
          </div>
        </div>
      </div>

      <!-- Transaction log panel -->
      <div v-else-if="addPanelMode === 'transactions'" class="planner-add-panel">
        <div class="planner-tx-search-row">
          <i class="pi pi-search planner-tx-search-icon" />
          <input v-model="txSearch" type="text" class="planner-tx-search-input" placeholder="Search transactions…" />
        </div>
        <div v-if="txPickerList.length === 0" class="planner-panel-empty">
          No transactions found for {{ formatMonth(activeSim.month) }}{{ txSearch ? ' matching your search' : '' }}.
        </div>
        <div v-else class="planner-picker-list planner-picker-list--tx">
          <div v-for="tx in txPickerList" :key="tx.id" class="planner-picker-row"
            :class="addedTxIds.has(tx.id) ? 'planner-picker-row--added' : ''">
            <span class="planner-picker-tx-badge" :class="tx.type === 'in' ? 'planner-picker-tx-badge--in' : 'planner-picker-tx-badge--out'">
              {{ tx.type === 'in' ? 'IN' : 'OUT' }}
            </span>
            <span class="planner-picker-name">{{ tx.name }}</span>
            <span class="planner-picker-amt">{{ fmt(tx.amount) }}</span>
            <button v-if="!addedTxIds.has(tx.id)" class="planner-picker-add-btn" @click="addFromTx(tx.id, tx.name, tx.amount, tx.type)">
              <i class="pi pi-plus" /> Add
            </button>
            <span v-else class="planner-picker-added-badge"><i class="pi pi-check" /> Added</span>
          </div>
        </div>
      </div>

    </template>

  </div>
</template>

