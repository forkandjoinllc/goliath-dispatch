import { CheckCircle2, XCircle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { TranslateFn } from '@/i18n/translate'
import type { VerifyIntegrityResult } from '@/server/signatures/service'
import { cn } from '@/lib/utils'

function Row({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={cn('flex items-center gap-2 text-sm font-medium', ok ? 'text-success-700' : 'text-danger-700')}>
      {ok ? (
        <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
      ) : (
        <XCircle className="size-4 shrink-0" aria-hidden="true" />
      )}
      <span>{label}</span>
    </div>
  )
}

/**
 * Renders the *live* result of `verifyIntegrity()` — never a stored flag —
 * so "tamper-evident" is something this screen demonstrates on every load,
 * not a claim it repeats from the database.
 */
export function IntegrityPanel({ result, t }: { result: VerifyIntegrityResult; t: TranslateFn }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('signature.detail.integrity')}</CardTitle>
        <CardDescription>{t('signature.detail.integrityDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Row ok={result.sealValid} label={t(result.sealValid ? 'signature.detail.sealValid' : 'signature.detail.sealInvalid')} />
        <Row
          ok={result.documentHashValid}
          label={t(result.documentHashValid ? 'signature.detail.documentHashValid' : 'signature.detail.documentHashInvalid')}
        />
        <Row
          ok={result.chainValid}
          label={t(
            result.chainValid ? 'signature.detail.chainValid' : 'signature.detail.chainInvalid',
            result.brokenAtEventId ? { eventId: result.brokenAtEventId } : undefined,
          )}
        />
      </CardContent>
    </Card>
  )
}
