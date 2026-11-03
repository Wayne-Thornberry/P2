/**
 * Shared handlers for money text inputs.
 *
 * Behaviours:
 *  - focus (Tab or mouse click): select all → full override
 *  - blur: normalize to two decimal places and sync v-model via input event
 */
export function useMoneyInput() {
  /**
   * Select all text on focus.
   * setTimeout defers past the browser's own caret placement from a mouse click,
   * ensuring the selection sticks regardless of how focus was triggered.
   */
  function moneyFocus(e: FocusEvent) {
    const el = e.target as HTMLInputElement
    setTimeout(() => el.select(), 0)
  }

  /**
   * Normalize value to two decimal places on blur.
   * Dispatches a synthetic 'input' event so v-model stays in sync.
   */
  function moneyBlur(e: FocusEvent) {
    const el = e.target as HTMLInputElement
    const parsed = parseFloat(el.value)
    const formatted = isNaN(parsed) ? '0.00' : Math.max(0, parsed).toFixed(2)
    if (el.value !== formatted) {
      el.value = formatted
      el.dispatchEvent(new Event('input'))
    }
  }

  return { moneyFocus, moneyBlur }
}
