import { Badge } from '@/components/ui/badge'
import type { TranslateFn } from '@/i18n/translate'
import type { SignatureRequest } from '@/db/schema'

const TONE_BY_STATUS: Record<SignatureRequest['status'], 'neutral' | 'navy' | 'success' | 'warning' | 'danger'> = {
  pending: 'neutral',
  viewed: 'navy',
  signed: 'success',
  declined: 'danger',
  expired: 'warning',
  voided: 'danger',
  superseded: 'warning',
}

/** Pure — accepts `t` as a prop rather than the client hook, so it renders directly from server components. */
export function SignatureStatusBadge({ status, t }: { status: SignatureRequest['status']; t: TranslateFn }) {
  return <Badge tone={TONE_BY_STATUS[status]}>{t(`signature.statuses.${status}`)}</Badge>
}
