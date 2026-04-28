<script setup lang="ts">
import { ref, computed } from 'vue'
import type { DemoPersona, DemoConfig } from '../utils/demoDataGenerator'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'generate', config: DemoConfig): void
}>()

// ── Persona definitions ─────────────────────────────────────────

interface PersonaCard {
  id:          DemoPersona
  icon:        string
  label:       string
  tagline:     string
  description: string
  incomeHint:  number   // suggested monthly income
}

const PERSONAS: PersonaCard[] = [
  {
    id:          'saver',
    icon:        'pi-wallet',
    label:       'The Saver',
    tagline:     'Ahead of the game',
    description: 'Earns more than they spend. Consistent savings contributions, modest debt, investments growing steadily.',
    incomeHint:  4500,
  },
  {
    id:          'balanced',
    icon:        'pi-chart-line',
    label:       'The Balancer',
    tagline:     'Breaking even',
    description: 'Income roughly matches expenses. A loan being paid off, a small emergency fund, the occasional splurge.',
    incomeHint:  3500,
  },
  {
    id:          'indebted',
    icon:        'pi-credit-card',
    label:       'In Debt',
    tagline:     'More out than in',
    description: 'Spending exceeds income each month. Multiple loans, maxed credit cards, emergency fund nearly empty.',
    incomeHint:  3000,
  },
]

// ── Form state ──────────────────────────────────────────────────

const now         = new Date()
const persona     = ref<DemoPersona>('balanced')
const startYear   = ref(now.getFullYear() - 1)
const startMonth  = ref(now.getMonth() + 1)   // current month, previous year
const endYear     = ref(now.getFullYear())
const endMonth    = ref(now.getMonth() + 1)   // current month, this year

const monthlyIncome       = ref(3500)
const includeSavingsGoals = ref(true)
const includeFinance      = ref(true)

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Automatically update income hint when persona changes
function selectPersona(p: DemoPersona): void {
  persona.value = p
  const card = PERSONAS.find(c => c.id === p)
  if (card) monthlyIncome.value = card.incomeHint
}

// ── Validation ──────────────────────────────────────────────────

const periodValid = computed(() => {
  const start = startYear.value * 12 + startMonth.value
  const end   = endYear.value   * 12 + endMonth.value
  return end >= start
})

const monthCount = computed(() => {
  if (!periodValid.value) return 0
  return (endYear.value - startYear.value) * 12 + (endMonth.value - startMonth.value) + 1
})

const incomeValid = computed(() => monthlyIncome.value >= 100 && monthlyIncome.value <= 999999)

const canGenerate = computed(() => periodValid.value && incomeValid.value)

// ── Submit ───────────────────────────────────────────────────────

function handleGenerate(): void {
  if (!canGenerate.value) return
  emit('generate', {
    persona:             persona.value,
    startYear:           startYear.value,
    startMonth:          startMonth.value,
    endYear:             endYear.value,
    endMonth:            endMonth.value,
    monthlyIncome:       monthlyIncome.value,
    includeSavingsGoals: includeSavingsGoals.value,
    includeFinance:      includeFinance.value,
  })
}
</script>

<template>
  <Transition name="demo-dialog-fade">
    <div class="demo-overlay" @mousedown.self="emit('close')">
      <div class="demo-dialog" role="dialog" aria-modal="true" aria-labelledby="demo-dialog-title">

        <!-- Header -->
        <div class="demo-dialog-header">
          <p id="demo-dialog-title" class="demo-dialog-title">
            <i class="pi pi-database" />
            Generate Demo Data
          </p>
          <button class="demo-dialog-close" @click="emit('close')" aria-label="Close">
            <i class="pi pi-times" />
          </button>
        </div>

        <!-- Body -->
        <div class="demo-dialog-body">

          <!-- Persona selector -->
          <div class="demo-section">
            <p class="demo-section-label">Choose a persona</p>
            <div class="demo-persona-grid">
              <button
                v-for="card in PERSONAS"
                :key="card.id"
                class="demo-persona-card"
                :class="{ 'demo-persona-card--active': persona === card.id, [`demo-persona-card--${card.id}`]: true }"
                @click="selectPersona(card.id)"
                type="button"
              >
                <i :class="['pi', card.icon, 'demo-persona-icon']" />
                <span class="demo-persona-name">{{ card.label }}</span>
                <span class="demo-persona-tagline">{{ card.tagline }}</span>
                <span class="demo-persona-desc">{{ card.description }}</span>
              </button>
            </div>
          </div>

          <!-- Period -->
          <div class="demo-section">
            <p class="demo-section-label">Period</p>
            <div class="demo-period-row">
              <span class="demo-period-label">From</span>
              <select class="demo-select" v-model="startMonth">
                <option v-for="(name, i) in MONTH_NAMES" :key="i" :value="i + 1">{{ name }}</option>
              </select>
              <input type="number" class="demo-year-input" v-model="startYear" min="2000" max="2100" />
              <span class="demo-period-sep">—</span>
              <span class="demo-period-label">To</span>
              <select class="demo-select" v-model="endMonth">
                <option v-for="(name, i) in MONTH_NAMES" :key="i" :value="i + 1">{{ name }}</option>
              </select>
              <input type="number" class="demo-year-input" v-model="endYear" min="2000" max="2100" />
            </div>
            <p v-if="!periodValid" class="demo-field-error">End date must be on or after start date.</p>
            <p v-else class="demo-period-hint">{{ monthCount }} month{{ monthCount !== 1 ? 's' : '' }} of data</p>
          </div>

          <!-- Monthly income -->
          <div class="demo-section">
            <p class="demo-section-label">Monthly take-home income</p>
            <div class="demo-income-row">
              <input
                type="number"
                class="demo-income-input"
                v-model="monthlyIncome"
                min="100"
                max="999999"
                step="100"
              />
              <span class="demo-income-hint">Used to scale salary transactions and finance account balances.</span>
            </div>
            <p v-if="!incomeValid" class="demo-field-error">Enter an amount between 100 and 999,999.</p>
          </div>

          <!-- Options -->
          <div class="demo-section">
            <p class="demo-section-label">Options</p>
            <label class="demo-checkbox-row">
              <input type="checkbox" v-model="includeSavingsGoals" class="demo-checkbox" />
              <span class="demo-checkbox-label">
                <strong>Savings goals</strong>
                <span class="demo-checkbox-hint">Create goals with opening balance and monthly contributions.</span>
              </span>
            </label>
            <label class="demo-checkbox-row">
              <input type="checkbox" v-model="includeFinance" class="demo-checkbox" />
              <span class="demo-checkbox-label">
                <strong>Loans &amp; finance</strong>
                <span class="demo-checkbox-hint">Add loans and savings accounts to the Finance page.</span>
              </span>
            </label>
          </div>

          <!-- Tip -->
          <p class="demo-tip">
            <i class="pi pi-info-circle" />
            Existing data is kept — for a clean slate use <em>Delete All Data</em> first.
          </p>

        </div>

        <!-- Footer -->
        <div class="demo-dialog-footer">
          <button class="demo-footer-btn demo-footer-btn--ghost" @click="emit('close')" type="button">
            Cancel
          </button>
          <button
            class="demo-footer-btn demo-footer-btn--primary"
            :disabled="!canGenerate"
            @click="handleGenerate"
            type="button"
          >
            <i class="pi pi-magic text-xs mr-1.5" />
            Generate {{ monthCount > 0 ? monthCount + ' month' + (monthCount !== 1 ? 's' : '') : '' }}
          </button>
        </div>

      </div>
    </div>
  </Transition>
</template>
