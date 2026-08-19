import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { listPublicPlans } from '@/server/tenants/queries'
import { SignupWizard } from './signup-wizard'

export default async function SignupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const plans = await listPublicPlans()

  return <SignupWizard locale={locale} plans={plans} />
}
