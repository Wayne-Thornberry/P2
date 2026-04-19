<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSettingsStore } from '../stores/settingsStore'
import { useBudgetStore } from '../stores/budgetStore'
import { useTransactionStore } from '../stores/transactionStore'
import { useAccountStore } from '../stores/accountStore'
import { useTemplateStore } from '../stores/templateStore'
import { generateBudgetItems } from '../data/budgetSeedData'
import { BUDGET_TEMPLATE } from '../data/budgetTemplate'
import { downloadExport, importFromFile } from '../utils/persistence'

const settings       = useSettingsStore()
const budgetStore    = useBudgetStore()
const txnStore       = useTransactionStore()
const accountStore   = useAccountStore()
const templateStore  = useTemplateStore()

// ── Data export / import ──────────────────────────────────────
const importError   = ref<string | null>(null)
const importSuccess = ref(false)
let _importTimeout: ReturnType<typeof setTimeout> | null = null

function handleExport(): void {
  downloadExport()
}

function handleImportClick(): void {
  const input = document.createElement('input')
  input.type   = 'file'
  input.accept = '.json,application/json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    importError.value   = null
    importSuccess.value = false
    try {
      await importFromFile(file)
      importSuccess.value = true
    } catch (e) {
      importError.value = e instanceof Error ? e.message : 'Import failed.'
    } finally {
      if (_importTimeout) clearTimeout(_importTimeout)
      _importTimeout = setTimeout(() => { importSuccess.value = false; importError.value = null }, 5000)
    }
  }
  input.click()
}

function clearAllData(): void {
  if (!confirm('This will permanently delete all accounts, transactions, budget items, and templates. Settings will be kept. This cannot be undone. Continue?')) return
  const keys = ['clearbook_accounts', 'clearbook_transactions', 'clearbook_budget', 'clearbook_template']
  for (const key of keys) localStorage.removeItem(key)
  window.location.reload()
}

// ── Debug generators ──────────────────────────────────────────
const _now = new Date()
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

// Period pickers
const budgetYear  = ref(_now.getFullYear())
const budgetMonth = ref(0) // 0 = all months
const txYear      = ref(_now.getFullYear())
const txMonth     = ref(_now.getMonth() + 1)

// Per-button confirmation messages
const msgItems    = ref('')
const msgBudgets  = ref('')
const msgTx       = ref('')
const msgAccounts = ref('')
const msgTemplate = ref('')

function _flashMsg(r: ReturnType<typeof ref<string>>, text: string): void {
  r.value = text
  setTimeout(() => { r.value = '' }, 4000)
}

// ── 1. Generate Items ─────────────────────────────────────────
function generateItems(): void {
  const seedItems = generateBudgetItems()
  let added = 0
  for (const item of seedItems) {
    const existing = budgetStore.globalItems.find(i => i.name === item.name)
    if (!existing) {
      budgetStore.getOrCreateGlobalItem(item.name)
      added++
    }
  }
  _flashMsg(msgItems, added > 0 ? `${added} item${added !== 1 ? 's' : ''} added.` : 'All items already exist.')
}

// ── 2. Generate Accounts ──────────────────────────────────────
function generateAccounts(): void {
  accountStore.loadSeedData()
  _flashMsg(msgAccounts, '5 accounts seeded.')
}

// ── 3. Generate Template ──────────────────────────────────────
function generateTemplate(): void {
  const hasItems = budgetStore.globalItems.length > 0
  if (hasItems) {
    templateStore.resetToDefault()
    _flashMsg(msgTemplate, 'Template seeded from default item list.')
  } else {
    // Just seed categories with placeholder items
    const cats = [...new Set(BUDGET_TEMPLATE.map(i => i.category))]
    for (const cat of cats) templateStore.addCategory(cat)
    _flashMsg(msgTemplate, `${cats.length} categories added (no items — placeholders created).`)
  }
}

// ── 4. Generate Budgets ───────────────────────────────────────
function generateBudgets(): void {
  const months = budgetMonth.value === 0
    ? Array.from({ length: 12 }, (_, i) => i + 1)
    : [budgetMonth.value]
  const year = budgetYear.value

  const hasTemplate = templateStore.entries.length > 0
  const seedItems   = generateBudgetItems() // used when no template

  for (const m of months) {
    budgetStore.monthlyEntries[year] ??= {}
    if (hasTemplate) {
      // Deep-copy template entries into this month
      budgetStore.monthlyEntries[year]![m] = JSON.parse(JSON.stringify(templateStore.entries))
    } else {
      // Seed from the default budget items — register global items if needed
      budgetStore.monthlyEntries[year]![m] = seedItems.map(item => ({
        itemId:   budgetStore.getOrCreateGlobalItem(item.name),
        assigned: item.assigned,
        category: item.category,
      }))
    }
  }

  const label = budgetMonth.value === 0
    ? `all 12 months of ${year}`
    : `${MONTH_NAMES[budgetMonth.value - 1]} ${year}`
  const src = hasTemplate ? 'template' : 'default seed items'
  _flashMsg(msgBudgets, `Budgets generated for ${label} (from ${src}).`)
}

// ── 5. Generate Transactions ──────────────────────────────────
function _randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}
function _randAmount(base: number, variance: number): number {
  const delta = base * variance
  const raw = base + (Math.random() * 2 - 1) * delta
  return Math.round(Math.max(0.01, raw) * 100) / 100
}
function _pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

function generateTransactions(): void {
  const accounts = accountStore.accounts
  const year  = txYear.value
  const months = txMonth.value === 0
    ? Array.from({ length: 12 }, (_, i) => i + 1)
    : [txMonth.value]

  let totalAdded = 0

  for (const m of months) {
    const days = new Date(year, m, 0).getDate()
    const mStr = String(m).padStart(2, '0')

    // Prefer items from the budget for this month; fall back to all global items
    const monthEntries = budgetStore.monthlyEntries[year]?.[m] ?? []
    const defsMap = new Map(budgetStore.globalItems.map(i => [i.id, i]))
    type ItemRow = { id: number; name: string; category: string; assigned: number }
    const rows: ItemRow[] = monthEntries.length > 0
      ? monthEntries
          .filter(e => defsMap.has(e.itemId))
          .map(e => ({ id: e.itemId, name: defsMap.get(e.itemId)!.name, category: e.category, assigned: e.assigned }))
      : budgetStore.globalItems.map(i => ({ id: i.id, name: i.name, category: 'General', assigned: 0 }))

    if (rows.length === 0) continue

    for (const row of rows) {
      const base  = row.assigned > 0 ? row.assigned : 50
      const count = _randInt(1, Math.min(4, Math.ceil(base / 50)))

      // Pick a random bias for this item: ±5% means in/out totals stay within ~10% of each other.
      // Positive bias → out slightly exceeds in; negative → in slightly exceeds out.
      const bias = (Math.random() * 0.1) - 0.05  // -0.05 … +0.05

      // Spread the target total across `count` transactions per direction.
      // out target = base + half bias; in target = base - half bias
      const outTarget = Math.max(0.01, base * (1 + bias / 2))
      const inTarget  = Math.max(0.01, base * (1 - bias / 2))

      for (let n = 0; n < count; n++) {
        const day    = String(_randInt(1, days)).padStart(2, '0')
        const date   = `${year}-${mStr}-${day}`
        // Spread the per-direction target evenly across count, with small per-tx noise
        const outAmt = _randAmount(outTarget / count, 0.05)
        const inAmt  = _randAmount(inTarget  / count, 0.05)

        // Always emit one 'out' and one 'in' per iteration to keep them paired
        txnStore.addTransaction({
          name: row.name, date, type: 'out', amount: outAmt,
          itemId: row.id, accountId: accounts.length > 0 ? _pick(accounts).id : null,
        })
        txnStore.addTransaction({
          name: row.name, date, type: 'in', amount: inAmt,
          itemId: row.id, accountId: accounts.length > 0 ? _pick(accounts).id : null,
        })
        totalAdded += 2
      }
    }
  }

  const label = txMonth.value === 0
    ? `all 12 months of ${year}`
    : `${MONTH_NAMES[txMonth.value - 1]} ${year}`
  _flashMsg(msgTx, `${totalAdded} transaction${totalAdded !== 1 ? 's' : ''} added for ${label}.`)
}

// ── Balance cutoff helpers ───────────────────────────────────
const cutoffTransactionCount = computed(() => {
  const c = settings.balanceCutoffDate
  if (!c) return txnStore.transactions.length
  return txnStore.transactions.filter(t => t.date >= c).length
})

const cutoffSumPreview = computed(() => {
  const c = settings.balanceCutoffDate
  const txs = c ? txnStore.transactions.filter(t => t.date >= c) : txnStore.transactions
  const sum = Math.round(txs.reduce((s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0) * 100) / 100
  return c ? Math.round((settings.openingBalance + sum) * 100) / 100 : sum
})

function clearCutoff(): void {
  settings.balanceCutoffDate = ''
  settings.openingBalance    = 0
}
const LOCALES = [
  { value: 'en-US', label: 'English (United States)' },
  { value: 'en-GB', label: 'English (United Kingdom)' },
  { value: 'en-AU', label: 'English (Australia)' },
  { value: 'en-CA', label: 'English (Canada)' },
  { value: 'en-NZ', label: 'English (New Zealand)' },
  { value: 'en-IE', label: 'English (Ireland)' },
  { value: 'en-IN', label: 'English (India)' },
  { value: 'en-SG', label: 'English (Singapore)' },
  { value: 'de-DE', label: 'Deutsch (Deutschland)' },
  { value: 'de-AT', label: 'Deutsch (Österreich)' },
  { value: 'de-CH', label: 'Deutsch (Schweiz)' },
  { value: 'fr-FR', label: 'Français (France)' },
  { value: 'fr-BE', label: 'Français (Belgique)' },
  { value: 'fr-CA', label: 'Français (Canada)' },
  { value: 'fr-CH', label: 'Français (Suisse)' },
  { value: 'es-ES', label: 'Español (España)' },
  { value: 'es-MX', label: 'Español (México)' },
  { value: 'es-AR', label: 'Español (Argentina)' },
  { value: 'it-IT', label: 'Italiano (Italia)' },
  { value: 'pt-PT', label: 'Português (Portugal)' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'nl-NL', label: 'Nederlands (Nederland)' },
  { value: 'nl-BE', label: 'Nederlands (België)' },
  { value: 'sv-SE', label: 'Svenska (Sverige)' },
  { value: 'nb-NO', label: 'Norsk (Norge)' },
  { value: 'da-DK', label: 'Dansk (Danmark)' },
  { value: 'fi-FI', label: 'Suomi (Suomi)' },
  { value: 'pl-PL', label: 'Polski (Polska)' },
  { value: 'ru-RU', label: 'Русский (Россия)' },
  { value: 'tr-TR', label: 'Türkçe (Türkiye)' },
  { value: 'ar-SA', label: 'العربية (السعودية)' },
  { value: 'he-IL', label: 'עברית (ישראל)' },
  { value: 'hi-IN', label: 'हिन्दी (भारत)' },
  { value: 'ja-JP', label: '日本語 (日本)' },
  { value: 'zh-CN', label: '中文 (简体, 中国)' },
  { value: 'zh-TW', label: '中文 (繁體, 台灣)' },
  { value: 'ko-KR', label: '한국어 (대한민국)' },
]

// ── Currency options ──────────────────────────────────────────
const CURRENCIES = [
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'JPY', label: 'JPY — Japanese Yen' },
  { value: 'CNY', label: 'CNY — Chinese Yuan' },
  { value: 'AUD', label: 'AUD — Australian Dollar' },
  { value: 'CAD', label: 'CAD — Canadian Dollar' },
  { value: 'CHF', label: 'CHF — Swiss Franc' },
  { value: 'SEK', label: 'SEK — Swedish Krona' },
  { value: 'NOK', label: 'NOK — Norwegian Krone' },
  { value: 'DKK', label: 'DKK — Danish Krone' },
  { value: 'NZD', label: 'NZD — New Zealand Dollar' },
  { value: 'MXN', label: 'MXN — Mexican Peso' },
  { value: 'BRL', label: 'BRL — Brazilian Real' },
  { value: 'INR', label: 'INR — Indian Rupee' },
  { value: 'RUB', label: 'RUB — Russian Ruble' },
  { value: 'KRW', label: 'KRW — South Korean Won' },
  { value: 'HKD', label: 'HKD — Hong Kong Dollar' },
  { value: 'SGD', label: 'SGD — Singapore Dollar' },
  { value: 'TWD', label: 'TWD — Taiwan Dollar' },
  { value: 'PLN', label: 'PLN — Polish Złoty' },
  { value: 'TRY', label: 'TRY — Turkish Lira' },
  { value: 'SAR', label: 'SAR — Saudi Riyal' },
  { value: 'AED', label: 'AED — UAE Dirham' },
  { value: 'ILS', label: 'ILS — Israeli Shekel' },
  { value: 'ZAR', label: 'ZAR — South African Rand' },
  { value: 'ARS', label: 'ARS — Argentine Peso' },
  { value: 'COP', label: 'COP — Colombian Peso' },
]

// ── Live preview ──────────────────────────────────────────────
const PREVIEW_DATE    = '2026-04-08'
const PREVIEW_ISO     = new Date(2026, 3, 8, 14, 30).toISOString()
const PREVIEW_AMOUNT  = 1234567.89
const PREVIEW_AMOUNT2 = -842.5

const previewMoney    = computed(() => settings.formatMoney(PREVIEW_AMOUNT))
const previewMoney2   = computed(() => settings.formatMoney(PREVIEW_AMOUNT2))
const previewDate     = computed(() => settings.formatDate(PREVIEW_DATE))
const previewCreated  = computed(() => settings.formatCreatedAt(PREVIEW_ISO))
</script>

<template>
  <div class="settings-page">

    <!-- Appearance ───────────────────────────────────────────── -->
    <div class="settings-section">
      <h2 class="settings-section-title">Appearance</h2>
      <div class="settings-row">
        <div class="settings-label">
          <span class="settings-label-text">Theme</span>
          <span class="settings-label-hint">Controls the colour scheme of the application</span>
        </div>
        <div class="settings-control">
          <div class="theme-picker">
            <button
              :class="['theme-card', settings.theme === 'dark' && 'theme-card-active']"
              @click="settings.theme = 'dark'"
            >
              <div class="theme-card-swatch">
                <div class="theme-card-band" style="background:#18181b" />
                <div class="theme-card-band" style="background:#27272a" />
                <div class="theme-card-accent" style="background:#71717a" />
              </div>
              <span class="theme-card-label"><i class="pi pi-moon" /> Dark</span>
            </button>
            <button
              :class="['theme-card', settings.theme === 'light' && 'theme-card-active']"
              @click="settings.theme = 'light'"
            >
              <div class="theme-card-swatch">
                <div class="theme-card-band" style="background:#e4e4e7" />
                <div class="theme-card-band" style="background:#ffffff" />
                <div class="theme-card-accent" style="background:#18181b" />
              </div>
              <span class="theme-card-label"><i class="pi pi-sun" /> Light</span>
            </button>
            <button
              :class="['theme-card', settings.theme === 'midnight' && 'theme-card-active']"
              @click="settings.theme = 'midnight'"
            >
              <div class="theme-card-swatch">
                <div class="theme-card-band" style="background:#0f172a" />
                <div class="theme-card-band" style="background:#1e293b" />
                <div class="theme-card-accent" style="background:#6366f1" />
              </div>
              <span class="theme-card-label"><i class="pi pi-star" /> Midnight</span>
            </button>
            <button
              :class="['theme-card', settings.theme === 'forest' && 'theme-card-active']"
              @click="settings.theme = 'forest'"
            >
              <div class="theme-card-swatch">
                <div class="theme-card-band" style="background:#101f16" />
                <div class="theme-card-band" style="background:#1a3d24" />
                <div class="theme-card-accent" style="background:#f59e0b" />
              </div>
              <span class="theme-card-label"><i class="pi pi-tree" /> Forest</span>
            </button>
            <button
              :class="['theme-card', settings.theme === 'purple' && 'theme-card-active']"
              @click="settings.theme = 'purple'"
            >
              <div class="theme-card-swatch">
                <div class="theme-card-band" style="background:#1a0930" />
                <div class="theme-card-band" style="background:#2c1040" />
                <div class="theme-card-accent" style="background:#e879f9" />
              </div>
              <span class="theme-card-label"><i class="pi pi-circle" /> Purple</span>
            </button>
            <button
              :class="['theme-card', settings.theme === 'slate' && 'theme-card-active']"
              @click="settings.theme = 'slate'"
            >
              <div class="theme-card-swatch">
                <div class="theme-card-band" style="background:#e8eaf0" />
                <div class="theme-card-band" style="background:#f3f4f8" />
                <div class="theme-card-accent" style="background:#6366f1" />
              </div>
              <span class="theme-card-label"><i class="pi pi-stop" /> Slate</span>
            </button>
            <button
              :class="['theme-card', settings.theme === 'rose' && 'theme-card-active']"
              @click="settings.theme = 'rose'"
            >
              <div class="theme-card-swatch">
                <div class="theme-card-band" style="background:#fce4e8" />
                <div class="theme-card-band" style="background:#fff5f6" />
                <div class="theme-card-accent" style="background:#f43f5e" />
              </div>
              <span class="theme-card-label"><i class="pi pi-heart" /> Rose</span>
            </button>
            <button
              :class="['theme-card', settings.theme === 'teal' && 'theme-card-active']"
              @click="settings.theme = 'teal'"
            >
              <div class="theme-card-swatch">
                <div class="theme-card-band" style="background:#d8f5f1" />
                <div class="theme-card-band" style="background:#f0fdfa" />
                <div class="theme-card-accent" style="background:#14b8a6" />
              </div>
              <span class="theme-card-label"><i class="pi pi-compass" /> Teal</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Locale & Currency ───────────────────────────────────── -->
    <div class="settings-section">
      <h2 class="settings-section-title">Locale &amp; Currency</h2>

      <div class="settings-row">
        <div class="settings-label">
          <span class="settings-label-text">Locale</span>
          <span class="settings-label-hint">Affects number formatting and language defaults</span>
        </div>
        <div class="settings-control">
          <select v-model="settings.locale" class="settings-select">
            <option
              v-for="opt in LOCALES"
              :key="opt.value"
              :value="opt.value"
            >{{ opt.label }}</option>
          </select>
        </div>
      </div>

      <div class="settings-row">
        <div class="settings-label">
          <span class="settings-label-text">Currency</span>
          <span class="settings-label-hint">Used throughout the budget and transaction views</span>
        </div>
        <div class="settings-control">
          <select v-model="settings.currency" class="settings-select">
            <option
              v-for="opt in CURRENCIES"
              :key="opt.value"
              :value="opt.value"
            >{{ opt.label }}</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Date & Time ─────────────────────────────────────────── -->
    <div class="settings-section">
      <h2 class="settings-section-title">Date &amp; Time</h2>

      <div class="settings-row">
        <div class="settings-label">
          <span class="settings-label-text">Date format</span>
          <span class="settings-label-hint">How dates appear in tables and logs</span>
        </div>
        <div class="settings-control">
          <div class="radio-group">
            <label v-for="opt in [
              { value: 'short',  example: '4/8/2026' },
              { value: 'medium', example: 'Apr 8, 2026' },
              { value: 'long',   example: 'April 8, 2026' },
              { value: 'iso',    example: '2026-04-08' },
            ]" :key="opt.value" class="radio-option">
              <input
                type="radio"
                :value="opt.value"
                v-model="settings.dateStyle"
                class="radio-input"
              />
              <span class="radio-label">{{ opt.value.charAt(0).toUpperCase() + opt.value.slice(1) }}</span>
              <span class="radio-example">{{ opt.example }}</span>
            </label>
          </div>
        </div>
      </div>

      <div class="settings-row">
        <div class="settings-label">
          <span class="settings-label-text">Time format</span>
          <span class="settings-label-hint">12-hour (AM/PM) or 24-hour clock</span>
        </div>
        <div class="settings-control">
          <div class="toggle-group">
            <button
              :class="['toggle-btn', settings.timeStyle === '12h' && 'toggle-btn-active']"
              @click="settings.timeStyle = '12h'"
            >12-hour</button>
            <button
              :class="['toggle-btn', settings.timeStyle === '24h' && 'toggle-btn-active']"
              @click="settings.timeStyle = '24h'"
            >24-hour</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Live preview ─────────────────────────────────────────── -->
    <div class="settings-section">
      <h2 class="settings-section-title">Preview</h2>
      <div class="settings-preview">
        <div class="preview-row">
          <span class="preview-label">Currency</span>
          <span class="preview-value money-positive">{{ previewMoney }}</span>
        </div>
        <div class="preview-row">
          <span class="preview-label">Currency (negative)</span>
          <span class="preview-value money-negative">{{ previewMoney2 }}</span>
        </div>
        <div class="preview-row">
          <span class="preview-label">Date</span>
          <span class="preview-value">{{ previewDate }}</span>
        </div>
        <div class="preview-row">
          <span class="preview-label">Date &amp; Time</span>
          <span class="preview-value">{{ previewCreated }}</span>
        </div>
      </div>
    </div>

    <!-- Balance Cutoff ──────────────────────────────────────── -->
    <div class="settings-section settings-section--full">
      <h2 class="settings-section-title">Balance Cutoff</h2>
      <p class="settings-section-hint">
        If you have imported historical transactions that don't reflect your real current balance
        (e.g. a data gap between years), set a cutoff date and enter your known opening balance
        as of that date. <strong>Total Funds Available</strong> will then be calculated as:
        <em>Opening Balance + sum of all transactions on or after the cutoff date</em>.
        Leave blank to use the all-time total (default).
      </p>

      <div class="settings-row">
        <div class="settings-label">
          <span class="settings-label-text">Cutoff Date</span>
          <span class="settings-label-hint">Only transactions on or after this date count toward Total Funds.</span>
        </div>
        <div class="settings-control settings-cutoff-row">
          <input
            type="date"
            class="settings-input"
            :value="settings.balanceCutoffDate"
            @change="settings.balanceCutoffDate = ($event.target as HTMLInputElement).value"
          />
          <button v-if="settings.balanceCutoffDate" class="debug-btn debug-btn-danger" @click="clearCutoff">
            <i class="pi pi-times text-xs" /> Clear Cutoff
          </button>
        </div>
      </div>

      <div class="settings-row" v-if="settings.balanceCutoffDate">
        <div class="settings-label">
          <span class="settings-label-text">Opening Balance</span>
          <span class="settings-label-hint">Your known account balance as of the cutoff date (can be negative).</span>
        </div>
        <div class="settings-control">
          <input
            type="number"
            step="0.01"
            class="settings-input"
            style="max-width:12rem"
            :value="settings.openingBalance"
            @change="settings.openingBalance = parseFloat(($event.target as HTMLInputElement).value) || 0"
          />
        </div>
      </div>

      <div v-if="settings.balanceCutoffDate" class="settings-cutoff-preview">
        <i class="pi pi-info-circle" />
        <span>
          <strong>{{ cutoffTransactionCount }}</strong> transaction{{ cutoffTransactionCount === 1 ? '' : 's' }}
          on or after {{ settings.balanceCutoffDate }}.
          Calculated Total Funds: <strong :class="cutoffSumPreview >= 0 ? 'money-positive' : 'money-negative'">{{ settings.formatMoney(cutoffSumPreview) }}</strong>
        </span>
      </div>
      <div v-else class="settings-cutoff-preview settings-cutoff-preview--off">
        <i class="pi pi-info-circle" />
        No cutoff set — all <strong>{{ txnStore.transactions.length }}</strong> transactions are included in Total Funds.
      </div>
    </div>

    <!-- Data ────────────────────────────────────────────────── -->
    <div class="settings-section">
      <h2 class="settings-section-title">Data</h2>

      <div class="settings-row">
        <div class="settings-label">
          <span class="settings-label-text">Export</span>
          <span class="settings-label-hint">Download all data (accounts, transactions, budget, template, settings) as a single JSON backup file.</span>
        </div>
        <div class="settings-control">
          <button class="debug-btn" @click="handleExport">
            <i class="pi pi-download text-xs mr-1.5" />
            Export Backup
          </button>
        </div>
      </div>

      <div class="settings-row">
        <div class="settings-label">
          <span class="settings-label-text">Import</span>
          <span class="settings-label-hint">Restore from a previously exported JSON backup file. This will overwrite all current data.</span>
        </div>
        <div class="settings-control">
          <button class="debug-btn" @click="handleImportClick">
            <i class="pi pi-upload text-xs mr-1.5" />
            Import Backup
          </button>
          <p v-if="importSuccess" class="debug-confirm">Backup imported successfully.</p>
          <p v-if="importError"   class="debug-confirm" style="color: var(--color-danger, #ef4444)">{{ importError }}</p>
        </div>
      </div>
    </div>

    <!-- Debug ──────────────────────────────────────────────────── -->
    <div class="settings-section settings-section--full">
      <h2 class="settings-section-title">Debug</h2>

      <!-- Generate Items -->
      <div class="settings-row">
        <div class="settings-label">
          <span class="settings-label-text">Generate items</span>
          <span class="settings-label-hint">Register the default set of budget item names in the global item list. Safe to run multiple times — duplicates are skipped.</span>
        </div>
        <div class="settings-control">
          <button class="debug-btn" @click="generateItems">
            <i class="pi pi-list text-xs mr-1.5" />
            Generate Items
          </button>
          <p v-if="msgItems" class="debug-confirm">{{ msgItems }}</p>
        </div>
      </div>

      <!-- Generate Budgets -->
      <div class="settings-row">
        <div class="settings-label">
          <span class="settings-label-text">Generate budgets</span>
          <span class="settings-label-hint">Populate budget entries for the selected period. Uses the template if one exists, otherwise falls back to the default seed items.</span>
        </div>
        <div class="settings-control">
          <div class="debug-period-row">
            <select class="debug-period-select" v-model="budgetMonth">
              <option :value="0">All months</option>
              <option v-for="(name, i) in ['January','February','March','April','May','June','July','August','September','October','November','December']" :key="i" :value="i + 1">{{ name }}</option>
            </select>
            <input type="number" class="debug-period-year" v-model="budgetYear" min="2000" max="2100" />
            <button class="debug-btn" @click="generateBudgets">
              <i class="pi pi-calendar text-xs mr-1.5" />
              Generate Budgets
            </button>
          </div>
          <p v-if="msgBudgets" class="debug-confirm">{{ msgBudgets }}</p>
        </div>
      </div>

      <!-- Generate Transactions -->
      <div class="settings-row">
        <div class="settings-label">
          <span class="settings-label-text">Generate transactions</span>
          <span class="settings-label-hint">Create randomised transactions for the selected period using existing items and accounts.</span>
        </div>
        <div class="settings-control">
          <div class="debug-period-row">
            <select class="debug-period-select" v-model="txMonth">
              <option :value="0">All months</option>
              <option v-for="(name, i) in ['January','February','March','April','May','June','July','August','September','October','November','December']" :key="i" :value="i + 1">{{ name }}</option>
            </select>
            <input type="number" class="debug-period-year" v-model="txYear" min="2000" max="2100" />
            <button class="debug-btn" @click="generateTransactions">
              <i class="pi pi-receipt text-xs mr-1.5" />
              Generate Transactions
            </button>
          </div>
          <p v-if="msgTx" class="debug-confirm">{{ msgTx }}</p>
        </div>
      </div>

      <!-- Generate Accounts -->
      <div class="settings-row">
        <div class="settings-label">
          <span class="settings-label-text">Generate accounts</span>
          <span class="settings-label-hint">Seed five default accounts (Checking, Savings, Credit Card, Cash, Investment). Overwrites any existing accounts.</span>
        </div>
        <div class="settings-control">
          <button class="debug-btn" @click="generateAccounts">
            <i class="pi pi-building-columns text-xs mr-1.5" />
            Generate Accounts
          </button>
          <p v-if="msgAccounts" class="debug-confirm">{{ msgAccounts }}</p>
        </div>
      </div>

      <!-- Generate Template -->
      <div class="settings-row">
        <div class="settings-label">
          <span class="settings-label-text">Generate template</span>
          <span class="settings-label-hint">Seed the budget template. If items exist the full default template is applied; otherwise only categories are seeded with placeholders.</span>
        </div>
        <div class="settings-control">
          <button class="debug-btn" @click="generateTemplate">
            <i class="pi pi-copy text-xs mr-1.5" />
            Generate Template
          </button>
          <p v-if="msgTemplate" class="debug-confirm">{{ msgTemplate }}</p>
        </div>
      </div>

      <!-- Clear All Data -->
      <div class="settings-row">
        <div class="settings-label">
          <span class="settings-label-text">Clear all data</span>
          <span class="settings-label-hint">Permanently delete all accounts, transactions, budget items, and templates. Settings are kept. This cannot be undone.</span>
        </div>
        <div class="settings-control">
          <button class="debug-btn debug-btn-danger" @click="clearAllData">
            <i class="pi pi-trash text-xs mr-1.5" />
            Clear All Data
          </button>
        </div>
      </div>
    </div>

  </div>
</template>
