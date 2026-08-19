'use client'

import { ShieldCheck } from 'lucide-react'
import { Alert } from '@/components/ui/feedback'
import { ComplianceBadge, type ComplianceState } from '@/components/status/compliance-badge'
import { useTranslate } from '@/components/providers/i18n-provider'
import type { ComplianceResult } from '@/server/compliance'

/** Live `evaluateCarrier` result — the same gate the onboarding-approval and dispatch checks read. */
export function CarrierCompliancePanel({ compliance }: { compliance: ComplianceResult }) {
  const t = useTranslate()
  const state: ComplianceState = compliance.blocking.length > 0 ? 'blocked' : compliance.warnings.length > 0 ? 'warning' : 'clear'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-carbon">{t('carrier.compliance.title')}</h3>
        <ComplianceBadge state={state} />
      </div>

      {compliance.ok && compliance.warnings.length === 0 ? (
        <Alert tone="info">
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4" aria-hidden="true" />
            {t('nav.status.compliance.clear')}
          </span>
        </Alert>
      ) : null}

      {compliance.blocking.length > 0 ? (
        <Alert tone="danger" title={t('nav.status.compliance.blocked')}>
          <ul className="list-inside list-disc space-y-1">
            {compliance.blocking.map((reason, index) => (
              <li key={`${reason.code}-${index}`}>{t(reason.messageKey, reason.params)}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {compliance.warnings.length > 0 ? (
        <Alert tone="warning" title={t('nav.status.compliance.warning')}>
          <ul className="list-inside list-disc space-y-1">
            {compliance.warnings.map((reason, index) => (
              <li key={`${reason.code}-${index}`}>{t(reason.messageKey, reason.params)}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </div>
  )
}
