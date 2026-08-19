import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { can, scopeFilter } from '@/lib/permissions'
import { listAllEscorts, listAllPermits, listExpiringPermitsScoped } from '@/server/permits/queries'
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { PermitsList } from './_components/permits-list'
import { EscortsList } from './_components/escorts-list'

const EXPIRY_WINDOW_DAYS = 30

export default async function PermitsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('permit:read')
  const dictionary = await getDictionary(locale, ['oversize', 'tracking', 'common', 'errors'])
  const t = createTranslator(dictionary, locale)

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const decision = can(ctx.actor, 'permit:read', undefined, policy)
  const scope = scopeFilter(ctx.actor, decision.scope!)
  const canManage = can(ctx.actor, 'permit:manage', undefined, policy).allowed

  const [permitRows, escortRows, expiringRows] = await Promise.all([
    listAllPermits(ctx.db, scope),
    listAllEscorts(ctx.db, scope),
    listExpiringPermitsScoped(ctx.db, scope, EXPIRY_WINDOW_DAYS),
  ])

  const localePrefix = `/${locale}`

  return (
    <div className="space-y-6">
      <PageHeader title={t('oversize.permits.title')} description={t('oversize.permits.description')} />

      <Card>
        <CardHeader>
          <CardTitle>{t('oversize.expiryWarnings.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {expiringRows.length === 0 ? (
            <p className="text-sm text-steel-600">{t('oversize.expiryWarnings.empty', { days: EXPIRY_WINDOW_DAYS })}</p>
          ) : (
            <PermitsList rows={expiringRows} canManage={canManage} localePrefix={localePrefix} />
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="permits">
        <TabsList>
          <TabsTrigger value="permits">{t('oversize.permits.title')}</TabsTrigger>
          <TabsTrigger value="escorts">{t('oversize.escorts.title')}</TabsTrigger>
        </TabsList>
        <TabsContent value="permits">
          <Card>
            <CardContent className="pt-6">
              <PermitsList rows={permitRows} canManage={canManage} localePrefix={localePrefix} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="escorts">
          <Card>
            <CardContent className="pt-6">
              <EscortsList rows={escortRows} canManage={canManage} localePrefix={localePrefix} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
