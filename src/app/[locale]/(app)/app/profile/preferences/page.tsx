import { notFound, redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { getActor } from '@/server/context'
import { tenantDb } from '@/db/tenant-db'
import { notificationPreferences } from '@/db/schema'
import { NOTIFICATION_CATALOG } from '@/server/notifications/catalog'
import { PageHeader } from '@/components/shell/page-header'
import { PreferencesForm } from './preferences-form'

/**
 * The set of events a user can be notified about — read directly from
 * `NOTIFICATION_CATALOG` (`src/server/notifications/catalog.ts`) rather than
 * a locally hand-maintained list, which is what let this page's event keys
 * (`document_expiring`) drift out of sync with the catalog's dotted keys
 * (`document.expiring`) in the first place: a toggle here silently saved a
 * preference row the dispatcher never actually read.
 */
export const NOTIFICATION_EVENT_KEYS = Object.keys(NOTIFICATION_CATALOG) as Array<keyof typeof NOTIFICATION_CATALOG>

export default async function NotificationPreferencesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const actor = await getActor()
  if (!actor) redirect(`/${locale}/login`)
  if (!actor.tenantId) redirect(`/${locale}/app`)

  const existing = await tenantDb(actor.tenantId).findMany(notificationPreferences, {
    where: eq(notificationPreferences.userId, actor.userId),
  })
  const byEvent = new Map(existing.map((row) => [row.eventKey, row]))

  const dictionary = await getDictionary(locale, ['settings', 'common'])
  const t = createTranslator(dictionary, locale)

  const rows = NOTIFICATION_EVENT_KEYS.map((eventKey) => {
    const row = byEvent.get(eventKey)
    return {
      eventKey,
      label: t(`settings.preferences.events.${eventKey}`),
      inApp: row?.inApp ?? true,
      email: row?.email ?? true,
      sms: row?.sms ?? false,
    }
  })

  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.preferences.title')} description={t('settings.preferences.subtitle')} />
      <PreferencesForm rows={rows} />
    </div>
  )
}
