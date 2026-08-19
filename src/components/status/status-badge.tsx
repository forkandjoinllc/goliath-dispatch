'use client'

import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { useTranslate } from '@/components/providers/i18n-provider'
import { getStatusConfig, type StatusKind, type StatusValueMap } from './status-config'

export interface StatusBadgeProps<K extends StatusKind> {
  kind: K
  value: StatusValueMap[K]
  className?: string
}

/**
 * The single component every status column, card and detail page uses.
 * Resolves tone, icon and translated label from `STATUS_REGISTRY` so a status
 * always looks and reads the same way everywhere it appears.
 */
export function StatusBadge<K extends StatusKind>({ kind, value, className }: StatusBadgeProps<K>) {
  const t = useTranslate()
  const config = getStatusConfig(kind, value)
  const Icon = config.icon
  return (
    <Badge tone={config.tone} className={className}>
      <Icon className="size-3.5" aria-hidden="true" />
      {t(config.i18nKey)}
    </Badge>
  )
}
