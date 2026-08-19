import Link from 'next/link'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { notFound } from 'next/navigation'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert } from '@/components/ui/feedback'
import { verifyEmailAction } from '@/server/auth/actions'
import { ResendVerificationForm } from './resend-form'

export default async function VerifyEmailPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>
}) {
  const { locale, token } = await params
  if (!isLocale(locale)) notFound()

  const dictionary = await getDictionary(locale, ['auth', 'common', 'errors', 'validation'])
  const t = createTranslator(dictionary, locale)

  const result = await verifyEmailAction(token)

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('auth.verify.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {result.ok ? (
          <Alert tone="info">{t('auth.verify.success')}</Alert>
        ) : (
          <>
            <Alert tone="warning">{t('auth.verify.expired')}</Alert>
            <ResendVerificationForm />
          </>
        )}
      </CardContent>
      <CardFooter className="justify-center">
        <Link href={`/${locale}/login`} className="text-sm font-medium text-navy-700 hover:underline">
          {t('common.actions.back')}
        </Link>
      </CardFooter>
    </Card>
  )
}
