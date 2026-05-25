/** Returns today as a YYYY-MM-DD string in local time. */
export function getTodayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Returns a Date as YYYY-MM-DD in local time. */
export function dateToYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Returns a Date as YYYY-MM in local time. */
export function toYearMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Returns a YYYY-MM key from a year and 1-indexed month. */
export function yearMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

// ── Billable month ─────────────────────────────────────────────
// When billableMonthStart is not 1, months are offset.
// E.g. startDay=4 means the "March" billable month covers 03-04 → 04-03.

/**
 * Map a YYYY-MM-DD date string to its billable YYYY-MM key.
 * If startDay is 1 this is identical to extracting the calendar year-month.
 */
export function billableMonthKey(dateStr: string, startDay: number): string {
  if (startDay <= 1) return dateStr.slice(0, 7)
  const [y, m, d] = dateStr.split('-').map(Number)
  if (d >= startDay) return yearMonthKey(y, m)
  // Belongs to previous billable month
  if (m === 1) return yearMonthKey(y - 1, 12)
  return yearMonthKey(y, m - 1)
}

/**
 * First date (inclusive) of the billable month identified by (year, month).
 */
export function billableMonthStart(year: number, month: number, startDay: number): string {
  return `${yearMonthKey(year, month)}-${String(startDay).padStart(2, '0')}`
}

/**
 * Last date (inclusive) of the billable month identified by (year, month).
 */
export function billableMonthEnd(year: number, month: number, startDay: number): string {
  if (startDay <= 1) {
    // Calendar month: last day of month
    const lastDay = new Date(year, month, 0).getDate()
    return `${yearMonthKey(year, month)}-${String(lastDay).padStart(2, '0')}`
  }
  // Billable month ends on (startDay - 1) of the next calendar month
  const endDay = startDay - 1
  if (month === 12) return `${year + 1}-01-${String(endDay).padStart(2, '0')}`
  return `${yearMonthKey(year, month + 1)}-${String(endDay).padStart(2, '0')}`
}

/**
 * Given a calendar (year, month), return the billable-month (year, month)
 * that a date in that calendar month belongs to.
 * The returned pair is the *canonical* billable month label.
 */
export function calendarToBillable(year: number, month: number, startDay: number): { year: number; month: number } {
  if (startDay <= 1) return { year, month }
  // Any date in this calendar month falls into either this or next billable month.
  // 1st → (startDay-1) are in previous billable; startDay → end are in this billable.
  // But for "what billable month covers MOST of this calendar month", we use the
  // billable month whose start day falls in this calendar month.
  return { year, month }
}

/**
 * The billable month that "today" belongs to.
 */
export function currentBillableMonth(startDay: number): { year: number; month: number } {
  const today = getTodayStr()
  const [y, m] = billableMonthKey(today, startDay).split('-').map(Number)
  return { year: y, month: m }
}

// ── Date arithmetic (timezone-safe, pure string math) ──────────

/** Day before a YYYY-MM-DD date string. Uses pure string math — safe in all timezones. */
export function dayBefore(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (d > 1) return `${y}-${String(m).padStart(2, '0')}-${String(d - 1).padStart(2, '0')}`
  if (m > 1) {
    const lastDay = new Date(y, m - 1, 0).getDate()
    return `${y}-${String(m - 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  }
  return `${y - 1}-12-31`
}

/** Day after a YYYY-MM-DD date string. Uses pure string math — safe in all timezones. */
export function dayAfter(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  if (d < lastDay) return `${y}-${String(m).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`
  if (m < 12) return `${y}-${String(m + 1).padStart(2, '0')}-01`
  return `${y + 1}-01-01`
}
