import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { loadFor } from '@/server/action'
import { getTenantPolicy } from '@/server/context'
import { can, scopeFilter } from '@/lib/permissions'
import { onboardingBoard } from '@/server/carriers/queries'
import { onboardingStatusEnum } from '@/db/schema/_shared'
import { PageHeader } from '@/components/shell/page-header'
import { OnboardingBoardClient } from './_components/onboarding-board'

export default async function OnboardingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const ctx = await loadFor('carrier:onboarding:read')
  const dictionary = await getDictionary(locale, ['onboarding', 'carrier', 'common'])
  const t = createTranslator(dictionary, locale)

  const policy = await getTenantPolicy(ctx.actor.tenantId)
  const decision = can(ctx.actor, 'carrier:onboarding:read', undefined, policy)
  const scope = scopeFilter(ctx.actor, decision.scope!)

  const board = await onboardingBoard(ctx.db, scope)

  const permissions = {
    canSubmit: can(ctx.actor, 'carrier:onboarding:submit', undefined, policy).allowed,
    canReview: can(ctx.actor, 'carrier:onboarding:review', undefined, policy).allowed,
    canApprove: can(ctx.actor, 'carrier:onboarding:approve', undefined, policy).allowed,
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('onboarding.board.title')} />
      <OnboardingBoardClient
        locale={locale}
        board={board}
        statuses={onboardingStatusEnum.enumValues}
        permissions={permissions}
      />
    </div>
  )
}
