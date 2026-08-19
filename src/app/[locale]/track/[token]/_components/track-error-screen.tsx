import type { TranslateFn } from '@/i18n/translate'

/**
 * Maps a thrown `AppError.messageKey` to a specific, calm error screen — a
 * customer with a bad link should never see a raw 404 or a stack trace.
 * Mirrors `sign/[token]/_components/error-screen.tsx`'s pattern.
 */
const SCREEN_BY_MESSAGE_KEY: Record<string, { title: string; description: string }> = {
  'tracking.errors.linkNotFound': {
    title: 'tracking.publicPage.notFoundTitle',
    description: 'tracking.publicPage.notFoundBody',
  },
  'tracking.errors.linkExpired': {
    title: 'tracking.publicPage.expiredTitle',
    description: 'tracking.publicPage.expiredBody',
  },
  'tracking.errors.linkRevoked': {
    title: 'tracking.publicPage.revokedTitle',
    description: 'tracking.publicPage.revokedBody',
  },
  'errors.rateLimited': {
    title: 'tracking.publicPage.rateLimitedTitle',
    description: 'tracking.publicPage.rateLimitedBody',
  },
}

export function TrackErrorScreen({ messageKey, t }: { messageKey: string; t: TranslateFn }) {
  const screen = SCREEN_BY_MESSAGE_KEY[messageKey] ?? SCREEN_BY_MESSAGE_KEY['tracking.errors.linkNotFound']!

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-bold text-carbon">{t(screen.title)}</h1>
      <p className="text-sm text-steel-600">{t(screen.description)}</p>
    </div>
  )
}
