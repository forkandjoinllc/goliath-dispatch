import type { TranslateFn } from '@/i18n/translate'

/**
 * `DateField`/`DateTimeField` both need a fully-labeled picker with no
 * defaults of their own. Small and self-contained enough to duplicate here
 * rather than reach into `loads/_components` (outside this agent's
 * ownership) for the identical helper.
 */
export function buildDatePickerLabels(t: TranslateFn) {
  return {
    openLabel: t('common.actions.select'),
    todayLabel: t('common.labels.date'),
    prevMonthLabel: t('common.actions.previous'),
    nextMonthLabel: t('common.actions.next'),
    weekdayLabels: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
    clearLabel: t('common.actions.clear'),
  }
}

export function buildDateTimePickerLabels(t: TranslateFn) {
  return { ...buildDatePickerLabels(t), timeLabel: t('common.labels.date') }
}
