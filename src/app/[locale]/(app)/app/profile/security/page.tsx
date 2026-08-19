import { notFound, redirect } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { getActor } from '@/server/context'
import { isMfaEnrolled, roleRequiresMfa } from '@/server/auth/mfa'
import { listActiveSessions } from '@/server/auth/sessions'
import { PageHeader } from '@/components/shell/page-header'
import { ChangePasswordForm } from './change-password-form'
import { MfaSection } from './mfa-section'
import { SessionsSection } from './sessions-section'

export default async function SecuritySettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const actor = await getActor()
  if (!actor) redirect(`/${locale}/login`)

  const [enrolled, sessions] = await Promise.all([
    isMfaEnrolled(actor.userId),
    listActiveSessions(actor.userId, actor.sessionId),
  ])
  const dictionary = await getDictionary(locale, ['settings', 'auth', 'common'])
  const t = createTranslator(dictionary, locale)

  return (
    <div className="space-y-8">
      <PageHeader title={t('settings.security.title')} description={t('settings.security.subtitle')} />
      <ChangePasswordForm />
      <MfaSection locale={locale} enrolled={enrolled} required={roleRequiresMfa(actor.role)} />
      <SessionsSection
        sessions={sessions.map((s) => ({
          id: s.id,
          ipAddress: s.ipAddress,
          userAgent: s.userAgent,
          lastSeenAt: s.lastSeenAt.toISOString(),
          isCurrent: s.isCurrent,
        }))}
      />
    </div>
  )
}
