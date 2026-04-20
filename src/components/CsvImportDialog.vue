<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useTransactionStore } from '../stores/transactionStore'
import { useAccountStore } from '../stores/accountStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useImportHistoryStore } from '../stores/importHistoryStore'
import { processMultipleCsvFiles, CSV_ADAPTERS } from '../utils/csvAdapters'

const props = defineProps<{
  visible: boolean
  csvFiles: Array<{ text: string; fileName: string }>
}>()

const emit = defineEmits<{
  close: []
  done: [count: number]
}>()

const txStore      = useTransactionStore()
const accountStore = useAccountStore()
const settings     = useSettingsStore()
const historyStore = useImportHistoryStore()

// ── Bank / adapter selection ──────────────────────────────────
const selectedAdapterId = ref<string>('')

// ── Account selection ─────────────────────────────────────────
const selectedAccountId = ref<string>('')
const newAccountName    = ref('')

// ── Reset state when dialog opens ────────────────────────────
watch(() => props.visible, (v) => {
  if (!v) return
  selectedAccountId.value = 'new'
  newAccountName.value    = ''
})

// ── Parsed result (reactive to files + adapter choice) ───────
const processedResult = computed(() => {
  if (props.csvFiles.length === 0) return null
  if (!selectedAdapterId.value) return null // No adapter selected
  return processMultipleCsvFiles(props.csvFiles, selectedAdapterId.value)
})

// ── Import plan: how this import interacts with existing data ─
type ImportPlan =
  | { type: 'clean' }                                          // no existing data
  | { type: 'backfill'; replaceOB: boolean; earliestExisting: string; gapBridgeAmount: number; gapBridgeType: 'in' | 'out'; gapBridgeDate: string }
  | { type: 'forward'; needsGapBridge: boolean; latestExisting: string; gapBridgeAmount: number; gapBridgeType: 'in' | 'out'; gapBridgeDate: string }
  | { type: 'overlap' }

const importPlan = computed<ImportPlan | null>(() => {
  const result = processedResult.value
  if (!result || result.allRows.length === 0) return null

  const accId = selectedAccountId.value
  if (accId === '' || accId === 'new') return { type: 'clean' }

  const accountTxs = txStore.transactions.filter(t => t.accountId === accId)
  if (accountTxs.length === 0) return { type: 'clean' }

  const existingOBTx    = accountTxs.find(t => t.name === 'Opening Balance') ?? null
  const earliestExisting = accountTxs.reduce<string>((min, t) => t.date < min ? t.date : min, '9999-99-99')
  const latestExisting   = accountTxs.reduce<string>((max, t) => t.date > max ? t.date : max, '')

  const newOldest = result.allRows[0]?.isoDate ?? ''
  const newNewest = result.allRows[result.allRows.length - 1]?.isoDate ?? ''

  if (newNewest < earliestExisting) {
    // All new data is before existing records — backfill
    const oldOBSigned = existingOBTx
      ? (existingOBTx.type === 'in' ? existingOBTx.amount : -existingOBTx.amount)
      : 0
    const newOBSigned = result.openingBalance ?? 0
    // Estimate net of new rows (dedup not applied yet, so this is approximate)
    const estNet = Math.round(
      result.allRows.reduce<number>((s, r) => s + (r.type === 'in' ? r.amount : -r.amount), 0) * 100
    ) / 100
    const gapDiff = Math.round((oldOBSigned - newOBSigned - estNet) * 100) / 100
    return {
      type:            'backfill',
      replaceOB:       existingOBTx !== null,
      earliestExisting,
      gapBridgeAmount: Math.abs(gapDiff),
      gapBridgeType:   gapDiff > 0 ? 'in' : 'out',
      gapBridgeDate:   _dayBefore(earliestExisting),
    }
  }

  // Check for a forward date gap
  const dayAfterLatest = _dayAfter(latestExisting)
  if (newOldest > dayAfterLatest) {
    // New data starts after a gap from the latest existing transaction
    const currentBalance = Math.round(
      accountTxs.reduce<number>((s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0) * 100
    ) / 100
    const diff = result.openingBalance !== null
      ? Math.round((result.openingBalance - currentBalance) * 100) / 100
      : 0
    return {
      type:            'forward',
      needsGapBridge:  result.openingBalance !== null && Math.abs(diff) > 0.005,
      latestExisting,
      gapBridgeAmount: Math.abs(diff),
      gapBridgeType:   diff > 0 ? 'in' : 'out',
      gapBridgeDate:   result.openingDate,
    }
  }

  return { type: 'overlap' }
})

// ── Helpers ───────────────────────────────────────────────────
function _dayBefore(iso: string): string {
  const d = new Date(iso); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10)
}
function _dayAfter(iso: string): string {
  const d = new Date(iso); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10)
}

function formatMoney(v: number): string { return settings.formatMoney(v) }

// ── Can we proceed? ───────────────────────────────────────────
const canImport = computed(() => {
  if (!processedResult.value || processedResult.value.allRows.length === 0) return false
  if (selectedAccountId.value === 'new') return newAccountName.value.trim().length > 0
  return selectedAccountId.value !== ''
})

// ── Run the import ────────────────────────────────────────────
function handleImport(): void {
  if (!canImport.value) return
  const result = processedResult.value
  if (!result || result.allRows.length === 0) return

  // 1. Resolve or create account
  let accountId: string
  if (selectedAccountId.value === 'new') {
    const name = newAccountName.value.trim()
    if (!name) return
    accountId = accountStore.addAccount(name)
  } else {
    accountId = selectedAccountId.value
  }

  // 2. Snapshot existing state BEFORE any modifications
  const preTxs = txStore.transactions.filter(t => t.accountId === accountId)
  const hasExisting      = preTxs.length > 0
  const existingOBTx     = preTxs.find(t => t.name === 'Opening Balance') ?? null
  const earliestExisting = hasExisting ? preTxs.reduce((min, t) => t.date < min ? t.date : min, '9999-99-99') : ''
  const latestExisting   = hasExisting ? preTxs.reduce((max, t) => t.date > max ? t.date : max, '') : ''

  const newOldest = result.allRows[0]?.isoDate ?? ''
  const newNewest = result.allRows[result.allRows.length - 1]?.isoDate ?? ''

  const isBackfill    = hasExisting && newNewest < earliestExisting
  const hasForwardGap = hasExisting && newOldest > _dayAfter(latestExisting)

  // 3. Pre-compute forward gap amount using PRE-IMPORT balance
  let forwardGapAmount = 0
  let forwardGapType: 'in' | 'out' = 'in'
  if (hasForwardGap && result.openingBalance !== null && result.openingDate) {
    const currentBalance = Math.round(
      preTxs.reduce((s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0) * 100
    ) / 100
    const diff = Math.round((result.openingBalance - currentBalance) * 100) / 100
    forwardGapAmount = Math.abs(diff)
    forwardGapType   = diff > 0 ? 'in' : 'out'
  }

  // 4. Handle Opening Balance transaction
  if (isBackfill) {
    // Replace old (later) Opening Balance with the new, earlier one
    if (existingOBTx) txStore.deleteTransaction(existingOBTx.id)
    if (result.openingBalance !== null && result.openingDate) {
      txStore.addOpeningBalance(accountId, result.openingBalance, result.openingDate)
    }
  } else if (!hasExisting) {
    // Brand-new account or account with no transactions
    if (result.openingBalance !== null && result.openingDate) {
      txStore.addOpeningBalance(accountId, result.openingBalance, result.openingDate)
    }
  }
  // Forward / overlap: keep existing Opening Balance unchanged

  // 5. Insert forward gap bridge BEFORE importing rows
  if (hasForwardGap && forwardGapAmount > 0 && result.openingDate) {
    txStore.addTransaction({
      name: 'Balance Adjustment', date: result.openingDate,
      type: forwardGapType, amount: forwardGapAmount, itemId: null, accountId,
    })
  }

  // 6. Import all rows, deduplicating against existing transactions
  // Count-based dedup: allows legitimately repeated transactions (same date/amount/name)
  // while still skipping rows that are already in the store from a previous import.
  const existingKeyCounts = new Map<string, number>()
  for (const t of txStore.transactions.filter(t => t.accountId === accountId)) {
    const key = `${t.date}|${t.name}|${t.amount}|${t.type}`
    existingKeyCounts.set(key, (existingKeyCounts.get(key) ?? 0) + 1)
  }
  // eslint-disable-next-line no-console
  console.info('[IMPORT] Existing transaction keys:', Array.from(existingKeyCounts.entries()).slice(0, 10), '...')

  const consumedCounts = new Map<string, number>()
  let actualNet = 0
  let count     = 0
  for (const row of result.allRows) {
    const key = `${row.isoDate}|${row.details}|${row.amount}|${row.type}`
    const existing = existingKeyCounts.get(key) ?? 0
    const consumed = consumedCounts.get(key) ?? 0
    // eslint-disable-next-line no-console
    console.debug('[IMPORT] Row:', { row, key, existing, consumed })
    if (consumed < existing) {
      // This occurrence matches an already-imported row — skip it
      consumedCounts.set(key, consumed + 1)
      // Log skipped row
      // eslint-disable-next-line no-console
      console.warn('[IMPORT] Skipped duplicate row:', row)
    } else {
      // New occurrence — import it
      txStore.addTransaction({ name: row.details, date: row.isoDate, type: row.type, amount: row.amount, itemId: null, accountId })
      actualNet = Math.round((actualNet + (row.type === 'in' ? row.amount : -row.amount)) * 100) / 100
      count++
    }
  }
  // eslint-disable-next-line no-console
  console.info('[IMPORT] Finished import loop. Imported:', count, 'Skipped:', result.allRows.length - count)

  // 7. Inter-CSV gap adjustments (bridges between non-adjacent files)
  for (const gap of result.gapAdjustments) {
    const key = `${gap.date}|Balance Adjustment|${gap.amount}|${gap.type}`
    const existing = existingKeyCounts.get(key) ?? 0
    const consumed = consumedCounts.get(key) ?? 0
    if (consumed < existing) {
      consumedCounts.set(key, consumed + 1)
    } else {
      txStore.addTransaction({ name: 'Balance Adjustment', date: gap.date, type: gap.type, amount: gap.amount, itemId: null, accountId })
    }
  }

  // 8. Backfill gap bridge — computed after dedup so the amount is exact
  if (isBackfill && earliestExisting) {
    const oldOBSigned = existingOBTx
      ? (existingOBTx.type === 'in' ? existingOBTx.amount : -existingOBTx.amount)
      : 0
    const newOBSigned = result.openingBalance ?? 0
    const gapDiff = Math.round((oldOBSigned - newOBSigned - actualNet) * 100) / 100
    if (Math.abs(gapDiff) > 0.005) {
      txStore.addTransaction({
        name: 'Balance Adjustment', date: _dayBefore(earliestExisting),
        type: gapDiff > 0 ? 'in' : 'out', amount: Math.abs(gapDiff), itemId: null, accountId,
      })
    }
  }

  // 9. Record import history and close
  emit('done', count)
  if (count > 0) {
    historyStore.addRecord({
      bankName:  result.adapter.name,
      adapterId: result.adapter.id,
      fileName:  props.csvFiles.map(f => f.fileName).join(', '),
      rowCount:  count,
    })
  }
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="csv-dialog-fade">
      <div
        v-if="visible"
        class="csv-dialog-backdrop"
        :class="{ dark: ['dark','midnight','forest','purple'].includes(settings.theme), 'theme-midnight': settings.theme === 'midnight', 'theme-forest': settings.theme === 'forest', 'theme-purple': settings.theme === 'purple' }"
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

          <!-- Bank / format selector -->
          <div class="csv-dialog-section">
            <div class="csv-dialog-section-label">
              <i class="pi pi-building-columns" /> Bank / format
            </div>
            <div class="csv-dialog-account-list">
              <label
                v-for="adapter in CSV_ADAPTERS"
                :key="adapter.id"
                class="csv-dialog-option"
                :class="{ 'csv-dialog-option--selected': selectedAdapterId === adapter.id }"
              >
                <input type="radio" :value="adapter.id" v-model="selectedAdapterId" class="csv-dialog-radio" />
                <span class="csv-dialog-option-main">{{ adapter.name }}</span>
              </label>
            </div>
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

          <!-- Import summary -->
          <div v-if="processedResult && processedResult.allRows.length > 0" class="csv-dialog-section">
            <div class="csv-dialog-section-label">
              <i class="pi pi-info-circle" /> Import summary
            </div>

            <div class="csv-summary">
              <!-- File(s) info -->
              <div class="csv-summary-row">
                <i class="pi pi-file" />
                <span>
                  {{ props.csvFiles.length }} file{{ props.csvFiles.length > 1 ? 's' : '' }},
                  <strong>{{ processedResult.allRows.length }}</strong>
                  transaction{{ processedResult.allRows.length !== 1 ? 's' : '' }}
                </span>
              </div>
              <div v-if="props.csvFiles.length > 1" class="csv-summary-row csv-summary-muted">
                <i class="pi pi-list" />
                <span>{{ processedResult.csvSummaries.map(s => s.fileName).join(', ') }}</span>
              </div>

              <!-- Opening balance -->
              <div v-if="processedResult.openingBalance !== null" class="csv-summary-row">
                <i class="pi pi-flag" />
                <span>
                  Opening balance:
                  <strong>{{ formatMoney(processedResult.openingBalance) }}</strong>
                  <span class="csv-summary-muted"> on {{ processedResult.openingDate }}</span>
                </span>
              </div>
              <div v-else class="csv-summary-row csv-summary-warn">
                <i class="pi pi-exclamation-triangle" />
                <span>No balance data — opening balance cannot be calculated</span>
              </div>

              <!-- Inter-CSV gap bridges -->
              <div
                v-for="(gap, i) in processedResult.gapAdjustments"
                :key="i"
                class="csv-summary-row csv-summary-warn"
              >
                <i class="pi pi-arrows-h" />
                <span>
                  Gap {{ gap.label }}:
                  <strong>{{ gap.type === 'out' ? '-' : '+' }}{{ formatMoney(gap.amount) }}</strong>
                  balance adjustment on {{ gap.date }}
                </span>
              </div>
            </div>

            <!-- Backfill notice -->
            <div v-if="importPlan?.type === 'backfill'" class="csv-gap-notice">
              <i class="pi pi-history csv-gap-notice-icon" />
              <div class="csv-gap-notice-body">
                <span class="csv-gap-notice-title">Earlier data detected (backfill)</span>
                <span class="csv-gap-notice-detail">
                  This import covers data before the account's earliest record
                  (<strong>{{ importPlan.earliestExisting }}</strong>).
                  {{ importPlan.replaceOB ? 'The existing Opening Balance will be replaced with the earlier one.' : '' }}
                </span>
                <span v-if="importPlan.gapBridgeAmount > 0" class="csv-gap-notice-action">
                  A
                  <span :class="importPlan.gapBridgeType === 'out' ? 'money-negative' : 'money-positive'">
                    {{ importPlan.gapBridgeType === 'out' ? 'debit' : 'credit' }} of
                    {{ formatMoney(importPlan.gapBridgeAmount) }}
                  </span>
                  will be created on {{ importPlan.gapBridgeDate }} to bridge the gap.
                </span>
              </div>
            </div>

            <!-- Forward gap notice -->
            <div v-if="importPlan?.type === 'forward' && importPlan.needsGapBridge" class="csv-gap-notice">
              <i class="pi pi-exclamation-triangle csv-gap-notice-icon" />
              <div class="csv-gap-notice-body">
                <span class="csv-gap-notice-title">Balance gap detected</span>
                <span class="csv-gap-notice-detail">
                  Account's last record: <strong>{{ importPlan.latestExisting }}</strong>.
                  This import starts at <strong>{{ processedResult.allRows[0]?.isoDate }}</strong>.
                </span>
                <span class="csv-gap-notice-action">
                  A
                  <span :class="importPlan.gapBridgeType === 'out' ? 'money-negative' : 'money-positive'">
                    {{ importPlan.gapBridgeType === 'out' ? 'debit' : 'credit' }} of
                    {{ formatMoney(importPlan.gapBridgeAmount) }}
                  </span>
                  will be created on {{ importPlan.gapBridgeDate }} to bridge the gap.
                </span>
              </div>
            </div>
          </div>

          <!-- Empty -->
          <div v-else class="csv-dialog-empty">
            <i class="pi pi-exclamation-triangle" /> No valid transactions found in file(s).
          </div>

          <!-- Footer -->
          <div class="csv-dialog-footer">
            <button class="csv-dialog-cancel-btn" @click="emit('close')">Cancel</button>
            <button
              class="csv-dialog-import-btn"
              :disabled="!canImport"
              @click="handleImport"
            >
              <i class="pi pi-check" />
              Import {{ processedResult?.allRows.length ?? 0 }} Transaction{{ (processedResult?.allRows.length ?? 0) !== 1 ? 's' : '' }}
            </button>
          </div>

        </div>
      </div>
    </Transition>
  </Teleport>
</template>
