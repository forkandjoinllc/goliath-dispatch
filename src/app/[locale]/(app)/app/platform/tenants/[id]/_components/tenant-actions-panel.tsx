'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ReasonAlertDialog } from '@/components/ui/alert-dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { suspendTenantAction, reactivateTenantAction, openTenantSupportAccessAction } from '@/server/platform/actions'

export function TenantActionsPanel({
  tenantId,
  tenantName,
  status,
  canSuspend,
  canSupportAccess,
}: {
  tenantId: string
  tenantName: string
  status: string
  canSuspend: boolean
  canSupportAccess: boolean
}) {
  const t = useTranslate()
  const { toast } = useToast()
  const router = useRouter()
  const [dialog, setDialog] = React.useState<'suspend' | 'reactivate' | 'support' | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const [supportAccessGranted, setSupportAccessGranted] = React.useState(false)

  function run(action: () => Promise<{ ok: boolean; error?: { messageKey: string; params?: Record<string, string | number> } }>) {
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        setDialog(null)
        router.refresh()
      } else if (result.error) {
        toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
      }
    })
  }

  if (!canSuspend && !canSupportAccess) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('platform.tenants.actionsTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        {canSuspend && status !== 'suspended' ? (
          <Button type="button" variant="destructive" onClick={() => setDialog('suspend')}>
            {t('platform.tenants.suspend')}
          </Button>
        ) : null}
        {canSuspend && status === 'suspended' ? (
          <Button type="button" variant="primary" onClick={() => setDialog('reactivate')}>
            {t('platform.tenants.reactivate')}
          </Button>
        ) : null}
        {canSupportAccess ? (
          <Button type="button" variant="secondary" onClick={() => setDialog('support')}>
            {t('platform.tenants.openSupportAccess')}
          </Button>
        ) : null}
        {supportAccessGranted ? (
          <p className="w-full text-xs text-steel-600">
            {t('platform.tenants.supportAccessGranted', { minutes: 60 })}
          </p>
        ) : null}
      </CardContent>

      <ReasonAlertDialog
        open={dialog === 'suspend'}
        onOpenChange={(open) => setDialog(open ? 'suspend' : null)}
        title={t('platform.tenants.suspendTitle')}
        description={t('platform.tenants.suspendDescription', { name: tenantName })}
        reasonLabel={t('platform.tenants.reasonLabel')}
        cancelLabel={t('common.actions.cancel')}
        confirmLabel={t('platform.tenants.suspend')}
        isPending={isPending}
        onConfirm={(reason) => run(() => suspendTenantAction({ tenantId, reason }))}
      />
      <ReasonAlertDialog
        open={dialog === 'reactivate'}
        onOpenChange={(open) => setDialog(open ? 'reactivate' : null)}
        title={t('platform.tenants.reactivateTitle')}
        description={t('platform.tenants.reactivateDescription', { name: tenantName })}
        reasonLabel={t('platform.tenants.reasonLabel')}
        cancelLabel={t('common.actions.cancel')}
        confirmLabel={t('platform.tenants.reactivate')}
        destructive={false}
        isPending={isPending}
        onConfirm={(reason) => run(() => reactivateTenantAction({ tenantId, reason }))}
      />
      <ReasonAlertDialog
        open={dialog === 'support'}
        onOpenChange={(open) => setDialog(open ? 'support' : null)}
        title={t('platform.tenants.supportAccessTitle')}
        description={t('platform.tenants.supportAccessDescription', { name: tenantName })}
        reasonLabel={t('platform.tenants.reasonLabel')}
        reasonHint={t('platform.tenants.supportAccessReasonHint')}
        cancelLabel={t('common.actions.cancel')}
        confirmLabel={t('platform.tenants.openSupportAccess')}
        destructive={false}
        isPending={isPending}
        onConfirm={(reason) =>
          startTransition(async () => {
            const result = await openTenantSupportAccessAction({ tenantId, reason })
            if (result.ok) {
              setDialog(null)
              setSupportAccessGranted(true)
              toast({ tone: 'success', title: t('platform.tenants.supportAccessGranted', { minutes: 60 }) })
            } else {
              toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
            }
          })
        }
      />
    </Card>
  )
}
