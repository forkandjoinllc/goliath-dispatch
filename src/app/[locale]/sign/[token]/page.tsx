import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { isAppError } from '@/lib/errors'
import { getTenant } from '@/server/context'
import { resolveSignatureRequestByToken } from '@/server/signatures/service'
import { renderTemplate } from '@/server/signatures/templates'
import { SignErrorScreen } from './_components/error-screen'
import { SigningCeremony } from './_components/signing-ceremony'

/**
 * The public signing ceremony. Reads the request straight from the service
 * layer (this is a Server Component; `resolveSignatureRequestByToken` is
 * `server-only` and safe to call directly) so a bad or terminal link never
 * reaches the client bundle at all — it renders a specific, actionable error
 * screen instead of the ceremony UI.
 */
export default async function SignPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>
}) {
  const { locale, token } = await params
  if (!isLocale(locale)) notFound()

  const dictionary = await getDictionary(locale, ['signature', 'common'])
  const t = createTranslator(dictionary, locale)

  try {
    const { request, template } = await resolveSignatureRequestByToken(token)
    const rendered = renderTemplate(template, request.tokenValues, request.locale)
    const tenant = await getTenant(request.tenantId)

    return (
      <SigningCeremony
        token={token}
        locale={request.locale}
        tenantName={tenant?.displayName ?? 'Goliath Dispatch'}
        title={rendered.title}
        body={rendered.body}
        consentCopy={rendered.consentCopy}
        signerEmail={request.signerEmail}
      />
    )
  } catch (error) {
    const messageKey = isAppError(error) ? error.messageKey : 'signature.errors.linkInvalid'
    return <SignErrorScreen messageKey={messageKey} t={t} />
  }
}
