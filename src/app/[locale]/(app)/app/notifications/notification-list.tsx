'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { BellOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import { cn } from '@/lib/utils'
import { markAllNotificationsReadAction, markNotificationReadAction } from '@/server/auth/actions'

export interface NotificationItem {
  id: string
  title: string
  body: string
  actionUrl: string | null
  createdAt: string
  readAt: string | null
}

export function NotificationList({ items: initialItems }: { items: NotificationItem[] }) {
  const { t, locale, timezone } = useI18n()
  const router = useRouter()
  const { toast } = useToast()
  const [items, setItems] = React.useState(initialItems)
  const hasUnread = items.some((i) => !i.readAt)

  async function markRead(id: string) {
    setItems((current) => current.map((i) => (i.id === id ? { ...i, readAt: new Date().toISOString() } : i)))
    const result = await markNotificationReadAction({ notificationId: id })
    if (!result.ok) {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
      router.refresh()
    }
  }

  async function markAllRead() {
    setItems((current) => current.map((i) => (i.readAt ? i : { ...i, readAt: new Date().toISOString() })))
    const result = await markAllNotificationsReadAction()
    if (!result.ok) {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
      router.refresh()
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={BellOff}
        title={t('settings.notificationsPage.empty')}
        description={t('settings.notificationsPage.emptyHint')}
      />
    )
  }

  return (
    <div className="space-y-4">
      {hasUnread ? (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={() => void markAllRead()}>
            {t('settings.notificationsPage.markAllRead')}
          </Button>
        </div>
      ) : null}
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <Card className={cn(!item.readAt && 'border-navy-300 bg-navy-50/40')}>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2 text-base">
                    {!item.readAt ? <Badge tone="navy" dot aria-hidden="true" /> : null}
                    {item.actionUrl ? (
                      <Link href={item.actionUrl} className="hover:underline">
                        {item.title}
                      </Link>
                    ) : (
                      item.title
                    )}
                  </CardTitle>
                  <p className="mt-1 text-xs text-steel-500">{formatDateTime(item.createdAt, locale, timezone)}</p>
                </div>
                {!item.readAt ? (
                  <Button variant="ghost" size="sm" onClick={() => void markRead(item.id)}>
                    {t('settings.notificationsPage.markRead')}
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent>
                <p className="text-sm text-steel-700">{item.body}</p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}
