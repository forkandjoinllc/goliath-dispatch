import { notFound, redirect } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { getActor } from '@/server/context'
import { requireUserById } from '@/server/auth/registration'
import { PageHeader } from '@/components/shell/page-header'
import { ProfileForm } from './profile-form'

export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const actor = await getActor()
  if (!actor) redirect(`/${locale}/login`)

  const user = await requireUserById(actor.userId)
  const dictionary = await getDictionary(locale, ['settings', 'common'])
  const t = createTranslator(dictionary, locale)

  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.profile.title')} description={t('settings.profile.subtitle')} />
      <ProfileForm
        defaultValues={{
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone ?? '',
          locale: user.locale,
          timezone: user.timezone,
        }}
      />
    </div>
  )
}
