import { notFound, redirect } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getActor } from '@/server/context'
import { isMfaEnrolled, roleRequiresMfa } from '@/server/auth/mfa'
import { MfaSetupWizard } from './mfa-setup-wizard'

/**
 * The MFA enrolment gate. `(app)/app/layout.tsx` redirects any Admin or
 * Accounting user who has not yet enrolled here, and this is the *only*
 * route reachable under `/app` until they finish — so this page has no
 * shell chrome of its own beyond what the layout already renders.
 */
export default async function MfaSetupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const actor = await getActor()
  if (!actor) redirect(`/${locale}/login`)

  const alreadyEnrolled = await isMfaEnrolled(actor.userId)
  if (alreadyEnrolled || !roleRequiresMfa(actor.role)) {
    redirect(`/${locale}/app`)
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center px-4 py-10">
      <MfaSetupWizard locale={locale} />
    </div>
  )
}
