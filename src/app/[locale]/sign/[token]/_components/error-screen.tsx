import type { TranslateFn } from '@/i18n/translate'

/**
 * Maps a thrown `AppError.messageKey` to a specific, actionable error
 * screen — never a generic 404. Every status the ceremony can be in when a
 * signer opens (or re-opens) the link gets its own title and explanation.
 */
const SCREEN_BY_MESSAGE_KEY: Record<string, { title: string; description: string }> = {
  'signature.errors.linkInvalid': {
    title: 'signature.ceremony.errors.linkInvalidTitle',
    description: 'signature.ceremony.errors.linkInvalidDescription',
  },
  'signature.errors.linkExpired': {
    title: 'signature.ceremony.errors.expiredTitle',
    description: 'signature.ceremony.errors.expiredDescription',
  },
  'signature.errors.alreadySigned': {
    title: 'signature.ceremony.errors.alreadySignedTitle',
    description: 'signature.ceremony.errors.alreadySignedDescription',
  },
  'signature.errors.declined': {
    title: 'signature.ceremony.errors.declinedTitle',
    description: 'signature.ceremony.errors.declinedDescription',
  },
  'signature.errors.voided': {
    title: 'signature.ceremony.errors.voidedTitle',
    description: 'signature.ceremony.errors.voidedDescription',
  },
  'signature.errors.superseded': {
    title: 'signature.ceremony.errors.supersededTitle',
    description: 'signature.ceremony.errors.supersededDescription',
  },
  'errors.rateLimited': {
    title: 'signature.ceremony.errors.rateLimitedTitle',
    description: 'signature.ceremony.errors.rateLimitedDescription',
  },
}

export function SignErrorScreen({ messageKey, t }: { messageKey: string; t: TranslateFn }) {
  const screen = SCREEN_BY_MESSAGE_KEY[messageKey] ?? SCREEN_BY_MESSAGE_KEY['signature.errors.linkInvalid']!

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-bold text-carbon">{t(screen.title)}</h1>
      <p className="text-sm text-steel-600">{t(screen.description)}</p>
    </div>
  )
}
