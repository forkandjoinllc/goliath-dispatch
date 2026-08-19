'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { UserMinus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { ReasonAlertDialog } from '@/components/ui/alert-dialog'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import type { Carrier, Load, LoadAssignment } from '@/db/schema'
import { unassignResourceAction } from '@/server/loads/actions'
import type { LoadDetailPermissions } from './load-detail-view'
import { AssignCarrierPanel } from './assign-carrier-panel'
import { AssignResourcesDialog } from './assign-resources-dialog'

export function AssignmentsTab({
  load,
  carrier,
  assignments,
  resourceLabels,
  permissions,
}: {
  load: Load
  carrier: Carrier | null
  assignments: LoadAssignment[]
  resourceLabels: Record<string, string>
  permissions: LoadDetailPermissions
}) {
  const t = useTranslate()
  const router = useRouter()
  const { toast } = useToast()
  const { locale, timezone } = useI18n()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [unassignTarget, setUnassignTarget] = React.useState<LoadAssignment | null>(null)
  const [isPending, setPending] = React.useState(false)

  const active = assignments.filter((a) => !a.unassignedAt)

  async function handleUnassign(reason: string) {
    if (!unassignTarget) return
    setPending(true)
    const result = await unassignResourceAction({ loadId: load.id, assignmentId: unassignTarget.id, reason })
    setPending(false)
    setUnassignTarget(null)
    if (result.ok) router.refresh()
    else toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-base font-bold text-carbon">{t('load.fields.carrier')}</h3>
        {carrier ? (
          <p className="text-sm text-carbon">{carrier.legalName}</p>
        ) : permissions.canAssignCarrier ? (
          <AssignCarrierPanel loadId={load.id} />
        ) : (
          <p className="text-sm text-steel-600">{t('common.labels.none')}</p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-carbon">{t('load.assignments.title')}</h3>
          {permissions.canAssignResources ? (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              {t('load.assignments.assign')}
            </Button>
          ) : null}
        </div>

        {active.length === 0 ? (
          <EmptyState title={t('load.assignments.empty')} />
        ) : (
          <ul className="mt-3 divide-y divide-steel-200 rounded-lg border border-steel-200">
            {active.map((assignment) => {
              const resourceId = assignment.truckId ?? assignment.trailerId ?? assignment.driverId ?? ''
              return (
                <li key={assignment.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge tone="neutral">{t(`load.assignments.resourceType.${assignment.resourceType}`)}</Badge>
                      <span className="font-semibold text-carbon">{resourceLabels[resourceId] ?? resourceId}</span>
                      {assignment.isPrimary ? <Badge tone="navy">{t('load.assignments.primary')}</Badge> : null}
                    </div>
                    {assignment.committedFrom && assignment.committedTo ? (
                      <p className="text-xs text-steel-600">
                        {t('load.assignments.committedWindow', {
                          from: formatDateTime(assignment.committedFrom, locale, timezone),
                          to: formatDateTime(assignment.committedTo, locale, timezone),
                        })}
                      </p>
                    ) : null}
                  </div>
                  {permissions.canAssignResources ? (
                    <Button variant="ghost" size="sm" onClick={() => setUnassignTarget(assignment)}>
                      <UserMinus aria-hidden="true" />
                      {t('load.assignments.unassign')}
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {permissions.canAssignResources ? (
        <AssignResourcesDialog loadId={load.id} hasCarrier={Boolean(carrier)} open={dialogOpen} onOpenChange={setDialogOpen} />
      ) : null}

      <ReasonAlertDialog
        open={unassignTarget !== null}
        onOpenChange={(open) => !open && setUnassignTarget(null)}
        title={t('load.assignments.unassign')}
        description={t('load.assignments.unassignConfirm')}
        reasonLabel={t('load.assignments.unassignReasonLabel')}
        cancelLabel={t('common.actions.cancel')}
        confirmLabel={t('load.assignments.unassign')}
        isPending={isPending}
        onConfirm={handleUnassign}
      />
    </div>
  )
}
