<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePlannerStore } from '../stores/plannerStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useConfirm } from '../composables/useConfirm'

const store       = usePlannerStore()
const settings    = useSettingsStore()
const { confirm } = useConfirm()

function fmt(v: number): string { return settings.formatMoney(v) }

const incomeStr = ref(store.income > 0 ? String(store.income) : '')
function applyIncome(): void {
  const v = parseFloat(incomeStr.value)
  if (!isNaN(v) && v >= 0) store.setIncome(v)
}

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
</script>

<template>
  <div class="planner-root">

    <div class="planner-header">
      <div>
        <h1 class="planner-title">Quick Calculator</h1>
        <p class="planner-subtitle">Plan your income commitments and recurring expenses.</p>
      </div>
    </div>

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
          <span class="planner-row-deduction">{{ fmt(item.amount) }}</span>
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

  </div>
</template>
