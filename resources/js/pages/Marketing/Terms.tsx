import { MarketingLayout } from '@/layouts/MarketingLayout'
import { LegalDocument } from '@/components/Marketing/LegalDocument'
import { PageHero } from '@/components/Marketing/PageHero'
import { useI18n } from '@/lib/i18n'
import type { MarketingPageProps } from '@/types/marketing'

const SECTIONS = [
  'acceptance',
  'description',
  'accountsEligibility',
  'carrierResponsibilities',
  'feesBilling',
  'prohibitedUses',
  'intellectualProperty',
  'disclaimers',
  'limitationOfLiability',
  'termination',
  'disputeResolutionGoverningLaw',
  'changesToTerms',
  'contactUs',
]

export default function Terms(props: MarketingPageProps) {
  const { t } = useI18n()

  return (
    <MarketingLayout {...props}>
      <PageHero title={t('marketing.terms.hero.title')} />
      <LegalDocument root="marketing.terms" sections={SECTIONS} />
    </MarketingLayout>
  )
}
