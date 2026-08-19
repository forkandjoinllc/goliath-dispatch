'use client'

import * as React from 'react'
import { ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useTranslate } from '@/components/providers/i18n-provider'

export type ComplianceState = 'blocked' | 'warning' | 'clear'

const CONFIG: Record<ComplianceState, { tone: 'danger' | 'warning' | 'success'; icon: typeof ShieldCheck; i18nKey: string }> = {
  blocked: { tone: 'danger', icon: ShieldX, i18nKey: 'nav.status.compliance.blocked' },
  warning: { tone: 'warning', icon: ShieldAlert, i18nKey: 'nav.status.compliance.warning' },
  clear: { tone: 'success', icon: ShieldCheck, i18nKey: 'nav.status.compliance.clear' },
}

/** Summarizes whether a load's compliance gates are met — see architecture §7. */
export function ComplianceBadge({ state, className }: { state: ComplianceState; className?: string }) {
  const t = useTranslate()
  const config = CONFIG[state]
  const Icon = config.icon
  return (
    <Badge tone={config.tone} className={className}>
      <Icon className="size-3.5" aria-hidden="true" />
      {t(config.i18nKey)}
    </Badge>
  )
}
