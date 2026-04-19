<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSavingsGoalStore } from '../stores/savingsGoalStore'
import type { SavingsGoal } from '../stores/savingsGoalStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useAccountStore } from '../stores/accountStore'
import { getTodayStr } from '../utils/date'

const store    = useSavingsGoalStore()
const settings = useSettingsStore()
const accounts = useAccountStore()

function fmt(v: number): string { return settings.formatMoney(v) }

// ── New goal form ─────────────────────────────────────────────
const showNewForm          = ref(false)
const newName              = ref('')
const newTarget            = ref('')
const newDeadline          = ref('')
const newLinkedAccountId   = ref('')

function openNewForm(): void { showNewForm.value = true; newName.value = ''; newTarget.value = ''; newDeadline.value = ''; newLinkedAccountId.value = '' }
function cancelNew(): void   { showNewForm.value = false }

function submitNew(): void {
  const name = newName.value.trim()
  const amt  = parseFloat(newTarget.value)
  if (!name || isNaN(amt) || amt <= 0) return
  store.addGoal(name, amt, newDeadline.value || undefined, newLinkedAccountId.value || undefined)
  showNewForm.value = false
}

// ── Edit goal ─────────────────────────────────────────────────
const editingGoalId        = ref<number | null>(null)
const editName             = ref('')
const editTarget           = ref('')
const editDeadline         = ref('')
const editLinkedAccountId  = ref('')

function startEdit(g: SavingsGoal): void {
  editingGoalId.value       = g.id
  editName.value            = g.name
  editTarget.value          = String(g.targetAmount)
  editDeadline.value        = g.deadline ?? ''
  editLinkedAccountId.value = g.linkedAccountId ?? ''
}

function cancelEdit(): void { editingGoalId.value = null }

function submitEdit(): void {
  const id  = editingGoalId.value
  const amt = parseFloat(editTarget.value)
  if (!id || isNaN(amt) || amt <= 0) return
  store.updateGoal(id, { name: editName.value, targetAmount: amt, deadline: editDeadline.value || undefined, linkedAccountId: editLinkedAccountId.value })
  editingGoalId.value = null
}

// ── Contribution form ─────────────────────────────────────────
const addContribGoalId  = ref<number | null>(null)
const contribAmount     = ref('')
const contribDate       = ref(getTodayStr())
const contribNote       = ref('')

function openContrib(goalId: number): void {
  addContribGoalId.value = goalId
  contribAmount.value    = ''
  contribDate.value      = getTodayStr()
  contribNote.value      = ''
}

function cancelContrib(): void { addContribGoalId.value = null }

function submitContrib(): void {
  const id  = addContribGoalId.value
  const amt = parseFloat(contribAmount.value)
  if (!id || isNaN(amt) || amt <= 0) return
  store.addContribution(id, amt, contribDate.value, contribNote.value)
  addContribGoalId.value = null
}

// ── Filters ───────────────────────────────────────────────────
const showArchived = ref(false)
const activeGoals  = computed(() => store.goals.filter(g => showArchived.value || !g.archived))

// ── Date helpers ──────────────────────────────────────────────
const _now = new Date()

function daysUntil(deadline: string): number {
  const d = new Date(deadline + 'T00:00:00')
  return Math.ceil((d.getTime() - _now.getTime()) / 86400000)
}

function deadlineLabel(deadline: string): string {
  const days = daysUntil(deadline)
  if (days < 0)   return `${Math.abs(days)}d overdue`
  if (days === 0) return 'Due today'
  if (days < 30)  return `${days}d left`
  const months = Math.round(days / 30.4)
  return `${months}mo left`
}

function deadlineColor(deadline: string): string {
  const days = daysUntil(deadline)
  if (days < 0)   return '#dc2626'
  if (days < 30)  return '#d97706'
  return '#16a34a'
}

// ── Monthly needed ────────────────────────────────────────────
function monthlyNeeded(goal: SavingsGoal): number | null {
  if (!goal.deadline) return null
  const remaining = goal.targetAmount - store.totalSaved(goal)
  if (remaining <= 0) return 0
  const days   = daysUntil(goal.deadline)
  if (days <= 0) return null
  const months = Math.max(1, days / 30.4)
  return Math.ceil((remaining / months) * 100) / 100
}
</script>

<template>
  <div class="sg-page">

    <!-- Header -->
    <div class="sg-header">
      <div>
        <h1 class="sg-title">Savings Goals</h1>
        <p v-if="store.goals.length > 0" class="sg-subtitle">{{ store.goals.filter(g => !g.archived).length }} active goal{{ store.goals.filter(g => !g.archived).length !== 1 ? 's' : '' }}</p>
      </div>
      <div class="sg-header-actions">
        <label class="sg-archive-toggle">
          <input type="checkbox" v-model="showArchived" />
          Show archived
        </label>
        <button class="sg-add-btn" @click="openNewForm">
          <i class="pi pi-plus" />
          New Goal
        </button>
      </div>
    </div>

    <!-- New goal form -->
    <div v-if="showNewForm" class="sg-form-card">
      <h3 class="sg-form-title">New Savings Goal</h3>
      <div class="sg-form-fields">
        <div class="sg-form-group">
          <label class="sg-label">Name</label>
          <input class="sg-input" v-model="newName" placeholder="e.g. Emergency fund" @keydown.enter="submitNew" @keydown.escape="cancelNew" autofocus />
        </div>
        <div class="sg-form-group">
          <label class="sg-label">Target amount</label>
          <input class="sg-input" type="number" min="0.01" step="0.01" v-model="newTarget" placeholder="1000.00" @keydown.enter="submitNew" />
        </div>
        <div class="sg-form-group">
          <label class="sg-label">Deadline <span class="sg-optional">(optional)</span></label>
          <input class="sg-input" type="date" v-model="newDeadline" />
        </div>
        <div class="sg-form-group">
          <label class="sg-label">Link to account <span class="sg-optional">(optional)</span></label>
          <select class="sg-input" v-model="newLinkedAccountId">
            <option value="">— None (manual contributions) —</option>
            <option v-for="acc in accounts.accounts" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
          </select>
          <span class="sg-optional" style="font-size:0.72rem;margin-top:0.25rem;">When linked, the goal tracks the account’s net balance automatically.</span>
        </div>
      </div>
      <div class="sg-form-actions">
        <button class="sg-btn sg-btn--primary" @click="submitNew" :disabled="!newName.trim() || !newTarget || parseFloat(newTarget) <= 0">Create Goal</button>
        <button class="sg-btn sg-btn--ghost" @click="cancelNew">Cancel</button>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="store.goals.length === 0 && !showNewForm" class="sg-empty">
      <i class="pi pi-flag sg-empty-icon" />
      <p class="sg-empty-title">No savings goals yet</p>
      <p class="sg-empty-sub">Set targets for holidays, emergencies, big purchases — and track your progress.</p>
      <button class="sg-btn sg-btn--primary" @click="openNewForm">Create your first goal</button>
    </div>

    <!-- Goals grid -->
    <div v-if="activeGoals.length > 0" class="sg-grid">
      <div v-for="goal in activeGoals" :key="goal.id" class="sg-card" :class="{ 'sg-card--archived': goal.archived }">

        <!-- Goal header -->
        <div class="sg-card-header">
          <div class="sg-color-dot" :style="{ background: goal.color }" />
          <div class="sg-card-title-wrap">
            <!-- Edit mode -->
            <template v-if="editingGoalId === goal.id">
              <div class="sg-edit-fields">
                <input class="sg-input sg-input--sm" v-model="editName" placeholder="Goal name" @keydown.enter="submitEdit" @keydown.escape="cancelEdit" />
                <input class="sg-input sg-input--sm" type="number" min="0.01" step="0.01" v-model="editTarget" placeholder="Target" @keydown.enter="submitEdit" />
                <input class="sg-input sg-input--sm" type="date" v-model="editDeadline" />
                <select class="sg-input sg-input--sm" v-model="editLinkedAccountId">
                  <option value="">— No account link —</option>
                  <option v-for="acc in accounts.accounts" :key="acc.id" :value="acc.id">{{ acc.name }}</option>
                </select>
                <div class="sg-edit-actions">
                  <button class="sg-btn sg-btn--primary sg-btn--xs" @click="submitEdit">Save</button>
                  <button class="sg-btn sg-btn--ghost  sg-btn--xs" @click="cancelEdit">Cancel</button>
                </div>
              </div>
            </template>
            <!-- Display mode -->
            <template v-else>
              <span class="sg-card-name">{{ goal.name }}</span>
              <span v-if="goal.linkedAccountId" class="sg-linked-badge">
                <i class="pi pi-link" />
                {{ accounts.accounts.find(a => a.id === goal.linkedAccountId)?.name ?? 'Linked account' }}
              </span>
              <span v-if="goal.deadline" class="sg-deadline" :style="{ color: deadlineColor(goal.deadline) }">
                <i class="pi pi-calendar" />
                {{ deadlineLabel(goal.deadline) }}
              </span>
            </template>
          </div>
          <div class="sg-card-actions" v-if="editingGoalId !== goal.id">
            <button class="sg-icon-btn" title="Edit" @click="startEdit(goal)"><i class="pi pi-pencil" /></button>
            <button class="sg-icon-btn" :title="goal.archived ? 'Unarchive' : 'Archive'" @click="store.updateGoal(goal.id, { archived: !goal.archived })">
              <i :class="goal.archived ? 'pi pi-eye' : 'pi pi-eye-slash'" />
            </button>
            <button class="sg-icon-btn sg-icon-btn--danger" title="Delete" @click="store.deleteGoal(goal.id)"><i class="pi pi-trash" /></button>
          </div>
        </div>

        <!-- Progress -->
        <div class="sg-progress-section">
          <div class="sg-progress-row">
            <span class="sg-saved">{{ fmt(store.totalSaved(goal)) }}</span>
            <span class="sg-target">of {{ fmt(goal.targetAmount) }}</span>
            <span class="sg-pct" :style="{ color: goal.color }">{{ store.progressPct(goal) }}%</span>
          </div>
          <div class="sg-bar-track">
            <div class="sg-bar-fill" :style="{ width: store.progressPct(goal) + '%', background: goal.color }" />
          </div>
          <div v-if="goal.deadline && monthlyNeeded(goal) !== null && store.progressPct(goal) < 100" class="sg-monthly-hint">
            <i class="pi pi-info-circle" /> {{ fmt(monthlyNeeded(goal)!) }}/month needed to reach goal by deadline
          </div>
          <div v-if="store.progressPct(goal) >= 100" class="sg-complete">
            <i class="pi pi-check-circle" /> Goal reached!
          </div>
        </div>

        <!-- Add contribution -->
        <template v-if="!goal.linkedAccountId && addContribGoalId === goal.id">
          <div class="sg-contrib-form">
            <input class="sg-input sg-input--sm" type="number" min="0.01" step="0.01" v-model="contribAmount" placeholder="Amount" @keydown.enter="submitContrib" @keydown.escape="cancelContrib" autofocus />
            <input class="sg-input sg-input--sm" type="date" v-model="contribDate" />
            <input class="sg-input sg-input--sm" v-model="contribNote" placeholder="Note (optional)" @keydown.enter="submitContrib" />
            <div class="sg-edit-actions">
              <button class="sg-btn sg-btn--primary sg-btn--xs" @click="submitContrib" :disabled="!contribAmount || parseFloat(contribAmount) <= 0">Add</button>
              <button class="sg-btn sg-btn--ghost  sg-btn--xs" @click="cancelContrib">Cancel</button>
            </div>
          </div>
        </template>
        <button v-else-if="!goal.linkedAccountId && !goal.archived && store.progressPct(goal) < 100" class="sg-contrib-btn" @click="openContrib(goal.id)">
          <i class="pi pi-plus" /> Add Contribution
        </button>
        <div v-else-if="goal.linkedAccountId && !goal.archived" class="sg-auto-track-note">
          <i class="pi pi-refresh" /> Auto-tracked from account transactions
        </div>

        <!-- Contribution history (manual only) -->
        <div v-if="!goal.linkedAccountId && goal.contributions.length > 0" class="sg-contribs">
          <div v-for="c in goal.contributions.slice(0, 5)" :key="c.id" class="sg-contrib-row">
            <span class="sg-contrib-date">{{ c.date }}</span>
            <span class="sg-contrib-note">{{ c.note || '—' }}</span>
            <span class="sg-contrib-amount" :style="{ color: goal.color }">+{{ fmt(c.amount) }}</span>
            <button class="sg-icon-btn sg-icon-btn--danger sg-icon-btn--xs" title="Delete contribution" @click="store.deleteContribution(goal.id, c.id)"><i class="pi pi-times" /></button>
          </div>
          <p v-if="goal.contributions.length > 5" class="sg-contrib-more">+ {{ goal.contributions.length - 5 }} more contributions</p>
        </div>

      </div>
    </div>

  </div>
</template>
