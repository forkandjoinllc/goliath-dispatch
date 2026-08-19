'use client'

import * as React from 'react'
import { passwordStrengthIssues, MIN_PASSWORD_LENGTH } from '@/lib/auth/password'
import { Progress } from '@/components/ui/progress'
import { useTranslate } from '@/components/providers/i18n-provider'
import { cn } from '@/lib/utils'

/**
 * Live password strength feedback driven directly by the server's own
 * policy (`passwordStrengthIssues`), so what the meter shows and what the
 * server will actually accept can never drift apart.
 *
 * This mirrors `(auth)/_components/password-strength.tsx` — the two route
 * groups render in different layouts (pre-auth vs. app shell) and neither
 * imports across the other's `_components` boundary, so the small component
 * is duplicated rather than reached into from across route groups.
 */
export function PasswordStrengthMeter({ password }: { password: string }) {
  const t = useTranslate()
  const issues = React.useMemo(() => passwordStrengthIssues(password || ''), [password])

  if (!password) return null

  const criteriaCount = 4 // length, lowercase+uppercase, digit, not common/repetitive
  const failedGroups = new Set<string>()
  for (const issue of issues) {
    if (issue === 'validation.password.tooShort' || issue === 'validation.password.tooLong') failedGroups.add('length')
    else if (issue === 'validation.password.needsLowercase' || issue === 'validation.password.needsUppercase')
      failedGroups.add('case')
    else if (issue === 'validation.password.needsDigit') failedGroups.add('digit')
    else failedGroups.add('other')
  }
  const passedCount = criteriaCount - failedGroups.size
  const percent = Math.max(8, Math.round((passedCount / criteriaCount) * 100))

  const level = issues.length === 0 ? 'strong' : passedCount >= criteriaCount - 1 ? 'fair' : 'weak'
  const toneClass =
    level === 'strong' ? 'bg-success-600' : level === 'fair' ? 'bg-warning-500' : 'bg-danger-600'
  const labelKey = level === 'strong' ? 'auth.password.strong' : level === 'fair' ? 'auth.password.fair' : 'auth.password.weak'

  return (
    <div className="space-y-1.5" aria-live="polite">
      <div className="flex items-center justify-between text-xs text-steel-600">
        <span>{t('auth.password.strength')}</span>
        <span className={cn('font-semibold', level === 'strong' && 'text-success-700', level === 'weak' && 'text-danger-700')}>
          {t(labelKey)}
        </span>
      </div>
      <Progress value={percent} indicatorClassName={toneClass} aria-label={t('auth.password.strength')} />
      {issues.length > 0 ? (
        <ul className="list-inside list-disc space-y-0.5 text-xs text-steel-600">
          {issues.map((issue) => (
            <li key={issue}>{t(issue)}</li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-steel-500">{t('validation.minLength', { min: MIN_PASSWORD_LENGTH })}</p>
    </div>
  )
}
