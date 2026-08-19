'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { ShieldAlert } from 'lucide-react'
import { useActionForm } from '@/components/forms/use-action-form'
import { Form, FormErrorSummary } from '@/components/forms/form'
import { TextField, TextareaField } from '@/components/forms/fields'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, EmptyState } from '@/components/ui/feedback'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatDateTime, formatInches, formatPounds } from '@/i18n/translate'
import type { OversizeEvaluation } from '@/db/schema'
import { decodeGuidanceNote } from '@/server/oversize/notes'
import { runOversizeEvaluationAction, validateOversizeEvaluationAction } from '@/server/oversize/actions'

/**
 * The oversize / overweight evaluation panel. Exported for reuse anywhere a
 * load's oversize status is relevant — this file backs both
 * `app/permits/oversize/[loadId]/page.tsx` and, per the loads agent's
 * `loads/[id]/_components/tracking-tab.tsx` "comingSoon" placeholder, is the
 * component to import into that load detail page once that agent is ready.
 *
 * Props are intentionally plain data + booleans — no server import happens
 * as a side effect of rendering; every mutation goes through the two
 * `oversize` server actions imported directly (never through the barrel
 * `@/server/oversize` index, which would pull `service.ts`'s
 * `'server-only'` code into this client bundle).
 */

type StateResult = OversizeEvaluation['stateResults'][number]

const OUTCOME_TONE: Record<OversizeEvaluation['outcome'], 'success' | 'warning' | 'danger' | 'neutral'> = {
  clear: 'success',
  oversize: 'warning',
  overweight: 'warning',
  oversize_overweight: 'danger',
  insufficient_data: 'neutral',
}

const VALIDATION_TONE: Record<OversizeEvaluation['humanValidationStatus'], 'success' | 'warning' | 'danger'> = {
  pending: 'warning',
  validated: 'success',
  rejected: 'danger',
}

function GuidanceNoteText({ note }: { note: string }) {
  const t = useTranslate()
  const { key, params } = decodeGuidanceNote(note)
  return <>{t(key, params)}</>
}

function StateResultRow({ result }: { result: StateResult }) {
  const t = useTranslate()
  const { locale } = useI18n()
  return (
    <TableRow>
      <TableCell className="font-semibold">{result.stateCode}</TableCell>
      <TableCell>
        {result.exceedances.length === 0 ? (
          <span className="text-steel-500">{t('oversize.panel.noExceedances')}</span>
        ) : (
          <ul className="space-y-0.5">
            {result.exceedances.map((e, i) => (
              <li key={i}>
                {t(`oversize.dimension.${e.dimension}`)}:{' '}
                {e.unit === 'in' ? formatInches(e.value, locale) : formatPounds(e.value, locale)}
                {' > '}
                {e.unit === 'in' ? formatInches(e.limit, locale) : formatPounds(e.limit, locale)}
              </li>
            ))}
          </ul>
        )}
      </TableCell>
      <TableCell>
        <Badge tone={result.permitRequired ? 'warning' : 'neutral'}>
          {t(result.permitRequired ? 'oversize.panel.yes' : 'oversize.panel.no')}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge tone={result.escortRequired ? 'warning' : 'neutral'}>
          {t(result.escortRequired ? 'oversize.panel.yes' : 'oversize.panel.no')}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge tone={result.policeEscortRequired ? 'danger' : 'neutral'}>
          {t(result.policeEscortRequired ? 'oversize.panel.yes' : 'oversize.panel.no')}
        </Badge>
      </TableCell>
      <TableCell>
        {result.travelRestrictions.length === 0 ? (
          <span className="text-steel-500">{t('oversize.panel.noTravelRestrictions')}</span>
        ) : (
          <ul className="space-y-0.5">
            {result.travelRestrictions.map((note, i) => (
              <li key={i}>
                <GuidanceNoteText note={note} />
              </li>
            ))}
          </ul>
        )}
      </TableCell>
    </TableRow>
  )
}

const runEvaluationSchema = z.object({
  axleWeightPounds: z.union([z.literal(''), z.coerce.number().int().positive().max(200_000)]),
  axleConfiguration: z.string().trim().max(60),
})
type RunEvaluationValues = z.infer<typeof runEvaluationSchema>

function RunEvaluationForm({ loadId, hasEvaluation }: { loadId: string; hasEvaluation: boolean }) {
  const t = useTranslate()
  const router = useRouter()

  const { form, onSubmit, isPending } = useActionForm<RunEvaluationValues, { id: string }>({
    schema: runEvaluationSchema,
    defaultValues: { axleWeightPounds: '', axleConfiguration: '' },
    action: (values) =>
      runOversizeEvaluationAction({
        loadId,
        axleWeightPounds: values.axleWeightPounds === '' ? null : values.axleWeightPounds,
        axleConfiguration: values.axleConfiguration.trim() || null,
      }),
    onSuccess: () => router.refresh(),
    successMessageKey: 'oversize.evaluation.title',
  })

  return (
    <Form form={form} onSubmit={onSubmit} className="space-y-4">
      <FormErrorSummary title={t('errors.validationFailed')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          name="axleWeightPounds"
          label={t('oversize.evaluation.axleWeightLabel')}
          description={t('oversize.evaluation.axleWeightHint')}
        />
        <TextField
          name="axleConfiguration"
          label={t('oversize.evaluation.axleConfigurationLabel')}
          placeholder={t('oversize.evaluation.axleConfigurationPlaceholder')}
        />
      </div>
      <Button type="submit" loading={isPending} loadingLabel={t('oversize.evaluation.running')}>
        {t(hasEvaluation ? 'oversize.evaluation.rerunButton' : 'oversize.evaluation.runButton')}
      </Button>
    </Form>
  )
}

const validationSchema = z.object({ notes: z.string().trim().max(2000) })
type ValidationValues = z.infer<typeof validationSchema>

function ValidationDialog({
  loadId,
  evaluationId,
  status,
  open,
  onOpenChange,
}: {
  loadId: string
  evaluationId: string
  status: 'validated' | 'rejected'
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslate()
  const router = useRouter()

  const { form, onSubmit, isPending } = useActionForm<ValidationValues, { id: string }>({
    schema: validationSchema,
    defaultValues: { notes: '' },
    action: (values) =>
      validateOversizeEvaluationAction({ loadId, evaluationId, status, notes: values.notes.trim() || null }),
    onSuccess: () => {
      onOpenChange(false)
      router.refresh()
    },
    successMessageKey: 'oversize.validation.submitted',
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.actions.close')}>
        <Form form={form} onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {t(status === 'validated' ? 'oversize.validation.validateButton' : 'oversize.validation.confirmRejectTitle')}
            </DialogTitle>
          </DialogHeader>
          {status === 'rejected' ? <p className="text-sm text-steel-600">{t('oversize.validation.confirmRejectBody')}</p> : null}
          <FormErrorSummary title={t('errors.validationFailed')} />
          <TextareaField
            name="notes"
            label={t('oversize.validation.notesLabel')}
            placeholder={t('oversize.validation.notesPlaceholder')}
            rows={3}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" variant={status === 'rejected' ? 'destructive' : 'primary'} loading={isPending}>
              {t(status === 'validated' ? 'oversize.validation.validateButton' : 'oversize.validation.rejectButton')}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export interface OversizePanelProps {
  loadId: string
  evaluation: OversizeEvaluation | null
  /** True when the load's dimensions/weight have changed since `evaluation` ran (see `compliance/gates.ts`). */
  isStale: boolean
  canEvaluate: boolean
  canValidate: boolean
}

export function OversizePanel({ loadId, evaluation, isStale, canEvaluate, canValidate }: OversizePanelProps) {
  const t = useTranslate()
  const { locale, timezone } = useI18n()
  const [validationTarget, setValidationTarget] = React.useState<'validated' | 'rejected' | null>(null)

  return (
    <div className="space-y-6">
      <Alert tone="warning" title={t('oversize.disclaimer.title')}>
        {t('oversize.disclaimer.body')}
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>{t('oversize.evaluation.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-steel-600">{t('oversize.evaluation.description')}</p>

          {evaluation ? (
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={OUTCOME_TONE[evaluation.outcome]}>{t(`oversize.outcome.${evaluation.outcome}`)}</Badge>
              <span className="text-sm text-steel-600">{t(`oversize.outcomeDescription.${evaluation.outcome}`)}</span>
            </div>
          ) : (
            <EmptyState title={t('oversize.evaluation.noEvaluationYet')} />
          )}

          {evaluation ? (
            <p className="text-xs text-steel-500">
              {t('oversize.evaluation.evaluatedAt', { date: formatDateTime(evaluation.evaluatedAt, locale, timezone) })}
            </p>
          ) : null}

          {isStale ? <Alert tone="warning">{t('oversize.evaluation.staleBanner')}</Alert> : null}

          {evaluation && evaluation.missingDataWarnings.length > 0 ? (
            <Alert tone="warning" title={t('oversize.panel.missingDataTitle')}>
              <ul className="space-y-0.5">
                {evaluation.missingDataWarnings.map((note, i) => (
                  <li key={i}>
                    <GuidanceNoteText note={note} />
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}

          {canEvaluate ? <RunEvaluationForm loadId={loadId} hasEvaluation={Boolean(evaluation)} /> : null}
        </CardContent>
      </Card>

      {evaluation ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('oversize.panel.stateResultsTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {evaluation.stateResults.length === 0 ? (
              <EmptyState title={t('oversize.panel.stateResultsEmpty')} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('oversize.rules.stateColumn')}</TableHead>
                    <TableHead>{t('oversize.panel.exceedancesTitle')}</TableHead>
                    <TableHead>{t('oversize.panel.permitColumn')}</TableHead>
                    <TableHead>{t('oversize.panel.escortColumn')}</TableHead>
                    <TableHead>{t('oversize.panel.policeEscortColumn')}</TableHead>
                    <TableHead>{t('oversize.panel.travelRestrictionsTitle')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {evaluation.stateResults.map((result) => (
                    <StateResultRow key={result.stateCode} result={result} />
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {evaluation && (evaluation.outcome === 'oversize' || evaluation.outcome === 'overweight' || evaluation.outcome === 'oversize_overweight') ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4" aria-hidden="true" />
              {t('oversize.validation.title')}
            </CardTitle>
            <Badge tone={VALIDATION_TONE[evaluation.humanValidationStatus]}>
              {t(`oversize.validation.status.${evaluation.humanValidationStatus}`)}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-steel-600">{t('oversize.validation.description')}</p>
            {evaluation.validatedByUserId ? (
              <p className="text-xs text-steel-500">
                {t('oversize.validation.validatedBy', {
                  status: t(`oversize.validation.status.${evaluation.humanValidationStatus}`),
                  name: evaluation.validatedByUserId,
                  date: formatDateTime(evaluation.validatedAt, locale, timezone),
                })}
              </p>
            ) : null}
            {canValidate ? (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setValidationTarget('validated')}>
                  {t('oversize.validation.validateButton')}
                </Button>
                <Button size="sm" variant="destructive" onClick={() => setValidationTarget('rejected')}>
                  {t('oversize.validation.rejectButton')}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-steel-500">{t('oversize.validation.adminOnly')}</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {evaluation && validationTarget ? (
        <ValidationDialog
          loadId={loadId}
          evaluationId={evaluation.id}
          status={validationTarget}
          open={Boolean(validationTarget)}
          onOpenChange={(open) => !open && setValidationTarget(null)}
        />
      ) : null}
    </div>
  )
}
