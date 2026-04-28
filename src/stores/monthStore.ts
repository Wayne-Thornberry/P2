import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useSettingsStore } from './settingsStore'
import { yearMonthKey } from '../utils/date'

export const useMonthStore = defineStore('month', () => {
  const _now = new Date()
  const activeYear  = ref(_now.getFullYear())
  const activeMonth = ref(_now.getMonth() + 1) // 1–12

  const label = computed(() => {
    const { locale } = useSettingsStore()
    return new Date(activeYear.value, activeMonth.value - 1, 1)
      .toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  })

  const isCurrentMonth = computed(() => {
    const n = new Date()
    return activeYear.value === n.getFullYear() && activeMonth.value === n.getMonth() + 1
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

  /** Returns true when a YYYY-MM-DD date string falls in the active month */
  function matchesActive(dateStr: string): boolean {
    const [y, m] = dateStr.split('-').map(Number)
    return y === activeYear.value && m === activeMonth.value
  }

  /** First day of the active month as a YYYY-MM-DD string */
  const activeMonthStart = computed(() =>
    `${yearMonthKey(activeYear.value, activeMonth.value)}-01`
  )

  return { activeYear, activeMonth, label, isCurrentMonth, prevMonth, nextMonth, matchesActive, activeMonthStart }
})
