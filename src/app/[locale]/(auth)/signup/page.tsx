import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { listPublicPlans } from '@/server/tenants/queries'
import { SignupWizard } from './signup-wizard'

/**
 * Rendered on demand: the plan list comes from the database, so this page must
 * not be prerendered at build time. Everything else under `[locale]` stays
 * static, which is what keeps the public marketing pages fast and indexable.
 */
export const dynamic = 'force-dynamic'

export default async function SignupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const plans = await listPublicPlans()

  return <SignupWizard locale={locale} plans={plans} />
}
