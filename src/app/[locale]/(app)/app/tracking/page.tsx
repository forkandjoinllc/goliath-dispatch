import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { loadFor } from '@/server/action'
import { can, scopeFilter } from '@/lib/permissions'
import { getTenantPolicy } from '@/server/context'
import { listFleetTrackingSessions } from '@/server/tracking/queries'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { FleetSessionTable } from './_components/fleet-session-table'

export default async function TrackingFleetPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('tracking:read')
  const dictionary = await getDictionary(locale, ['tracking', 'common', 'errors'])
  const t = createTranslator(dictionary, locale)

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const decision = can(ctx.actor, 'tracking:read', undefined, policy)
  const scope = scopeFilter(ctx.actor, decision.scope!)

  const rows = await listFleetTrackingSessions(ctx.db, scope)

  return (
    <div className="space-y-6">
      <PageHeader title={t('tracking.fleetView.title')} description={t('tracking.fleetView.description')} />
      <Card>
        <CardContent className="pt-6">
          <FleetSessionTable rows={rows} localePrefix={`/${locale}`} />
        </CardContent>
      </Card>
    </div>
  )
}
