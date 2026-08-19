'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { Textarea } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { useTranslate } from '@/components/providers/i18n-provider'
import { grantDispatcherResourceAction, revokeDispatcherResourceAction } from '@/server/assignments/actions'
import type { AssignmentScope } from '@/lib/permissions'
import type { DispatcherCarrierMatrixRow, DispatcherUserOption } from '@/server/assignments/queries'
import type { DispatcherResourceAssignment } from '@/server/assignments/service'

export interface GrantRow {
  grant: DispatcherResourceAssignment
  dispatcherName: string
  resourceLabel: string
}

const RESOURCE_TYPES = ['truck', 'trailer', 'driver', 'group'] as const

export function DispatcherMatrixPanel({
  matrix,
  reachByDispatcher,
  grants,
  dispatcherOptions,
}: {
  matrix: DispatcherCarrierMatrixRow[]
  reachByDispatcher: Array<{ userId: string; name: string; reach: AssignmentScope }>
  grants: GrantRow[]
  dispatcherOptions: DispatcherUserOption[]
}) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [dispatcherUserId, setDispatcherUserId] = React.useState('')
  const [resourceType, setResourceType] = React.useState<(typeof RESOURCE_TYPES)[number]>('truck')
  const [resourceId, setResourceId] = React.useState('')
  const [reason, setReason] = React.useState('')

  function grant() {
    if (!dispatcherUserId || !resourceId) return
    startTransition(async () => {
      const result = await grantDispatcherResourceAction({ dispatcherUserId, resourceType, resourceId, reason: reason || null })
      if (result.ok) {
        toast({ tone: 'success', title: t('assignment.grants.grant') })
        setResourceId('')
        setReason('')
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  function revoke(row: GrantRow) {
    if (!window.confirm(t('assignment.grants.confirmRevoke', { dispatcherName: row.dispatcherName, resourceLabel: row.resourceLabel }))) return
    startTransition(async () => {
      const result = await revokeDispatcherResourceAction({
        dispatcherUserId: row.grant.dispatcherUserId,
        resourceType: row.grant.resourceType,
        resourceId: row.grant.resourceId,
      })
      if (result.ok) {
        toast({ tone: 'success', title: t('assignment.grants.revoke') })
        router.refresh()
        return
      }
      toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
    })
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h3 className="text-base font-bold text-carbon">{t('assignment.matrix.title')}</h3>
          <p className="text-sm text-steel-600">{t('assignment.matrix.description')}</p>
        </div>
        {matrix.length === 0 ? (
          <EmptyState title={t('assignment.matrix.empty')} />
        ) : (
          <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200">
            {matrix.map((row) => {
              const reach = reachByDispatcher.find((r) => r.userId === row.dispatcherUserId)?.reach
              return (
                <li key={row.dispatcherUserId} className="space-y-2 p-3 text-sm">
                  <p className="font-semibold text-carbon">{row.dispatcherName}</p>
                  <div className="flex flex-wrap gap-2">
                    {row.carriers.map((c) => (
                      <Badge key={c.carrierId} tone={c.isPrimary ? 'info' : 'neutral'}>
                        {c.legalName}
                        {c.isPrimary ? ` · ${t('assignment.matrix.primaryBadge')}` : ''}
                      </Badge>
                    ))}
                  </div>
                  {reach ? (
                    <p className="text-xs text-steel-500">
                      {t('assignment.reach.carriers', { count: reach.carrierIds.length })} ·{' '}
                      {t('assignment.reach.trucks', { count: reach.truckIds.length })} ·{' '}
                      {t('assignment.reach.trailers', { count: reach.trailerIds.length })} ·{' '}
                      {t('assignment.reach.drivers', { count: reach.driverIds.length })} ·{' '}
                      {t('assignment.reach.groups', { count: reach.groupIds.length })}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-base font-bold text-carbon">{t('assignment.grants.title')}</h3>
          <p className="text-sm text-steel-600">{t('assignment.grants.description')}</p>
        </div>

        <div className="grid gap-3 rounded-lg border border-steel-200 p-4 sm:grid-cols-4">
          <Select value={dispatcherUserId} onValueChange={setDispatcherUserId}>
            <SelectTrigger>
              <SelectValue placeholder={t('assignment.matrix.dispatcher')} />
            </SelectTrigger>
            <SelectContent>
              {dispatcherOptions.map((d) => (
                <SelectItem key={d.userId} value={d.userId}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={resourceType} onValueChange={(v) => setResourceType(v as (typeof RESOURCE_TYPES)[number])}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESOURCE_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(`assignment.grants.resourceTypes.${type}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            value={resourceId}
            onChange={(event) => setResourceId(event.target.value)}
            placeholder={t('assignment.grants.resource')}
            className="h-10 rounded-md border border-steel-300 px-3 text-sm"
          />
          <Button type="button" disabled={!dispatcherUserId || !resourceId || isPending} onClick={grant}>
            {t('assignment.grants.grant')}
          </Button>
          <Textarea
            className="sm:col-span-4"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            placeholder={t('assignment.grants.reasonPlaceholder')}
          />
        </div>

        {grants.length === 0 ? (
          <EmptyState title={t('assignment.grants.empty')} />
        ) : (
          <ul className="divide-y divide-steel-200 rounded-lg border border-steel-200">
            {grants.map((row) => (
              <li key={row.grant.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                <div>
                  <p className="font-semibold text-carbon">
                    {row.dispatcherName} — {t(`assignment.grants.resourceTypes.${row.grant.resourceType}`)}: {row.resourceLabel}
                  </p>
                  {row.grant.reason ? <p className="text-xs text-steel-500">{row.grant.reason}</p> : null}
                </div>
                <Button type="button" variant="destructive" size="sm" disabled={isPending} onClick={() => revoke(row)}>
                  {t('assignment.grants.revoke')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
