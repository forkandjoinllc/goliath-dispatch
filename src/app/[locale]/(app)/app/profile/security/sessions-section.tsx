'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/components/ui/toast'
import { useI18n } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import { revokeOtherSessionsAction, revokeSessionAction } from '@/server/auth/actions'

export interface SessionRow {
  id: string
  ipAddress: string | null
  userAgent: string | null
  lastSeenAt: string
  isCurrent: boolean
}

export function SessionsSection({ sessions }: { sessions: SessionRow[] }) {
  const { t, locale, timezone } = useI18n()
  const router = useRouter()
  const { toast } = useToast()
  const [pendingId, setPendingId] = React.useState<string | null>(null)

  async function revokeOne(sessionId: string) {
    setPendingId(sessionId)
    const result = await revokeSessionAction({ sessionId })
    setPendingId(null)
    if (result.ok) {
      toast({ tone: 'success', title: t('settings.security.sessions.revoked') })
      router.refresh()
    } else {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    }
  }

  async function revokeAllOthers() {
    const result = await revokeOtherSessionsAction()
    if (result.ok) {
      toast({ tone: 'success', title: t('settings.security.sessions.revokedAll', { count: result.data.revokedCount }) })
      router.refresh()
    } else {
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    }
  }

  const hasOtherSessions = sessions.some((s) => !s.isCurrent)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.security.sessions.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableCaption className="sr-only">{t('settings.security.sessions.title')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('settings.security.sessions.device')}</TableHead>
              <TableHead>{t('settings.security.sessions.ipAddress')}</TableHead>
              <TableHead>{t('settings.security.sessions.lastSeen')}</TableHead>
              <TableHead>{t('common.labels.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((session) => (
              <TableRow key={session.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="truncate">{session.userAgent ?? '—'}</span>
                    {session.isCurrent ? <Badge tone="navy">{t('settings.security.sessions.current')}</Badge> : null}
                  </div>
                </TableCell>
                <TableCell>{session.ipAddress ?? '—'}</TableCell>
                <TableCell>{formatDateTime(session.lastSeenAt, locale, timezone)}</TableCell>
                <TableCell>
                  {!session.isCurrent ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={pendingId === session.id}
                      onClick={() => void revokeOne(session.id)}
                    >
                      {t('settings.security.sessions.revoke')}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      {hasOtherSessions ? (
        <CardFooter>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="secondary">{t('settings.security.sessions.revokeAll')}</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('settings.security.sessions.revokeAll')}</AlertDialogTitle>
                <AlertDialogDescription>{t('settings.security.sessions.subtitle')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.actions.cancel')}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void revokeAllOthers()}>
                  {t('common.actions.confirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      ) : null}
    </Card>
  )
}
