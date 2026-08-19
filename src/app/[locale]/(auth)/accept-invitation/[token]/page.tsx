import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Alert } from '@/components/ui/feedback'
import { readInvitation, requireUserById } from '@/server/auth/registration'
import { AcceptInvitationForm } from './accept-form'

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>
}) {
  const { locale, token } = await params
  if (!isLocale(locale)) notFound()

  const dictionary = await getDictionary(locale, ['auth', 'common', 'errors', 'validation'])
  const t = createTranslator(dictionary, locale)

  const invitation = await readInvitation(token)

  if (!invitation.ok) {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h1">{t('auth.invite.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert tone="warning">{t(invitation.reasonKey)}</Alert>
        </CardContent>
        <CardFooter className="justify-center">
          <Link href={`/${locale}/login`} className="text-sm font-medium text-navy-700 hover:underline">
            {t('common.actions.back')}
          </Link>
        </CardFooter>
      </Card>
    )
  }

  const inviter = invitation.invitation.invitedByUserId
    ? await requireUserById(invitation.invitation.invitedByUserId).catch(() => null)
    : null
  const inviterName = inviter ? `${inviter.firstName} ${inviter.lastName}` : invitation.invitation.tenantName
  const roleLabel = t(`nav.roles.${invitation.invitation.role}`) === `nav.roles.${invitation.invitation.role}`
    ? invitation.invitation.role
    : t(`nav.roles.${invitation.invitation.role}`)

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('auth.invite.title')}</CardTitle>
        <CardDescription>
          {t('auth.invite.subtitle', {
            inviter: inviterName,
            tenant: invitation.invitation.tenantName,
            role: roleLabel,
          })}
        </CardDescription>
      </CardHeader>
      <AcceptInvitationForm token={token} email={invitation.invitation.email} locale={locale} />
    </Card>
  )
}
