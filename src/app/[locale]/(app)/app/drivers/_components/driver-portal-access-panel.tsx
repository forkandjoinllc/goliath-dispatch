'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import {
  inviteDriverUserAction,
  resendDriverInvitationAction,
  revokeDriverInvitationAction,
  unlinkDriverUserAction,
} from '@/server/drivers/actions'
import type { DriverPortalAccess } from '@/server/drivers/queries'

/**
 * "Portal access" — whether the person behind this driver record has a
 * login, its status, and the invite / resend / revoke controls a Carrier
 * (for their own drivers) or Admin uses to manage it. Every control here is
 * permission-gated the same way the rest of the driver detail screen is:
 * visibility follows `can()`, the server action re-checks.
 */
export function DriverPortalAccessPanel({
  driverId,
  driverEmail,
  driverFirstName,
  driverLastName,
  portalAccess,
  canInvite,
  canManageLink,
}: {
  driverId: string
  driverEmail: string | null
  driverFirstName: string
  driverLastName: string
  portalAccess: DriverPortalAccess
  canInvite: boolean
  canManageLink: boolean
}) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const { locale, timezone } = useI18n()
  const [isPending, startTransition] = React.useTransition()
  const [email, setEmail] = React.useState(driverEmail ?? '')

  function invite() {
    if (!email.trim()) return
    startTransition(async () => {
      const result = await inviteDriverUserAction({
        driverId,
        email: email.trim(),
        firstName: driverFirstName,
        lastName: driverLastName,
      })
      if (result.ok) {
        toast({ tone: 'success', title: t('driver.portal.invited') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  function resend() {
    const target = portalAccess.pendingInvitation
    if (!target) return
    startTransition(async () => {
      const result = await resendDriverInvitationAction({
        driverId,
        email: target.email,
        firstName: driverFirstName,
        lastName: driverLastName,
      })
      if (result.ok) {
        toast({ tone: 'success', title: t('driver.portal.resent') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  function revoke() {
    if (!window.confirm(t('driver.portal.confirmRevokeInvite'))) return
    startTransition(async () => {
      const result = await revokeDriverInvitationAction({ driverId })
      if (result.ok) {
        toast({ tone: 'success', title: t('driver.portal.invitationRevoked') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  function unlink() {
    if (!window.confirm(t('driver.portal.confirmRevokeAccess'))) return
    startTransition(async () => {
      const result = await unlinkDriverUserAction({ driverId })
      if (result.ok) {
        toast({ tone: 'success', title: t('driver.portal.accessRevoked') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-carbon">{t('driver.portal.title')}</h3>
        <p className="text-sm text-steel-600">{t('driver.portal.description')}</p>
      </div>

      {portalAccess.linkedUserId ? (
        <div className="space-y-3 rounded-lg border border-steel-200 p-4">
          <div className="flex items-center gap-2">
            <Badge tone={portalAccess.membership?.status === 'active' ? 'success' : 'neutral'}>
              {t(`driver.portal.membershipStatus.${portalAccess.membership?.status ?? 'active'}`)}
            </Badge>
          </div>
          {canManageLink ? (
            <Button type="button" variant="destructive" size="sm" disabled={isPending} onClick={unlink}>
              {t('driver.portal.revokeAccess')}
            </Button>
          ) : null}
        </div>
      ) : portalAccess.pendingInvitation ? (
        <div className="space-y-3 rounded-lg border border-steel-200 p-4">
          <Alert tone="info">
            {t('driver.portal.invitedOn', {
              email: portalAccess.pendingInvitation.email,
              date: formatDateTime(portalAccess.pendingInvitation.invitedAt, locale, timezone),
            })}
          </Alert>
          {canInvite ? (
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="sm" disabled={isPending} onClick={resend}>
                {t('driver.portal.resendInvite')}
              </Button>
              <Button type="button" variant="destructive" size="sm" disabled={isPending} onClick={revoke}>
                {t('driver.portal.revokeInvite')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : canInvite ? (
        <div className="space-y-3 rounded-lg border border-steel-200 p-4">
          <div className="grid max-w-sm gap-1.5">
            <Label htmlFor="driver-portal-email">{t('driver.portal.emailLabel')}</Label>
            <Input id="driver-portal-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <Button type="button" size="sm" disabled={isPending || !email.trim()} onClick={invite}>
            {t('driver.portal.invite')}
          </Button>
        </div>
      ) : (
        <Alert tone="info">{t('driver.portal.noAccess')}</Alert>
      )}
    </div>
  )
}
