import { notFound, redirect } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { getActor } from '@/server/context'
import { tenantDb } from '@/db/tenant-db'
import { notifications } from '@/db/schema'
import { PageHeader } from '@/components/shell/page-header'
import { NotificationList } from './notification-list'

const PAGE_SIZE = 50

export default async function NotificationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const actor = await getActor()
  if (!actor) redirect(`/${locale}/login`)
  if (!actor.tenantId) redirect(`/${locale}/app`)

  const rows = await tenantDb(actor.tenantId).findMany(notifications, {
    where: eq(notifications.userId, actor.userId),
    orderBy: desc(notifications.createdAt),
    limit: PAGE_SIZE,
  })

  const dictionary = await getDictionary(locale, ['settings', 'common'])
  const t = createTranslator(dictionary, locale)

  const unreadCount = rows.filter((r) => !r.readAt).length

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('settings.notificationsPage.title')}
        description={unreadCount > 0 ? t('settings.notificationsPage.unreadCount', { count: unreadCount }) : undefined}
      />
      <NotificationList
        items={rows.map((r) => ({
          id: r.id,
          title: r.title,
          body: r.body,
          actionUrl: r.actionUrl,
          createdAt: r.createdAt.toISOString(),
          readAt: r.readAt ? r.readAt.toISOString() : null,
        }))}
      />
    </div>
  )
}
