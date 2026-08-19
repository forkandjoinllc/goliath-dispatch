'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { useTransition } from 'react'
import { Copy, Link2 } from 'lucide-react'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { TextField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState, Alert } from '@/components/ui/feedback'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import type { PublicTrackingLink } from '@/db/schema'
import { createPublicTrackingLinkAction, revokePublicTrackingLinkAction } from '@/server/tracking/actions'

function linkStatus(link: PublicTrackingLink): 'active' | 'expired' | 'revoked' {
  if (link.revokedAt) return 'revoked'
  if (link.expiresAt.getTime() <= Date.now()) return 'expired'
  return 'active'
}

const STATUS_TONE: Record<'active' | 'expired' | 'revoked', 'success' | 'neutral' | 'danger'> = {
  active: 'success',
  expired: 'neutral',
  revoked: 'danger',
}

const createSchema = z.object({
  label: z.string().trim().max(120),
  recipientEmail: z.string().trim().max(255),
  ttlHours: z.coerce.number().int().positive().max(720),
})
type CreateValues = z.infer<typeof createSchema>

function CreateLinkForm({ loadId, publicOrigin }: { loadId: string; publicOrigin: string }) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [rawUrl, setRawUrl] = React.useState<string | null>(null)

  const { form, onSubmit, isPending } = useActionForm<CreateValues, { link: PublicTrackingLink; rawToken: string }>({
    schema: createSchema,
    defaultValues: { label: '', recipientEmail: '', ttlHours: 72 },
    action: (values) =>
      createPublicTrackingLinkAction({
        loadId,
        label: values.label.trim() || null,
        recipientEmail: values.recipientEmail.trim() || null,
        ttlHours: values.ttlHours,
      }),
    onSuccess: (data) => {
      setRawUrl(`${publicOrigin}/track/${data.rawToken}`)
      router.refresh()
    },
  })

  async function copy(url: string) {
    await navigator.clipboard.writeText(url)
    toast({ tone: 'success', title: t('tracking.publicLink.copied') })
  }

  return (
    <div className="space-y-3">
      <Form form={form} onSubmit={onSubmit} className="space-y-3">
        <FormErrorSummary title={t('errors.validationFailed')} />
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField name="label" label={t('tracking.publicLink.labelField')} placeholder={t('tracking.publicLink.labelPlaceholder')} />
          <TextField name="recipientEmail" label={t('tracking.publicLink.recipientEmailField')} type="email" />
          <TextField name="ttlHours" label={t('tracking.publicLink.ttlField')} />
        </div>
        <Button type="submit" loading={isPending}>
          <Link2 aria-hidden="true" />
          {t('tracking.publicLink.createButton')}
        </Button>
      </Form>
      {rawUrl ? (
        <Alert tone="warning" title={t('tracking.publicLink.createSuccess')}>
          <p className="mb-2">{t('tracking.publicLink.rawTokenWarning')}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-white px-2 py-1 text-xs">{rawUrl}</code>
            <Button size="sm" variant="secondary" onClick={() => copy(rawUrl)}>
              <Copy aria-hidden="true" />
              {t('tracking.publicLink.copyButton')}
            </Button>
          </div>
        </Alert>
      ) : null}
    </div>
  )
}

export function PublicLinkPanel({
  loadId,
  links,
  publicOrigin,
  canCreate,
  canRevoke,
}: {
  loadId: string
  links: PublicTrackingLink[]
  publicOrigin: string
  canCreate: boolean
  canRevoke: boolean
}) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [revokeTarget, setRevokeTarget] = React.useState<PublicTrackingLink | null>(null)

  function revoke() {
    if (!revokeTarget) return
    startTransition(async () => {
      const result = await revokePublicTrackingLinkAction({ loadId, linkId: revokeTarget.id })
      if (result.ok) {
        toast({ tone: 'success', title: t('tracking.publicLink.revokeSuccess') })
        setRevokeTarget(null)
        router.refresh()
      } else {
        toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tracking.publicLink.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-steel-600">{t('tracking.publicLink.description')}</p>

        {canCreate ? <CreateLinkForm loadId={loadId} publicOrigin={publicOrigin} /> : null}

        {links.length === 0 ? (
          <EmptyState title={t('tracking.publicLink.empty')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('tracking.publicLink.labelField')}</TableHead>
                <TableHead>{t('common.labels.status')}</TableHead>
                <TableHead>{t('tracking.publicLink.expiresColumn')}</TableHead>
                <TableHead>{t('tracking.publicLink.viewsColumn')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((link) => {
                const status = linkStatus(link)
                return (
                  <TableRow key={link.id}>
                    <TableCell>{link.label ?? '—'}</TableCell>
                    <TableCell>
                      <Badge tone={STATUS_TONE[status]}>{t(`tracking.publicLink.status.${status}`)}</Badge>
                    </TableCell>
                    <TableCell>{formatDateTime(link.expiresAt, locale, timezone)}</TableCell>
                    <TableCell>{t('tracking.publicLink.viewCount', { count: link.viewCount })}</TableCell>
                    <TableCell>
                      {canRevoke && status === 'active' ? (
                        <Button size="sm" variant="destructive" onClick={() => setRevokeTarget(link)}>
                          {t('tracking.publicLink.revokeButton')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <AlertDialog open={Boolean(revokeTarget)} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('tracking.publicLink.revokeConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('tracking.publicLink.revokeConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={revoke} loading={isPending}>
              {t('tracking.publicLink.revokeButton')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
