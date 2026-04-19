import { defineStore } from 'pinia'
import { ref, watchEffect } from 'vue'

// ── Browser-default detection ──────────────────────────────────
function detectCurrency(locale: string): string {
  const map: Record<string, string> = {
    'en-US': 'USD', 'en-CA': 'CAD', 'en-AU': 'AUD', 'en-NZ': 'NZD',
    'en-GB': 'GBP', 'en-IE': 'EUR', 'en-IN': 'INR', 'en-SG': 'SGD',
    'en-HK': 'HKD', 'en-ZA': 'ZAR',
    'de-DE': 'EUR', 'de-AT': 'EUR', 'de-CH': 'CHF', 'de':    'EUR',
    'fr-FR': 'EUR', 'fr-BE': 'EUR', 'fr-CH': 'CHF', 'fr-CA': 'CAD', 'fr': 'EUR',
    'es-ES': 'EUR', 'es-MX': 'MXN', 'es-AR': 'ARS', 'es-CO': 'COP', 'es': 'EUR',
    'it-IT': 'EUR', 'it': 'EUR',
    'pt-PT': 'EUR', 'pt-BR': 'BRL', 'pt': 'EUR',
    'nl-NL': 'EUR', 'nl-BE': 'EUR', 'nl':   'EUR',
    'sv-SE': 'SEK', 'sv': 'SEK',
    'nb-NO': 'NOK', 'no': 'NOK',
    'da-DK': 'DKK', 'da': 'DKK',
    'fi-FI': 'EUR', 'fi': 'EUR',
    'pl-PL': 'PLN', 'pl': 'PLN',
    'ru-RU': 'RUB', 'ru': 'RUB',
    'ja-JP': 'JPY', 'ja': 'JPY',
    'zh-CN': 'CNY', 'zh-TW': 'TWD', 'zh': 'CNY',
    'ko-KR': 'KRW', 'ko': 'KRW',
    'ar-SA': 'SAR', 'ar-AE': 'AED', 'ar': 'SAR',
    'tr-TR': 'TRY', 'tr': 'TRY',
    'hi-IN': 'INR', 'hi': 'INR',
    'he-IL': 'ILS', 'he': 'ILS',
  }
  return map[locale] ?? map[locale.split('-')[0]] ?? 'USD'
}

function detect12h(locale: string): boolean {
  try {
    const sample = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).format(new Date(2000, 0, 1, 13))
    // 24-hour locales format 13:00 as "13" or "13:00"; 12-hour formats as "1 PM" etc.
    return !(/^13/.test(sample.trim()))
  } catch {
    return true
  }
}

// ── Store ──────────────────────────────────────────────────────
export const useSettingsStore = defineStore('settings', () => {
  const _locale      = Intl.DateTimeFormat().resolvedOptions().locale
                    || navigator.language
                    || 'en-IE'
  const _prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true

  const _saved = (() => {
    try {
      let raw = localStorage.getItem('clearbook_settings')
      if (raw === null) {
        raw = localStorage.getItem('p2_settings')
        if (raw !== null) localStorage.removeItem('p2_settings')
      }
      return JSON.parse(raw ?? 'null')
    } catch { return null }
  })()

  const theme     = ref<'dark' | 'light' | 'midnight' | 'forest' | 'purple' | 'slate' | 'rose' | 'teal'>(_saved?.theme ?? (_prefersDark ? 'dark' : 'light'))
  const locale    = ref<string>(_saved?.locale ?? _locale)
  const currency  = ref<string>(_saved?.currency ?? detectCurrency(_locale))
  const dateStyle = ref<'short' | 'medium' | 'long' | 'iso'>(_saved?.dateStyle ?? 'medium')
  const timeStyle = ref<'12h' | '24h'>(_saved?.timeStyle ?? (detect12h(_locale) ? '12h' : '24h'))

  /**
   * When set, Total Funds = openingBalance + sum of transactions on/after balanceCutoffDate.
   * When empty string, all transactions are summed (default behaviour).
   */
  const balanceCutoffDate = ref<string>(_saved?.balanceCutoffDate ?? '')
  const openingBalance    = ref<number>(_saved?.openingBalance ?? 0)

  let _themeTransitionTimer: ReturnType<typeof setTimeout> | undefined

  // Apply theme immediately and reactively
  watchEffect(() => {
    const t = theme.value
    clearTimeout(_themeTransitionTimer)
    document.documentElement.classList.add('theme-transitioning')
    document.documentElement.classList.toggle('dark', t === 'dark' || t === 'midnight' || t === 'forest' || t === 'purple')
    document.documentElement.classList.toggle('theme-dark', t === 'dark')
    document.documentElement.classList.toggle('theme-light', t === 'light')
    document.documentElement.classList.toggle('theme-midnight', t === 'midnight')
    document.documentElement.classList.toggle('theme-forest', t === 'forest')
    document.documentElement.classList.toggle('theme-purple', t === 'purple')
    document.documentElement.classList.toggle('theme-slate', t === 'slate')
    document.documentElement.classList.toggle('theme-rose', t === 'rose')
    document.documentElement.classList.toggle('theme-teal', t === 'teal')
    _themeTransitionTimer = setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 300)
  })

  // Persist settings to localStorage whenever any setting changes
  watchEffect(() => {
    localStorage.setItem('clearbook_settings', JSON.stringify({
      theme: theme.value,
      locale: locale.value,
      currency: currency.value,
      dateStyle: dateStyle.value,
      timeStyle: timeStyle.value,
      balanceCutoffDate: balanceCutoffDate.value,
      openingBalance: openingBalance.value,
    }))
  })

  // ── Formatters ───────────────────────────────────────────────
  function formatMoney(amount: number): string {
    // Round to nearest cent first, then snap -0 → 0
    const cents = Math.round(amount * 100)
    const safe  = cents === 0 ? 0 : cents / 100
    try {
      return new Intl.NumberFormat(locale.value, {
        style: 'currency',
        currency: currency.value,
        minimumFractionDigits: 2,
      }).format(safe)
    } catch {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(safe)
    }
  }

  function formatDate(isoDate: string): string {
    if (dateStyle.value === 'iso') return isoDate
    const [y, m, d] = isoDate.split('-').map(Number)
    try {
      return new Date(y, m - 1, d).toLocaleDateString(locale.value, {
        dateStyle: dateStyle.value as 'short' | 'medium' | 'long',
      })
    } catch {
      return isoDate
    }
  }

  function formatCreatedAt(isoString: string): string {
    const d = new Date(isoString)
    try {
      if (dateStyle.value === 'iso') {
        // ISO date + HH:MM
        const pad = (n: number) => String(n).padStart(2, '0')
        const h = timeStyle.value === '24h'
          ? pad(d.getHours())
          : String(d.getHours() % 12 || 12)
        const m = pad(d.getMinutes())
        const ampm = timeStyle.value === '12h' ? (d.getHours() < 12 ? ' AM' : ' PM') : ''
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${h}:${m}${ampm}`
      }
      return d.toLocaleString(locale.value, {
        dateStyle: dateStyle.value as 'short' | 'medium' | 'long',
        timeStyle: 'short',
        hour12: timeStyle.value === '12h',
      })
    } catch {
      return d.toLocaleString()
    }
  }

  return { theme, locale, currency, dateStyle, timeStyle, balanceCutoffDate, openingBalance, formatMoney, formatDate, formatCreatedAt }
})
