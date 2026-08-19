import { MapPin } from 'lucide-react'
import type { TranslateFn } from '@/i18n/translate'
import { formatDateTime } from '@/i18n/translate'
import type { Locale } from '@/i18n/config'
import type { PublicTrackingProjection } from '@/server/tracking/public-links'

/**
 * Renders the narrow public projection only — no rates, no carrier DOT/MC,
 * no driver name or phone. See `public-links.ts`'s header comment for the
 * exact shape this is allowed to show.
 */
export function PublicTrackingView({
  projection,
  locale,
  t,
}: {
  projection: PublicTrackingProjection
  locale: Locale
  t: TranslateFn
}) {
  return (
    <div className="mx-auto max-w-lg space-y-6 p-6">
      <header className="text-center">
        <h1 className="text-xl font-bold text-carbon">{t('tracking.publicPage.title')}</h1>
        <p className="text-sm text-steel-600">{t('tracking.publicPage.poweredBy', { tenant: projection.tenantDisplayName })}</p>
      </header>

      <div className="rounded-lg border border-steel-200 bg-white p-4">
        <p className="text-base font-semibold text-carbon">
          {t('tracking.publicPage.loadLabel', { loadNumber: projection.loadNumber })}
        </p>
        {projection.carrierDisplayName ? (
          <p className="text-sm text-steel-600">
            {t('tracking.publicPage.carrierLabel', { carrier: projection.carrierDisplayName })}
          </p>
        ) : null}
        <p className="mt-2 text-sm">
          <span className="font-medium">{t('tracking.publicPage.statusLabel')}: </span>
          {t(`tracking.status.${projection.status}`)}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <div>
            <p className="font-medium">{t('tracking.publicPage.originLabel')}</p>
            <p className="text-steel-600">
              {[projection.originCity, projection.originState].filter(Boolean).join(', ') || '—'}
            </p>
          </div>
          <div>
            <p className="font-medium">{t('tracking.publicPage.destinationLabel')}</p>
            <p className="text-steel-600">
              {[projection.destinationCity, projection.destinationState].filter(Boolean).join(', ') || '—'}
            </p>
          </div>
        </div>
        <div className="mt-3 border-t border-steel-100 pt-3 text-sm">
          <p className="font-medium">{t('tracking.publicPage.etaLabel')}</p>
          <p className="text-steel-600">
            {projection.etaAt ? formatDateTime(projection.etaAt, locale, 'America/New_York') : t('tracking.publicPage.noEta')}
          </p>
          {projection.routeProgressPercent != null ? (
            <p className="mt-1 text-steel-600">
              {t('tracking.publicPage.progressLabel', { percent: projection.routeProgressPercent })}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-steel-500">
            {projection.lastUpdatedAt
              ? t('tracking.publicPage.lastUpdated', { date: formatDateTime(projection.lastUpdatedAt, locale, 'America/New_York') })
              : t('tracking.publicPage.noUpdatesYet')}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-steel-200 bg-white p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-carbon">
          <MapPin className="size-4" aria-hidden="true" />
          {t('tracking.publicPage.stopsTitle')}
        </h2>
        <ol className="space-y-3">
          {projection.stops.map((stop, index) => (
            <li key={index} className="text-sm">
              <p className="font-medium">{[stop.city, stop.state].filter(Boolean).join(', ') || '—'}</p>
              {stop.windowStart || stop.windowEnd ? (
                <p className="text-xs text-steel-600">
                  {t('tracking.publicPage.stopWindow', {
                    start: stop.windowStart ? formatDateTime(stop.windowStart, locale, stop.timezone) : '—',
                    end: stop.windowEnd ? formatDateTime(stop.windowEnd, locale, stop.timezone) : '—',
                  })}
                </p>
              ) : null}
              <p className="text-xs text-steel-500">
                {stop.actualDepartureAt
                  ? t('tracking.publicPage.stopDeparted', { date: formatDateTime(stop.actualDepartureAt, locale, stop.timezone) })
                  : stop.actualArrivalAt
                    ? t('tracking.publicPage.stopArrived', { date: formatDateTime(stop.actualArrivalAt, locale, stop.timezone) })
                    : t('tracking.publicPage.stopPending')}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
