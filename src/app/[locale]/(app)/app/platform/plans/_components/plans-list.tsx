'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useI18n, useTranslate } from '@/components/providers/i18n-provider'
import { formatMoney } from '@/i18n/translate'
import { PlanForm, type PlanFormValues } from './plan-form'
import type { SaasPlan } from '@/db/schema'

function toFormValues(plan: SaasPlan): PlanFormValues {
  return {
    code: plan.code,
    nameEn: plan.nameEn,
    nameEs: plan.nameEs,
    descriptionEn: plan.descriptionEn ?? '',
    descriptionEs: plan.descriptionEs ?? '',
    monthlyPriceCents: plan.monthlyPriceCents,
    trialDays: plan.trialDays,
    maxUsers: plan.maxUsers,
    maxCarriers: plan.maxCarriers,
    maxLoadsPerMonth: plan.maxLoadsPerMonth,
    isPublic: plan.isPublic,
    sortOrder: plan.sortOrder,
  }
}

const EMPTY_PLAN: PlanFormValues = {
  code: '',
  nameEn: '',
  nameEs: '',
  descriptionEn: '',
  descriptionEs: '',
  monthlyPriceCents: 0,
  trialDays: 14,
  maxUsers: null,
  maxCarriers: null,
  maxLoadsPerMonth: null,
  isPublic: true,
  sortOrder: 0,
}

export function PlansList({ canManage, plans }: { canManage: boolean; plans: SaasPlan[] }) {
  const t = useTranslate()
  const { locale } = useI18n()
  const router = useRouter()
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)

  return (
    <div className="space-y-4">
      {canManage ? (
        <div>
          {creating ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('platform.plans.create')}</CardTitle>
              </CardHeader>
              <PlanForm
                defaultValues={EMPTY_PLAN}
                onSaved={() => {
                  setCreating(false)
                  router.refresh()
                }}
              />
            </Card>
          ) : (
            <Button type="button" onClick={() => setCreating(true)}>
              {t('platform.plans.create')}
            </Button>
          )}
        </div>
      ) : null}

      <div className="space-y-3">
        {plans.map((plan) => (
          <Card key={plan.id}>
            {editingId === plan.id ? (
              <>
                <CardHeader>
                  <CardTitle>{plan.nameEn}</CardTitle>
                </CardHeader>
                <PlanForm
                  planId={plan.id}
                  defaultValues={toFormValues(plan)}
                  onSaved={() => {
                    setEditingId(null)
                    router.refresh()
                  }}
                />
              </>
            ) : (
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p className="font-semibold text-carbon">
                    {plan.nameEn} <span className="font-mono text-xs text-steel-500">({plan.code})</span>
                  </p>
                  <p className="text-xs text-steel-600">
                    {formatMoney(plan.monthlyPriceCents, locale)} / {t('platform.plans.perMonth')}
                    {' · '}
                    {t('platform.plans.trialDaysValue', { count: plan.trialDays })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!plan.isPublic ? <Badge tone="neutral">{t('platform.plans.private')}</Badge> : null}
                  {canManage ? (
                    <Button type="button" variant="secondary" size="sm" onClick={() => setEditingId(plan.id)}>
                      {t('platform.plans.edit')}
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
