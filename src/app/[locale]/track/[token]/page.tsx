import type { Metadata } from 'next'
import { isLocale } from '@/i18n/config'
import { notFound } from 'next/navigation'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { isAppError } from '@/lib/errors'
import { getRequestMeta } from '@/server/context'
import { resolvePublicTrackingLink } from '@/server/tracking/public-links'
import { TrackErrorScreen } from './_components/track-error-screen'
import { PublicTrackingView } from './_components/public-tracking-view'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

/**
 * The public, token-addressed customer tracking page. No app shell, no
 * `Actor` — `resolvePublicTrackingLink` derives its own tenant scope from
 * the token itself (see that function's header comment) and returns a
 * deliberately narrow projection, so nothing rendered here can ever expose
 * more than a customer should see. Mirrors `sign/[token]/page.tsx`'s
 * pattern: read straight from the service layer as a Server Component, and
 * turn a thrown `AppError` into a specific, calm error screen rather than a
 * generic 404 or a stack trace.
 */
export default async function TrackPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>
}) {
  const { locale, token } = await params
  if (!isLocale(locale)) notFound()

  const dictionary = await getDictionary(locale, ['tracking', 'common', 'errors'])
  const t = createTranslator(dictionary, locale)

  try {
    const requestMeta = await getRequestMeta()
    const projection = await resolvePublicTrackingLink(token, requestMeta.ipAddress)
    return <PublicTrackingView projection={projection} locale={locale} t={t} />
  } catch (error) {
    const messageKey = isAppError(error) ? error.messageKey : 'tracking.errors.linkNotFound'
    return <TrackErrorScreen messageKey={messageKey} t={t} />
  }
}
