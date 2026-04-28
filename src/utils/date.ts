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
