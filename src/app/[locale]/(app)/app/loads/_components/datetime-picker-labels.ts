import type { TranslateFn } from '@/i18n/translate'

/**
 * `DateField`/`DateTimeField` both need a fully-labeled picker (calendar nav,
 * weekday header, clear button, and — for the time variant — a time-field
 * label) with no defaults of their own. Built once here and reused by every
 * stop/appointment date input across the load screens.
 */
export function buildDatePickerLabels(t: TranslateFn) {
  return {
    openLabel: t('common.actions.select'),
    todayLabel: t('common.labels.date'),
    prevMonthLabel: t('common.actions.previous'),
    nextMonthLabel: t('common.actions.next'),
    weekdayLabels: weekdayAbbreviations(),
    clearLabel: t('common.actions.clear'),
  }
}

export function buildDateTimePickerLabels(t: TranslateFn) {
  return { ...buildDatePickerLabels(t), timeLabel: t('common.labels.date') }
}

/**
 * Sunday-first two-letter weekday abbreviations. Locale-aware formatting
 * isn't worth the complexity here — every locale this product ships (en,
 * es) reads a short Latin abbreviation fine, and the calendar grid only has
 * room for two characters anyway.
 */
function weekdayAbbreviations(): string[] {
  return ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
}
