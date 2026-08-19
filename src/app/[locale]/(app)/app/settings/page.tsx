import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Building2, Contact, Cog, Wallet, Palette, ShieldCheck, Plug } from 'lucide-react'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { can } from '@/lib/permissions'
import { getTenantPolicy } from '@/server/context'
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const SECTIONS = [
  { key: 'company', href: 'company', icon: Building2 },
  { key: 'contact', href: 'contact', icon: Contact },
  { key: 'branding', href: 'branding', icon: Palette },
  { key: 'operational', href: 'operational', icon: Cog },
  { key: 'financial', href: 'financial', icon: Wallet },
  { key: 'retention', href: 'retention', icon: ShieldCheck },
  { key: 'integrations', href: 'integrations', icon: Plug },
] as const

/**
 * The settings hub. Every section requires `tenant:settings:read`; each
 * subpage additionally checks `tenant:settings:update` before rendering its
 * save controls. `integrations` is a pre-existing sibling route owned by
 * another agent — linked here for discoverability only.
 */
export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('tenant:settings:read')
  const dictionary = await getDictionary(locale, ['settings', 'common'])
  const t = createTranslator(dictionary, locale)
  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const canUpdate = can(ctx.actor, 'tenant:settings:update', undefined, policy).allowed

  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.hub.title')} description={t('settings.hub.description')} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map(({ key, href, icon: Icon }) => (
          <Link key={key} href={`/${locale}/app/settings/${href}`}>
            <Card className="h-full transition-colors hover:border-navy-400">
              <CardHeader className="flex-row items-center gap-3 space-y-0">
                <Icon className="size-5 text-navy-600" aria-hidden="true" />
                <CardTitle>{t(`settings.hub.sections.${key}.title`)}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>{t(`settings.hub.sections.${key}.description`)}</CardDescription>
                {!canUpdate ? <p className="mt-2 text-xs text-steel-500">{t('settings.hub.readOnly')}</p> : null}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
