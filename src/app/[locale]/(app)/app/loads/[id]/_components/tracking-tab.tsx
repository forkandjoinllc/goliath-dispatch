'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { Plus } from 'lucide-react'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { TextareaField, TextField, DateTimeField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import type { CheckCall, OversizeEvaluation } from '@/db/schema'
import type { MapWaypoint } from '@/components/data/map-view'
import { TrackingMapPanel } from '@/components/data/tracking-map-panel'
import { completeCheckCallAction, scheduleCheckCallAction } from '@/server/loads/actions'
import { buildDateTimePickerLabels } from '../../_components/datetime-picker-labels'
import { OversizePanel } from '../../../permits/_components/oversize-panel'
import type { SessionHealthStatus } from '@/server/tracking/sessions'
import type { SessionSummary } from '../../../tracking/[loadId]/_components/session-control-panel'

const HEALTH_TONE: Record<SessionHealthStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  unknown: 'neutral',
  healthy: 'success',
  stale: 'warning',
  lost: 'danger',
  ended: 'neutral',
}

/** Read-only summary — map, last position, health, ETA — with a link to `/app/tracking/[loadId]` for starting/stopping a session and managing public links. */
function TrackingSummaryPanel({ loadId, session, waypoints }: { loadId: string; session: SessionSummary | null; waypoints: MapWaypoint[] }) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>{t('tracking.session.title')}</CardTitle>
          {session ? <Badge tone={HEALTH_TONE[session.healthStatus]}>{t(`tracking.health.${session.healthStatus}`)}</Badge> : null}
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!session ? (
            <p className="text-steel-600">{t('tracking.session.notStarted')}</p>
          ) : (
            <>
              <p>
                {session.lastLocationLabel
                  ? `${t('tracking.session.lastPosition')}: ${session.lastLocationLabel}`
                  : t('tracking.session.noPositionYet')}
              </p>
              <p>
                {session.etaAt
                  ? t('tracking.session.eta', { date: formatDateTime(session.etaAt, locale, timezone) })
                  : t('tracking.session.noEta')}
              </p>
              <p>
                {session.routeProgressPercent != null
                  ? t('tracking.session.progress', { percent: session.routeProgressPercent })
                  : t('tracking.session.noProgress')}
              </p>
            </>
          )}
          <Link href={`/${locale}/app/tracking/${loadId}`} className="inline-block text-navy-700 underline underline-offset-2 hover:no-underline">
            {t('tracking.detail.title')}
          </Link>
        </CardContent>
      </Card>
      <TrackingMapPanel waypoints={waypoints} />
    </div>
  )
}

const scheduleSchema = z.object({ scheduledFor: z.string(), notes: z.string().trim() })
type ScheduleFormValues = z.infer<typeof scheduleSchema>

function ScheduleCheckCallDialog({ loadId, open, onOpenChange }: { loadId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslate()
  const router = useRouter()
  const { timezone } = useI18n()

  const { form, onSubmit, isPending } = useActionForm<ScheduleFormValues, { id: string }>({
    schema: scheduleSchema,
    defaultValues: { scheduledFor: '', notes: '' },
    action: (values) =>
      scheduleCheckCallAction({ loadId, scheduledFor: values.scheduledFor, notes: values.notes.trim() || null }),
    onSuccess: () => {
      onOpenChange(false)
      router.refresh()
    },
    successMessageKey: 'load.tracking.checkCalls.schedule',
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.actions.close')}>
        <Form form={form} onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('load.tracking.checkCalls.schedule')}</DialogTitle>
          </DialogHeader>
          <FormErrorSummary title={t('errors.validationFailed')} />
          <DateTimeField
            name="scheduledFor"
            label={t('load.tracking.checkCalls.scheduledFor')}
            timeZone={timezone}
            pickerLabels={buildDateTimePickerLabels(t)}
          />
          <TextareaField name="notes" label={t('load.tracking.checkCalls.notes')} rows={3} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" loading={isPending} loadingLabel={t('common.states.saving')}>
              {t('common.actions.save')}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

const completeSchema = z.object({ locationSummary: z.string().trim(), notes: z.string().trim() })
type CompleteFormValues = z.infer<typeof completeSchema>

function CompleteCheckCallDialog({
  loadId,
  checkCallId,
  open,
  onOpenChange,
}: {
  loadId: string
  checkCallId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslate()
  const router = useRouter()

  const { form, onSubmit, isPending } = useActionForm<CompleteFormValues, { id: string }>({
    schema: completeSchema,
    defaultValues: { locationSummary: '', notes: '' },
    action: (values) =>
      completeCheckCallAction({
        loadId,
        checkCallId: checkCallId!,
        locationSummary: values.locationSummary.trim() || null,
        notes: values.notes.trim() || null,
      }),
    onSuccess: () => {
      onOpenChange(false)
      router.refresh()
    },
    successMessageKey: 'load.tracking.checkCalls.complete',
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.actions.close')}>
        <Form form={form} onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('load.tracking.checkCalls.complete')}</DialogTitle>
          </DialogHeader>
          <FormErrorSummary title={t('errors.validationFailed')} />
          <TextField name="locationSummary" label={t('load.tracking.checkCalls.locationSummary')} />
          <TextareaField name="notes" label={t('load.tracking.checkCalls.notes')} rows={3} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" loading={isPending} loadingLabel={t('common.states.saving')}>
              {t('common.actions.save')}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export function TrackingTab({
  loadId,
  checkCalls,
  completedByLabels,
  canManage,
  oversizeEvaluation,
  oversizeIsStale,
  canEvaluateOversize,
  canValidateOversize,
  trackingSession,
  trackingWaypoints,
}: {
  loadId: string
  checkCalls: CheckCall[]
  completedByLabels: Record<string, string>
  canManage: boolean
  oversizeEvaluation: OversizeEvaluation | null
  oversizeIsStale: boolean
  canEvaluateOversize: boolean
  canValidateOversize: boolean
  trackingSession: SessionSummary | null
  trackingWaypoints: MapWaypoint[]
}) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()
  const [scheduleOpen, setScheduleOpen] = React.useState(false)
  const [completeTarget, setCompleteTarget] = React.useState<string | null>(null)

  const now = Date.now()

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-base font-bold text-carbon">{t('load.tracking.summary')}</h3>
        <TrackingSummaryPanel loadId={loadId} session={trackingSession} waypoints={trackingWaypoints} />
      </div>

      <div>
        <h3 className="mb-2 text-base font-bold text-carbon">{t('oversize.evaluation.title')}</h3>
        <OversizePanel
          loadId={loadId}
          evaluation={oversizeEvaluation}
          isStale={oversizeIsStale}
          canEvaluate={canEvaluateOversize}
          canValidate={canValidateOversize}
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-carbon">{t('load.tracking.checkCalls.title')}</h3>
          {canManage ? (
            <Button size="sm" onClick={() => setScheduleOpen(true)}>
              <Plus aria-hidden="true" />
              {t('load.tracking.checkCalls.schedule')}
            </Button>
          ) : null}
        </div>

        {checkCalls.length === 0 ? (
          <EmptyState title={t('load.tracking.checkCalls.empty')} />
        ) : (
          <ul className="mt-3 divide-y divide-steel-200 rounded-lg border border-steel-200">
            {checkCalls.map((call) => {
              const isOverdue = !call.completedAt && call.scheduledFor.getTime() < now
              return (
                <li key={call.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge tone={call.completedAt ? 'success' : isOverdue ? 'danger' : 'neutral'}>
                        {call.completedAt
                          ? t('load.tracking.checkCalls.completedBy', {
                              actor: completedByLabels[call.completedByUserId ?? ''] ?? '—',
                              date: formatDateTime(call.completedAt, locale, timezone),
                            })
                          : isOverdue
                            ? t('load.tracking.checkCalls.overdue', { date: formatDateTime(call.scheduledFor, locale, timezone) })
                            : t('load.tracking.checkCalls.due', { date: formatDateTime(call.scheduledFor, locale, timezone) })}
                      </Badge>
                      <span className="text-xs text-steel-600">{t(`load.tracking.checkCalls.origin.${call.origin}`)}</span>
                    </div>
                    {call.locationSummary ? <p className="mt-1 text-sm text-carbon">{call.locationSummary}</p> : null}
                    {call.notes ? <p className="text-xs text-steel-600">{call.notes}</p> : null}
                  </div>
                  {canManage && !call.completedAt ? (
                    <Button variant="secondary" size="sm" onClick={() => setCompleteTarget(call.id)}>
                      {t('load.tracking.checkCalls.complete')}
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {canManage ? <ScheduleCheckCallDialog loadId={loadId} open={scheduleOpen} onOpenChange={setScheduleOpen} /> : null}
      {canManage ? (
        <CompleteCheckCallDialog
          loadId={loadId}
          checkCallId={completeTarget}
          open={completeTarget !== null}
          onOpenChange={(open) => !open && setCompleteTarget(null)}
        />
      ) : null}
    </div>
  )
}
