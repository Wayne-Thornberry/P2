<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useTransactionStore } from '../stores/transactionStore'
import { useAccountStore } from '../stores/accountStore'
import { useSettingsStore } from '../stores/settingsStore'

const props = defineProps<{
  visible: boolean
  csvText: string
}>()

const emit = defineEmits<{
  close: []
  done: [count: number]
}>()

const txStore      = useTransactionStore()
const accountStore = useAccountStore()
const settings     = useSettingsStore()

// ── Types ─────────────────────────────────────────────────────
type ParsedRow = {
  isoDate: string
  yearMonth: string
  details: string
  amount: number
  type: 'in' | 'out'
  balance: number | null
}

type StartOption = {
  id: string             // 'all' or 'YYYY-MM'
  label: string
  sublabel: string
  openingBalance: number | null
  openingDate: string
  importFromDate: string
  rowCount: number
}

// ── Account selection ─────────────────────────────────────────
const selectedAccountId = ref<string>('')
const newAccountName    = ref('')

// ── Parsed state ──────────────────────────────────────────────
const parsedRows    = ref<ParsedRow[]>([])
const startOptions  = ref<StartOption[]>([])
const selectedStart = ref<string>('all')

const activeOption = computed<StartOption | null>(() =>
  startOptions.value.find(o => o.id === selectedStart.value) ?? startOptions.value[0] ?? null
)

const canImport = computed(() => {
  if (selectedAccountId.value === 'new') return newAccountName.value.trim().length > 0
  return selectedAccountId.value !== ''
})

// ── Formatting ────────────────────────────────────────────────
function formatMoney(v: number): string { return settings.formatMoney(v) }

function toMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(settings.locale, { month: 'long', year: 'numeric' })
}

// ── CSV line parser ───────────────────────────────────────────
function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = '', inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

// ── Resolve column indices from a header row ──────────────────
function resolveColumnMap(headers: string[]): { date: number; details: number; debit: number; credit: number; balance: number } {
  const idx = (pattern: RegExp) =>
    headers.findIndex(h => pattern.test(h.trim()))

  const date    = idx(/^date$/i)
  const details = idx(/^description$/i)
  const debit   = idx(/^debit$/i)
  const credit  = idx(/^credit$/i)
  const balance = idx(/^balance$/i)

  return {
    date:    date    >= 0 ? date    : 0,
    details: details >= 0 ? details : 1,
    debit:   debit   >= 0 ? debit   : 2,
    credit:  credit  >= 0 ? credit  : 3,
    balance: balance >= 0 ? balance : 4,
  }
}

// ── Parse all rows from raw CSV text ─────────────────────────
function parseCsv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l)
  if (lines.length < 2) return []

  const first    = parseCsvLine(lines[0])
  const isHeader = isNaN(Date.parse(first[0])) || /date/i.test(first[0])
  const dataLines = isHeader ? lines.slice(1) : lines
  const colMap    = isHeader ? resolveColumnMap(first) : { date: 0, details: 1, debit: 2, credit: 3, balance: 4 }

  const rows: ParsedRow[] = []
  for (const line of dataLines) {
    const cols = parseCsvLine(line)
    if (cols.length < 4) continue

    const dateStr    = cols[colMap.date]?.trim()    ?? ''
    const details    = cols[colMap.details]?.trim() ?? ''
    const debitStr   = cols[colMap.debit]?.trim()   ?? ''
    const creditStr  = cols[colMap.credit]?.trim()  ?? ''
    const balanceStr = cols[colMap.balance]?.trim() ?? ''

    if (!details || !dateStr) continue

    const parts = dateStr.split('/')
    if (parts.length !== 3) continue
    const [dd, mm, yyyy] = parts
    const isoDate = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) continue

    const credit  = parseFloat(creditStr.replace(/,/g, ''))
    const debit   = parseFloat(debitStr.replace(/,/g, ''))
    const balance = parseFloat(balanceStr.replace(/,/g, ''))

    let amount: number, type: 'in' | 'out'
    if (!isNaN(credit) && credit > 0)    { amount = credit; type = 'in' }
    else if (!isNaN(debit) && debit > 0) { amount = debit;  type = 'out' }
    else continue

    rows.push({ isoDate, yearMonth: isoDate.slice(0, 7), details, amount, type, balance: isNaN(balance) ? null : balance })
  }

  return rows.sort((a, b) => a.isoDate.localeCompare(b.isoDate)) // oldest first
}

/**
 * Calculate the account balance BEFORE the very first row in the file.
 *
 * Uses the earliest balance checkpoint:
 *   opening + Σcredits − Σdebits = checkpoint_balance
 *   => opening = checkpoint_balance + Σdebits − Σcredits
 */
function calcOpeningFromRows(rows: ParsedRow[]): number | null {
  const idx = rows.findIndex(r => r.balance !== null)
  if (idx === -1) return null
  const slice = rows.slice(0, idx + 1)
  const totalCredits = slice.filter(r => r.type === 'in').reduce((s, r)  => s + r.amount, 0)
  const totalDebits  = slice.filter(r => r.type === 'out').reduce((s, r) => s + r.amount, 0)
  return Math.round((rows[idx].balance! + totalDebits - totalCredits) * 100) / 100
}

function dayBefore(iso: string): string {
  const d = new Date(iso)
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

// ── Build "start from" options from parsed rows ──────────────
function buildStartOptions(rows: ParsedRow[]): StartOption[] {
  if (rows.length === 0) return []

  const options: StartOption[] = []

  // Option A — import everything; opening balance back-calculated
  const opening = calcOpeningFromRows(rows)
  options.push({
    id:             'all',
    label:          'All transactions in file',
    sublabel:       opening !== null
                      ? `Opening balance: ${formatMoney(opening)}`
                      : 'No balance column data — opening balance will be skipped',
    openingBalance: opening,
    openingDate:    rows.length ? dayBefore(rows[0].isoDate) : '',
    importFromDate: rows[0]?.isoDate ?? '',
    rowCount:       rows.length,
  })

  // Option B+ — "After [Month]" using the month-end (closing) balance
  // Only shown for months that have a balance value AND have rows after them
  const months = [...new Set(rows.map(r => r.yearMonth))].sort()

  for (const ym of months) {
    const rowsAfter = rows.filter(r => r.yearMonth > ym)
    if (rowsAfter.length === 0) continue // nothing to import after this month

    const monthRows    = rows.filter(r => r.yearMonth === ym && r.balance !== null)
    if (monthRows.length === 0) continue // no balance data for this month

    const lastBal    = monthRows[monthRows.length - 1]
    const closing    = lastBal.balance!
    const closingDate = lastBal.isoDate

    const [y, m] = ym.split('-').map(Number)
    const nextYM = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`

    options.push({
      id:             ym,
      label:          `After ${toMonthLabel(ym)}`,
      sublabel:       `End-of-month balance: ${formatMoney(closing)} → set as opening balance`,
      openingBalance: closing,
      openingDate:    closingDate,
      importFromDate: `${nextYM}-01`,
      rowCount:       rowsAfter.length,
    })
  }

  return options
}

// ── Re-parse whenever dialog opens ───────────────────────────
watch(() => props.visible, (v) => {
  if (!v) return
  selectedAccountId.value = accountStore.accounts.length > 0 ? accountStore.accounts[0].id : 'new'
  newAccountName.value    = ''

  const rows = parseCsv(props.csvText)
  parsedRows.value    = rows
  startOptions.value  = buildStartOptions(rows)
  selectedStart.value = startOptions.value[0]?.id ?? 'all'
})

// ── Run the import ────────────────────────────────────────────
function handleImport(): void {
  if (!canImport.value || !activeOption.value) return

  // Resolve or create account
  let accountId: string
  if (selectedAccountId.value === 'new') {
    const name = newAccountName.value.trim()
    if (!name) return
    accountId = accountStore.addAccount(name)
  } else {
    accountId = selectedAccountId.value
  }

  const opt = activeOption.value

  // Add opening balance only if the account has no prior transactions
  const hasExisting = txStore.transactions.some(t => t.accountId === accountId)
  if (!hasExisting && opt.openingBalance !== null && opt.openingDate) {
    txStore.addOpeningBalance(accountId, opt.openingBalance, opt.openingDate)
  }

  // Import rows on/after importFromDate, deduplicating
  const existingKeys = new Set(txStore.transactions.map(t => `${t.date}|${t.name}|${t.amount}|${t.type}`))
  let count = 0
  for (const row of parsedRows.value) {
    if (row.isoDate < opt.importFromDate) continue
    const key = `${row.isoDate}|${row.details}|${row.amount}|${row.type}`
    if (!existingKeys.has(key)) {
      existingKeys.add(key)
      txStore.addTransaction({ name: row.details, date: row.isoDate, type: row.type, amount: row.amount, itemId: null, accountId })
      count++
    }
  }

  emit('done', count)
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="csv-dialog-fade">
      <div
        v-if="visible"
        class="csv-dialog-backdrop"
        :class="{ dark: settings.theme === 'dark' }"
        @click.self="emit('close')"
      >
        <div class="csv-dialog" role="dialog" aria-modal="true">

          <!-- Header -->
          <div class="csv-dialog-header">
            <div class="csv-dialog-title">
              <i class="pi pi-upload" />
              Import CSV Transactions
            </div>
            <button class="csv-dialog-close" @click="emit('close')" title="Close">
              <i class="pi pi-times" />
            </button>
          </div>

          <!-- Account -->
          <div class="csv-dialog-section">
            <div class="csv-dialog-section-label">
              <i class="pi pi-credit-card" /> Assign to account
            </div>
            <div class="csv-dialog-account-list">
              <label
                v-for="acc in accountStore.accounts"
                :key="acc.id"
                class="csv-dialog-option"
                :class="{ 'csv-dialog-option--selected': selectedAccountId === acc.id }"
              >
                <input type="radio" :value="acc.id" v-model="selectedAccountId" class="csv-dialog-radio" />
                <span class="csv-dialog-option-main">{{ acc.name }}</span>
              </label>
              <label
                class="csv-dialog-option csv-dialog-option--new"
                :class="{ 'csv-dialog-option--selected': selectedAccountId === 'new' }"
              >
                <input type="radio" value="new" v-model="selectedAccountId" class="csv-dialog-radio" />
                <span class="csv-dialog-option-main"><i class="pi pi-plus" /> Create new account</span>
              </label>
            </div>
            <div v-if="selectedAccountId === 'new'" class="csv-dialog-new-account">
              <input
                v-model="newAccountName"
                type="text"
                class="csv-dialog-input"
                placeholder="Account name…"
                @keydown.enter="handleImport"
                autofocus
              />
            </div>
          </div>

          <!-- Start from -->
          <div class="csv-dialog-section" v-if="startOptions.length > 0">
            <div class="csv-dialog-section-label">
              <i class="pi pi-flag" /> Start from
              <span class="csv-dialog-section-hint">Opening balance is auto-calculated from the balance column in your CSV</span>
            </div>
            <div class="csv-dialog-start-list">
              <label
                v-for="opt in startOptions"
                :key="opt.id"
                class="csv-dialog-option csv-dialog-option--start"
                :class="{ 'csv-dialog-option--selected': selectedStart === opt.id }"
              >
                <input type="radio" :value="opt.id" v-model="selectedStart" class="csv-dialog-radio" style="margin-top:0.15rem" />
                <div class="csv-dialog-start-text">
                  <span class="csv-dialog-option-main">{{ opt.label }}</span>
                  <span class="csv-dialog-start-balance">{{ opt.sublabel }}</span>
                  <span class="csv-dialog-start-count">{{ opt.rowCount }} transaction{{ opt.rowCount !== 1 ? 's' : '' }} to import</span>
                </div>
              </label>
            </div>
          </div>

          <!-- Empty -->
          <div v-else class="csv-dialog-empty">
            <i class="pi pi-exclamation-triangle" /> No valid transactions found in file.
          </div>

          <!-- Footer -->
          <div class="csv-dialog-footer">
            <button class="csv-dialog-cancel-btn" @click="emit('close')">Cancel</button>
            <button
              class="csv-dialog-import-btn"
              :disabled="!canImport || startOptions.length === 0"
              @click="handleImport"
            >
              <i class="pi pi-check" /> Import {{ activeOption?.rowCount ?? 0 }} Transactions
            </button>
          </div>

        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
.csv-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.csv-dialog {
  background: #ffffff;
  color: #18181b;
  width: 100%;
  max-width: 28rem;
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.35);
}
.dark .csv-dialog { background: #1c1c1e; color: #f4f4f5; }

.csv-dialog-fade-enter-active,
.csv-dialog-fade-leave-active { transition: opacity 0.18s ease; }
.csv-dialog-fade-enter-from,
.csv-dialog-fade-leave-to { opacity: 0; }
.csv-dialog-fade-enter-active .csv-dialog,
.csv-dialog-fade-leave-active .csv-dialog { transition: transform 0.18s ease; }
.csv-dialog-fade-enter-from .csv-dialog,
.csv-dialog-fade-leave-to .csv-dialog { transform: translateY(12px); }

.csv-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 1rem 0.75rem;
  border-bottom: 2px solid #e4e4e7;
  flex-shrink: 0;
}
.dark .csv-dialog-header { border-bottom-color: #3f3f46; }

.csv-dialog-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.csv-dialog-close {
  background: none;
  border: none;
  cursor: pointer;
  color: #71717a;
  font-size: 0.85rem;
  padding: 0.3rem;
  display: flex;
  align-items: center;
  transition: color 0.1s;
}
.csv-dialog-close:hover { color: #18181b; }
.dark .csv-dialog-close:hover { color: #f4f4f5; }

.csv-dialog-section {
  padding: 0.85rem 1rem;
  border-bottom: 1px solid #e4e4e7;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.dark .csv-dialog-section { border-bottom-color: #3f3f46; }

.csv-dialog-section-label {
  font-size: 0.65rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #71717a;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.dark .csv-dialog-section-label { color: #a1a1aa; }

.csv-dialog-section-hint {
  font-size: 0.6rem;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  color: #a1a1aa;
}

.csv-dialog-account-list,
.csv-dialog-start-list {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.csv-dialog-option {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0.65rem;
  border: 2px solid #d4d4d8;
  cursor: pointer;
  transition: border-color 0.12s, background-color 0.12s;
}
.dark .csv-dialog-option { border-color: #52525b; }
.csv-dialog-option--selected { border-color: #3b82f6; background: #eff6ff; }
.dark .csv-dialog-option--selected { border-color: #3b82f6; background: #1e3a5f; }
.csv-dialog-option--new { color: #3b82f6; }
.dark .csv-dialog-option--new { color: #60a5fa; }
.csv-dialog-option--start { align-items: flex-start; }

.csv-dialog-radio {
  accent-color: #3b82f6;
  width: 0.9rem;
  height: 0.9rem;
  flex-shrink: 0;
}

.csv-dialog-option-main {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  font-weight: 700;
}

.csv-dialog-start-text {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.csv-dialog-start-balance {
  font-size: 0.7rem;
  font-weight: 600;
  color: #16a34a;
}
.dark .csv-dialog-start-balance { color: #4ade80; }

.csv-dialog-start-count {
  font-size: 0.62rem;
  color: #71717a;
}
.dark .csv-dialog-start-count { color: #a1a1aa; }

.csv-dialog-new-account { padding-top: 0.1rem; }

.csv-dialog-input {
  width: 100%;
  font-size: 0.8rem;
  padding: 0.4rem 0.6rem;
  border: 2px solid #d4d4d8;
  background: #ffffff;
  color: #18181b;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.12s;
}
.csv-dialog-input:focus { border-color: #3b82f6; }
.dark .csv-dialog-input { background: #3f3f46; color: #f4f4f5; border-color: #52525b; }
.dark .csv-dialog-input:focus { border-color: #3b82f6; }

.csv-dialog-empty {
  padding: 1.5rem 1rem;
  font-size: 0.8rem;
  color: #71717a;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.dark .csv-dialog-empty { color: #a1a1aa; }

.csv-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.6rem;
  padding: 0.75rem 1rem;
}

.csv-dialog-cancel-btn {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.35rem 0.85rem;
  border: 2px solid #d4d4d8;
  background: none;
  color: #71717a;
  cursor: pointer;
  transition: border-color 0.12s, color 0.12s;
}
.csv-dialog-cancel-btn:hover { border-color: #71717a; color: #18181b; }
.dark .csv-dialog-cancel-btn { border-color: #52525b; color: #a1a1aa; }
.dark .csv-dialog-cancel-btn:hover { border-color: #a1a1aa; color: #f4f4f5; }

.csv-dialog-import-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.7rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0.4rem 1rem;
  background: #18181b;
  color: #f4f4f5;
  border: none;
  cursor: pointer;
  transition: background-color 0.12s;
}
.csv-dialog-import-btn:hover:not(:disabled) { background: #3f3f46; }
.csv-dialog-import-btn:disabled { opacity: 0.35; cursor: default; }
.dark .csv-dialog-import-btn { background: #e4e4e7; color: #18181b; }
.dark .csv-dialog-import-btn:hover:not(:disabled) { background: #f4f4f5; }
</style>
