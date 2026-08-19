'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { useTransition } from 'react'
import { Radio } from 'lucide-react'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { TextField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/feedback'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime } from '@/i18n/translate'
import type { SessionHealthStatus } from '@/server/tracking/sessions'
import {
  advanceMockSessionAction,
  endTrackingSessionAction,
  startTrackingSessionAction,
} from '@/server/tracking/actions'

const HEALTH_TONE: Record<SessionHealthStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  unknown: 'neutral',
  healthy: 'success',
  stale: 'warning',
  lost: 'danger',
  ended: 'neutral',
}

export interface SessionSummary {
  id: string
  provider: string
  driverId: string | null
  startedAt: Date | null
  endedAt: Date | null
  healthStatus: SessionHealthStatus
  lastEventAt: Date | null
  lastLocationLabel: string | null
  routeProgressPercent: number | null
  remainingMiles: number | null
  etaAt: Date | null
}

const startSchema = z.object({ driverId: z.string().uuid() })
type StartValues = z.infer<typeof startSchema>

function StartSessionForm({ loadId, driverIdHint }: { loadId: string; driverIdHint: string | null }) {
  const t = useTranslate()
  const router = useRouter()

  const { form, onSubmit, isPending } = useActionForm<StartValues, { id: string }>({
    schema: startSchema,
    defaultValues: { driverId: driverIdHint ?? '' },
    action: (values) => startTrackingSessionAction({ loadId, driverId: values.driverId }),
    onSuccess: () => router.refresh(),
    successMessageKey: 'tracking.session.startSuccess',
  })

  return (
    <Form form={form} onSubmit={onSubmit} className="space-y-3">
      <FormErrorSummary title={t('errors.validationFailed')} />
      <TextField name="driverId" label={t('tracking.session.driverLabel')} />
      <Button type="submit" loading={isPending}>
        {t('tracking.session.startButton')}
      </Button>
    </Form>
  )
}

export function SessionControlPanel({
  loadId,
  session,
  driverIdHint,
  canManage,
  isMockProvider,
}: {
  loadId: string
  session: SessionSummary | null
  driverIdHint: string | null
  canManage: boolean
  isMockProvider: boolean
}) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [minutes, setMinutes] = React.useState(30)

  function endSession() {
    if (!session) return
    startTransition(async () => {
      const result = await endTrackingSessionAction({ loadId, sessionId: session.id })
      if (result.ok) {
        toast({ tone: 'success', title: t('tracking.session.endSuccess') })
        router.refresh()
      } else {
        toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
      }
    })
  }

  function simulate() {
    if (!session) return
    startTransition(async () => {
      const result = await advanceMockSessionAction({ loadId, sessionId: session.id, minutes })
      if (result.ok) {
        toast({ tone: 'success', title: t('tracking.session.simulateSuccess', { minutes, count: result.data.ingested }) })
        router.refresh()
      } else {
        toast({ tone: 'error', title: t(result.error.messageKey, result.error.params) })
      }
    })
  }

  const isOpen = session && !session.endedAt

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <Radio className="size-4" aria-hidden="true" />
          {t('tracking.session.title')}
        </CardTitle>
        {session ? <Badge tone={HEALTH_TONE[session.healthStatus]}>{t(`tracking.health.${session.healthStatus}`)}</Badge> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {!session ? (
          <>
            <p className="text-sm text-steel-600">{t('tracking.session.notStarted')}</p>
            {canManage ? <StartSessionForm loadId={loadId} driverIdHint={driverIdHint} /> : null}
          </>
        ) : (
          <div className="space-y-2 text-sm">
            <p>{t('tracking.session.provider')}: {session.provider}</p>
            {session.startedAt ? (
              <p>{t('tracking.session.startedAt', { date: formatDateTime(session.startedAt, locale, timezone) })}</p>
            ) : null}
            {session.endedAt ? (
              <p>{t('tracking.session.endedAt', { date: formatDateTime(session.endedAt, locale, timezone) })}</p>
            ) : null}
            <p>
              {session.lastLocationLabel
                ? t('tracking.session.lastPosition') + `: ${session.lastLocationLabel}`
                : t('tracking.session.noPositionYet')}
            </p>
            <p>{session.etaAt ? t('tracking.session.eta', { date: formatDateTime(session.etaAt, locale, timezone) }) : t('tracking.session.noEta')}</p>
            <p>
              {session.routeProgressPercent != null
                ? t('tracking.session.progress', { percent: session.routeProgressPercent })
                : t('tracking.session.noProgress')}
            </p>
          </div>
        )}

        {canManage && isOpen ? (
          <Button variant="destructive" onClick={endSession} loading={isPending}>
            {t('tracking.session.stopButton')}
          </Button>
        ) : null}

        {isMockProvider && isOpen ? (
          <Alert tone="info" title={t('tracking.session.simulateButton')}>
            <p className="mb-2">{t('tracking.session.simulateHint')}</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={720}
                value={minutes}
                onChange={(event) => setMinutes(Number(event.target.value) || 1)}
                className="w-20 rounded border border-steel-300 px-2 py-1 text-sm"
                aria-label={t('tracking.session.simulateMinutesLabel')}
              />
              <Button size="sm" onClick={simulate} loading={isPending}>
                {t('tracking.session.simulateButton')}
              </Button>
            </div>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}
