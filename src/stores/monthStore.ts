import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useSettingsStore } from './settingsStore'
import { yearMonthKey, billableMonthKey, billableMonthStart, currentBillableMonth } from '../utils/date'

export const useMonthStore = defineStore('month', () => {
  const settings = useSettingsStore()

  const _now = currentBillableMonth(settings.billableMonthStart)
  const activeYear  = ref(_now.year)
  const activeMonth = ref(_now.month) // 1–12

  const label = computed(() => {
    const { locale } = settings
    const startDay = settings.billableMonthStart
    const d = new Date(activeYear.value, activeMonth.value - 1, startDay)
    return d.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  })

  const isCurrentMonth = computed(() => {
    const cur = currentBillableMonth(settings.billableMonthStart)
    return activeYear.value === cur.year && activeMonth.value === cur.month
  })

  function prevMonth(): void {
    if (activeMonth.value === 1) {
      activeMonth.value = 12
      activeYear.value--
    } else {
      activeMonth.value--
    }
  }

  function nextMonth(): void {
    if (activeMonth.value === 12) {
      activeMonth.value = 1
      activeYear.value++
    } else {
      activeMonth.value++
    }
  }

  /** Returns true when a YYYY-MM-DD date string falls in the active billable month */
  function matchesActive(dateStr: string): boolean {
    return billableMonthKey(dateStr, settings.billableMonthStart) === yearMonthKey(activeYear.value, activeMonth.value)
  }

  /** First day of the active billable month as a YYYY-MM-DD string */
  const activeMonthStart = computed(() =>
    billableMonthStart(activeYear.value, activeMonth.value, settings.billableMonthStart)
  )

  return { activeYear, activeMonth, label, isCurrentMonth, prevMonth, nextMonth, matchesActive, activeMonthStart }
})
