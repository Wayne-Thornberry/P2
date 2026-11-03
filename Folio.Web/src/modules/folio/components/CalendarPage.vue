<script setup lang="ts">
import { ref, computed } from 'vue'
import { useTransactionStore }         from '../stores/transactionStore'
import { useUpcomingTransactionStore } from '../stores/upcomingTransactionStore'
import { useSettingsStore }            from '../stores/settingsStore'
import { useMoneyInput }               from '../composables/useMoneyInput'
import type { Transaction }            from '../types/transaction'
import type { UpcomingTransaction }    from '../types/transaction'

const txStore   = useTransactionStore()
const upStore   = useUpcomingTransactionStore()
const settings  = useSettingsStore()
const { moneyFocus, moneyBlur } = useMoneyInput()

function formatMoney(v: number): string { return settings.formatMoney(v) }

// ── Calendar navigation ───────────────────────────────────────
const _now     = new Date()
const calYear  = ref(_now.getFullYear())
const calMonth = ref(_now.getMonth() + 1)

const TODAY = [
  _now.getFullYear(),
  String(_now.getMonth() + 1).padStart(2, '0'),
  String(_now.getDate()).padStart(2, '0'),
].join('-')

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function prevMonth(): void {
  if (calMonth.value === 1) { calYear.value--; calMonth.value = 12 }
  else calMonth.value--
  selectedDate.value = null
}

function nextMonth(): void {
  if (calMonth.value === 12) { calYear.value++; calMonth.value = 1 }
  else calMonth.value++
  selectedDate.value = null
}

function goToToday(): void {
  calYear.value      = _now.getFullYear()
  calMonth.value     = _now.getMonth() + 1
  selectedDate.value = TODAY
}

// ── Calendar grid ─────────────────────────────────────────────
const daysInMonth = computed(() => new Date(calYear.value, calMonth.value, 0).getDate())

const firstDayOffset = computed(() =>
  // Monday-based: Mon = 0, Tue = 1, … Sun = 6
  (new Date(calYear.value, calMonth.value - 1, 1).getDay() + 6) % 7
)

interface CalCell { day: number | null; date: string | null }

const calCells = computed((): CalCell[] => {
  const cells: CalCell[] = []
  for (let i = 0; i < firstDayOffset.value; i++) cells.push({ day: null, date: null })
  for (let d = 1; d <= daysInMonth.value; d++) {
    cells.push({
      day:  d,
      date: `${calYear.value}-${String(calMonth.value).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    })
  }
  // Pad to complete final week row
  while (cells.length % 7 !== 0) cells.push({ day: null, date: null })
  return cells
})

// ── Transaction lookups ───────────────────────────────────────
const txByDate = computed(() => {
  const map = new Map<string, Transaction[]>()
  for (const t of txStore.transactions) {
    const list = map.get(t.date) ?? []
    list.push(t)
    map.set(t.date, list)
  }
  return map
})

const upByDate = computed(() => {
  const map = new Map<string, UpcomingTransaction[]>()
  for (const u of upStore.items) {
    const list = map.get(u.date) ?? []
    list.push(u)
    map.set(u.date, list)
  }
  return map
})

// ── Month summary ─────────────────────────────────────────────
const monthKey = computed(() =>
  `${calYear.value}-${String(calMonth.value).padStart(2, '0')}`)

const monthTxs = computed(() =>
  txStore.transactions.filter(t => t.date.startsWith(monthKey.value)))

const monthIn  = computed(() => monthTxs.value.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0))
const monthOut = computed(() => monthTxs.value.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0))
const monthNet = computed(() => monthIn.value - monthOut.value)

const monthUpcomingPending = computed(() =>
  upStore.items.filter(u => !u.done && u.date.startsWith(monthKey.value)))

const monthUpcomingIn  = computed(() => monthUpcomingPending.value.filter(u => u.type === 'in').reduce((s, u) => s + u.amount, 0))
const monthUpcomingOut = computed(() => monthUpcomingPending.value.filter(u => u.type === 'out').reduce((s, u) => s + u.amount, 0))

// ── Selected day ──────────────────────────────────────────────
const selectedDate = ref<string | null>(null)

function selectDay(date: string | null): void {
  if (!date) return
  selectedDate.value = selectedDate.value === date ? null : date
  if (selectedDate.value) {
    newForm.value.date = selectedDate.value
    showAddForm.value  = false
    linkingId.value    = null
    editingId.value    = null
  }
}

const selectedTxs = computed((): Transaction[] =>
  selectedDate.value ? (txByDate.value.get(selectedDate.value) ?? []) : [])

const selectedTxNet = computed(() =>
  selectedTxs.value.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0) -
  selectedTxs.value.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0))

const selectedUpcoming = computed((): UpcomingTransaction[] =>
  selectedDate.value ? (upByDate.value.get(selectedDate.value) ?? []) : [])

function formatSelectedDate(date: string): string {
  try {
    return new Date(date + 'T00:00:00').toLocaleDateString(settings.locale, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })
  } catch {
    return date
  }
}

// ── Add upcoming form ─────────────────────────────────────────
const showAddForm = ref(false)
const newForm = ref({
  title:     '',
  amount:    '0.00',
  type:      'out' as 'in' | 'out',
  date:      TODAY,
  notes:     '',
  recurring: '' as '' | 'weekly' | 'monthly' | 'yearly',
})

function openAddForm(): void {
  newForm.value = { title: '', amount: '0.00', type: 'out', date: selectedDate.value ?? TODAY, notes: '', recurring: '' }
  showAddForm.value = true
}

function cancelAdd(): void {
  showAddForm.value = false
}

function submitAdd(): void {
  const amount = parseFloat(newForm.value.amount)
  if (!newForm.value.title.trim() || isNaN(amount) || amount <= 0) return
  upStore.addItem({
    title:     newForm.value.title.trim(),
    amount:    Math.round(amount * 100) / 100,
    type:      newForm.value.type,
    date:      newForm.value.date,
    notes:     newForm.value.notes.trim() || undefined,
    done:      false,
    recurring: newForm.value.recurring || undefined,
  })
  showAddForm.value = false
}

// ── Edit upcoming ─────────────────────────────────────────────
const editingId = ref<number | null>(null)
const editForm  = ref({ title: '', amount: '0.00', type: 'out' as 'in' | 'out', date: '', notes: '', recurring: '' as '' | 'weekly' | 'monthly' | 'yearly' })

function startEdit(u: UpcomingTransaction): void {
  editingId.value = u.id
  editForm.value  = { title: u.title, amount: u.amount.toFixed(2), type: u.type, date: u.date, notes: u.notes ?? '', recurring: u.recurring ?? '' }
  linkingId.value = null
}

function cancelEdit(): void { editingId.value = null }

function submitEdit(): void {
  if (editingId.value == null) return
  const amount = parseFloat(editForm.value.amount)
  if (!editForm.value.title.trim() || isNaN(amount) || amount <= 0) return
  upStore.updateItem(editingId.value, {
    title:     editForm.value.title.trim(),
    amount:    Math.round(amount * 100) / 100,
    type:      editForm.value.type,
    date:      editForm.value.date,
    notes:     editForm.value.notes.trim() || undefined,
    recurring: editForm.value.recurring || undefined,
  })
  editingId.value = null
}

// ── Mark done / link ──────────────────────────────────────────
const linkingId    = ref<number | null>(null)
const linkTxSearch = ref('')

const linkTxOptions = computed(() => {
  const q = linkTxSearch.value.toLowerCase().trim()
  return txStore.transactions
    .filter(t => !q || t.name.toLowerCase().includes(q) || t.date.includes(q))
    .slice(0, 15)
})

function startLink(id: number): void {
  linkingId.value    = id
  linkTxSearch.value = ''
  editingId.value    = null
}

function cancelLink(): void { linkingId.value = null }

function confirmLink(txId: number | null): void {
  if (linkingId.value == null) return
  upStore.markDone(linkingId.value, txId ?? undefined)
  linkingId.value = null
}

function deleteUpcoming(id: number): void {
  upStore.deleteItem(id)
}
</script>

<template>
  <div class="cal">

    <!-- Page header -->
    <div class="cal-page-header">
      <div>
        <h1 class="cal-page-title">Financial Calendar</h1>
        <p class="cal-page-subtitle">View transactions by date and plan upcoming expenses</p>
      </div>
    </div>

    <!-- Month navigation + summary -->
    <div class="cal-toolbar">
      <div class="cal-nav">
        <button class="cal-nav-btn" title="Previous month" @click="prevMonth">
          <i class="pi pi-chevron-left" />
        </button>
        <span class="cal-nav-label">{{ MONTH_NAMES[calMonth - 1] }} {{ calYear }}</span>
        <button class="cal-nav-btn" title="Next month" @click="nextMonth">
          <i class="pi pi-chevron-right" />
        </button>
        <button class="cal-today-btn" @click="goToToday">Today</button>
      </div>

      <div class="cal-month-summary">
        <div class="cal-summary-stat">
          <span class="cal-summary-label">In</span>
          <span class="cal-summary-value money-positive">{{ formatMoney(monthIn) }}</span>
        </div>
        <div class="cal-summary-sep" />
        <div class="cal-summary-stat">
          <span class="cal-summary-label">Out</span>
          <span class="cal-summary-value money-negative">{{ formatMoney(monthOut) }}</span>
        </div>
        <div class="cal-summary-sep" />
        <div class="cal-summary-stat">
          <span class="cal-summary-label">Net</span>
          <span class="cal-summary-value" :class="monthNet >= 0 ? 'money-positive' : 'money-negative'">{{ formatMoney(monthNet) }}</span>
        </div>
        <template v-if="monthUpcomingPending.length > 0">
          <div class="cal-summary-sep" />
          <div class="cal-summary-stat">
            <span class="cal-summary-label">Upcoming</span>
            <span class="cal-summary-value cal-summary-upcoming">
              {{ monthUpcomingPending.length }} pending
              <template v-if="monthUpcomingIn > 0 || monthUpcomingOut > 0">
                &nbsp;(
                <span class="money-positive">+{{ formatMoney(monthUpcomingIn) }}</span>
                /
                <span class="money-negative">-{{ formatMoney(monthUpcomingOut) }}</span>
                )
              </template>
            </span>
          </div>
        </template>
      </div>
    </div>

    <!-- Calendar grid -->
    <div class="cal-grid-wrap">
      <div class="cal-grid-header">
        <span v-for="d in DAY_NAMES" :key="d" class="cal-day-header">{{ d }}</span>
      </div>
      <div class="cal-grid">
        <div
          v-for="(cell, i) in calCells"
          :key="i"
          class="cal-cell"
          :class="{
            'cal-cell--empty':    !cell.date,
            'cal-cell--today':    cell.date === TODAY,
            'cal-cell--selected': cell.date === selectedDate,
          }"
          @click="cell.date ? selectDay(cell.date) : undefined"
        >
          <template v-if="cell.day !== null">
            <span class="cal-cell-num">{{ cell.day }}</span>
            <div class="cal-cell-dots">
              <span
                v-if="txByDate.get(cell.date!)?.length"
                class="cal-dot cal-dot--tx"
                :title="txByDate.get(cell.date!)!.length + ' transaction(s)'"
              />
              <span
                v-if="upByDate.get(cell.date!)?.filter(u => !u.done).length"
                class="cal-dot cal-dot--up"
                :title="upByDate.get(cell.date!)!.filter(u => !u.done).length + ' upcoming'"
              />
              <span
                v-if="upByDate.get(cell.date!)?.some(u => u.done)"
                class="cal-dot cal-dot--done"
                :title="'done'"
              />
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Legend -->
    <div class="cal-legend">
      <span class="cal-legend-item"><span class="cal-dot cal-dot--tx" /> Transactions</span>
      <span class="cal-legend-item"><span class="cal-dot cal-dot--up" /> Upcoming</span>
      <span class="cal-legend-item"><span class="cal-dot cal-dot--done" /> Done</span>
    </div>

    <!-- Day detail panel -->
    <Transition name="cal-slide">
      <div v-if="selectedDate" class="cal-detail">
        <div class="cal-detail-header">
          <span class="cal-detail-date">{{ formatSelectedDate(selectedDate) }}</span>
          <button class="cal-detail-close" title="Close" @click="selectedDate = null">
            <i class="pi pi-times" />
          </button>
        </div>

        <div class="cal-detail-body">

          <!-- Actual transactions -->
          <div class="cal-detail-section">
            <div class="cal-detail-section-header">
              <span class="cal-detail-section-title">Transactions</span>
              <span class="cal-detail-count">{{ selectedTxs.length }}</span>
            </div>
            <div v-if="selectedTxs.length === 0" class="cal-detail-empty">No transactions recorded on this day.</div>
            <div v-else class="cal-tx-list">
              <div v-for="tx in selectedTxs" :key="tx.id" class="cal-tx-row">
                <span class="cal-tx-icon" :class="tx.type === 'in' ? 'cal-tx-icon--in' : 'cal-tx-icon--out'">
                  <i :class="tx.type === 'in' ? 'pi pi-arrow-down' : 'pi pi-arrow-up'" />
                </span>
                <div class="cal-tx-info">
                  <span class="cal-tx-name">{{ tx.name }}</span>
                  <span v-if="tx.notes" class="cal-tx-notes">{{ tx.notes }}</span>
                </div>
                <span class="cal-tx-amount" :class="tx.type === 'in' ? 'money-positive' : 'money-negative'">
                  {{ tx.type === 'in' ? '+' : '-' }}{{ formatMoney(tx.amount) }}
                </span>
              </div>
              <div v-if="selectedTxs.length > 1" class="cal-tx-total">
                <span>Day net</span>
                <span :class="selectedTxNet >= 0 ? 'money-positive' : 'money-negative'">
                  {{ formatMoney(selectedTxNet) }}
                </span>
              </div>
            </div>
          </div>

          <!-- Upcoming transactions -->
          <div class="cal-detail-section">
            <div class="cal-detail-section-header">
              <span class="cal-detail-section-title">Upcoming</span>
              <span class="cal-detail-count">{{ selectedUpcoming.length }}</span>
            </div>

            <div v-if="selectedUpcoming.length === 0 && !showAddForm" class="cal-detail-empty">
              No upcoming transactions planned for this day.
            </div>

            <div class="cal-up-list">
              <template v-for="u in selectedUpcoming" :key="u.id">

                <!-- Edit form -->
                <div v-if="editingId === u.id" class="cal-up-form-card">
                  <input v-model="editForm.title" placeholder="Title" class="cal-form-input" />
                  <div class="cal-form-row">
                    <input
                      v-model="editForm.amount"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      class="cal-form-input cal-form-input--amount"
                      @focus="moneyFocus"
                      @blur="moneyBlur"
                    />
                    <button
                      class="cal-type-btn"
                      :class="editForm.type === 'in' ? 'cal-type-btn--in' : 'cal-type-btn--out'"
                      type="button"
                      @click="editForm.type = editForm.type === 'in' ? 'out' : 'in'"
                    >{{ editForm.type === 'in' ? 'Money In' : 'Money Out' }}</button>
                  </div>
                  <input v-model="editForm.date" type="date" class="cal-form-input" />
                  <input v-model="editForm.notes" placeholder="Notes (optional)" class="cal-form-input" />
                  <select v-model="editForm.recurring" class="cal-form-input">
                    <option value="">One-time (no repeat)</option>
                    <option value="weekly">Repeats weekly</option>
                    <option value="monthly">Repeats monthly</option>
                    <option value="yearly">Repeats yearly</option>
                  </select>
                  <div class="cal-form-actions">
                    <button class="cal-btn cal-btn--primary" @click="submitEdit">Save</button>
                    <button class="cal-btn cal-btn--ghost" @click="cancelEdit">Cancel</button>
                  </div>
                </div>

                <!-- Link transaction panel -->
                <div v-else-if="linkingId === u.id" class="cal-up-form-card">
                  <p class="cal-link-hint">
                    <i class="pi pi-info-circle" />
                    Optionally link this to a recorded transaction, then mark as done.
                  </p>
                  <input
                    v-model="linkTxSearch"
                    placeholder="Search transactions by name or date…"
                    class="cal-form-input"
                  />
                  <div class="cal-link-list">
                    <button
                      v-for="tx in linkTxOptions"
                      :key="tx.id"
                      class="cal-link-option"
                      @click="confirmLink(tx.id)"
                    >
                      <span class="cal-link-option-date">{{ tx.date }}</span>
                      <span class="cal-link-option-name">{{ tx.name }}</span>
                      <span class="cal-link-option-amount" :class="tx.type === 'in' ? 'money-positive' : 'money-negative'">
                        {{ tx.type === 'in' ? '+' : '-' }}{{ formatMoney(tx.amount) }}
                      </span>
                    </button>
                    <div v-if="linkTxOptions.length === 0" class="cal-detail-empty">No matching transactions found.</div>
                  </div>
                  <div class="cal-form-actions">
                    <button class="cal-btn cal-btn--primary" @click="confirmLink(null)">Mark done without linking</button>
                    <button class="cal-btn cal-btn--ghost" @click="cancelLink">Cancel</button>
                  </div>
                </div>

                <!-- Normal row -->
                <div v-else class="cal-up-row" :class="{ 'cal-up-row--done': u.done }">
                  <span class="cal-up-icon" :class="u.type === 'in' ? 'cal-up-icon--in' : 'cal-up-icon--out'">
                    <i :class="u.type === 'in' ? 'pi pi-arrow-down' : 'pi pi-arrow-up'" />
                  </span>
                  <div class="cal-up-info">
                    <span class="cal-up-title">{{ u.title }}</span>
                    <span v-if="u.notes" class="cal-up-notes">{{ u.notes }}</span>
                    <span v-if="u.done && u.linkedTransactionId" class="cal-up-linked">
                      <i class="pi pi-link" style="font-size:0.6rem" /> Linked to transaction
                    </span>
                    <span v-else-if="u.done" class="cal-up-done-label">
                      <i class="pi pi-check-circle" style="font-size:0.6rem" /> Done
                    </span>
                    <span v-if="u.recurring && !u.done" class="cal-up-recurring-badge">
                      <i class="pi pi-refresh" style="font-size:0.55rem" /> {{ u.recurring }}
                    </span>
                  </div>
                  <span class="cal-up-amount" :class="u.type === 'in' ? 'money-positive' : 'money-negative'">
                    {{ u.type === 'in' ? '+' : '-' }}{{ formatMoney(u.amount) }}
                  </span>
                  <div class="cal-up-actions">
                    <template v-if="!u.done">
                      <button class="cal-icon-btn" title="Mark as done" @click="startLink(u.id)">
                        <i class="pi pi-check-circle" />
                      </button>
                      <button class="cal-icon-btn" title="Edit" @click="startEdit(u)">
                        <i class="pi pi-pencil" />
                      </button>
                    </template>
                    <button class="cal-icon-btn cal-icon-btn--danger" title="Delete" @click="deleteUpcoming(u.id)">
                      <i class="pi pi-trash" />
                    </button>
                  </div>
                </div>

              </template>
            </div>

            <!-- Add upcoming form -->
            <div v-if="showAddForm" class="cal-up-form-card">
              <div class="cal-form-row">
                <input
                  v-model="newForm.title"
                  placeholder="Title e.g. Rent, Electricity…"
                  class="cal-form-input cal-form-input--flex"
                />
                <button
                  class="cal-type-btn"
                  :class="newForm.type === 'in' ? 'cal-type-btn--in' : 'cal-type-btn--out'"
                  type="button"
                  @click="newForm.type = newForm.type === 'in' ? 'out' : 'in'"
                >{{ newForm.type === 'in' ? 'Money In' : 'Money Out' }}</button>
              </div>
              <div class="cal-form-row">
                <input
                  v-model="newForm.amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  class="cal-form-input cal-form-input--amount"
                  @focus="moneyFocus"
                  @blur="moneyBlur"
                />
                <input v-model="newForm.date" type="date" class="cal-form-input cal-form-input--date" />
              </div>
              <input v-model="newForm.notes" placeholder="Notes (optional)" class="cal-form-input" />
              <select v-model="newForm.recurring" class="cal-form-input">
                <option value="">One-time (no repeat)</option>
                <option value="weekly">Repeats weekly</option>
                <option value="monthly">Repeats monthly</option>
                <option value="yearly">Repeats yearly</option>
              </select>
              <div class="cal-form-actions">
                <button class="cal-btn cal-btn--primary" @click="submitAdd">Add</button>
                <button class="cal-btn cal-btn--ghost" @click="cancelAdd">Cancel</button>
              </div>
            </div>

            <button v-if="!showAddForm" class="cal-add-btn" @click="openAddForm">
              <i class="pi pi-plus" /> Add Upcoming Transaction
            </button>
          </div>

        </div>
      </div>
    </Transition>

    <!-- Upcoming transactions overview (all months) -->
    <div v-if="upStore.pending.length > 0" class="cal-pending-overview">
      <div class="cal-pending-header">
        <span class="cal-pending-title">All Pending Upcoming Transactions</span>
        <span class="cal-detail-count">{{ upStore.pending.length }}</span>
      </div>
      <div class="cal-pending-list">
        <div v-for="u in upStore.pending" :key="u.id" class="cal-pending-row">
          <span class="cal-up-icon" :class="u.type === 'in' ? 'cal-up-icon--in' : 'cal-up-icon--out'">
            <i :class="u.type === 'in' ? 'pi pi-arrow-down' : 'pi pi-arrow-up'" />
          </span>
          <span class="cal-pending-date">{{ u.date }}</span>
          <span class="cal-pending-name">{{ u.title }}</span>
          <span class="cal-up-amount" :class="u.type === 'in' ? 'money-positive' : 'money-negative'">
            {{ u.type === 'in' ? '+' : '-' }}{{ formatMoney(u.amount) }}
          </span>
          <button
            class="cal-icon-btn"
            title="View on calendar"
            @click="() => { const d = new Date(u.date + 'T00:00:00'); calYear = d.getFullYear(); calMonth = d.getMonth() + 1; selectDay(u.date) }"
          >
            <i class="pi pi-calendar" />
          </button>
        </div>
      </div>
    </div>

  </div>
</template>
