import Link from 'next/link'
import { cn } from '@/lib/utils'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import type { Locale } from '@/i18n/config'
import type { LoadsFilterValues } from './loads-filter-bar'

const VIEWS = ['table', 'board', 'calendar', 'timeline', 'map'] as const

function toSearchParams(filters: LoadsFilterValues, view: string): string {
  const params = new URLSearchParams()
  if (view !== 'table') params.set('view', view)
  if (filters.status.length > 0) params.set('status', filters.status.join(','))
  if (filters.reference) params.set('reference', filters.reference)
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) params.set('dateTo', filters.dateTo)
  if (filters.oversizeOnly) params.set('oversizeOnly', '1')
  if (filters.customerId) params.set('customerId', filters.customerId)
  return params.toString()
}

/** Server component: the current view and every filter are carried in the URL, so switching views is a plain link. */
export async function LoadsViewSwitcher({ locale, filters }: { locale: string; filters: LoadsFilterValues }) {
  const dictionary = await getDictionary(locale as Locale, ['load'])
  const t = createTranslator(dictionary, locale as Locale)
  const basePath = `/${locale}/app/loads`

  return (
    <nav aria-label={t('load.views.table')} className="flex flex-wrap gap-1 border-b border-steel-200">
      {VIEWS.map((view) => {
        const active = filters.view === view
        return (
          <Link
            key={view}
            href={`${basePath}?${toSearchParams(filters, view)}`}
            className={cn(
              'rounded-t-md border-b-2 px-3 py-2 text-sm font-semibold transition-colors',
              active ? 'border-navy-700 text-navy-700' : 'border-transparent text-steel-600 hover:text-carbon',
            )}
            aria-current={active ? 'page' : undefined}
          >
            {t(`load.views.${view}`)}
          </Link>
        )
      })}
    </nav>
  )
}
