import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert } from '@/components/ui/feedback'
import { Button } from '@/components/ui/button'

export default async function SignupSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ email?: string }>
}) {
  const { locale } = await params
  const { email } = await searchParams
  if (!isLocale(locale)) notFound()

  const dictionary = await getDictionary(locale, ['auth', 'common'])
  const t = createTranslator(dictionary, locale)

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('auth.signup.successPage.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <Alert tone="info">{t('auth.signup.successPage.body', { email: email ?? '' })}</Alert>
      </CardContent>
      <CardFooter className="justify-center">
        <Button asChild>
          <Link href={`/${locale}/login`}>{t('auth.signup.successPage.cta')}</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
