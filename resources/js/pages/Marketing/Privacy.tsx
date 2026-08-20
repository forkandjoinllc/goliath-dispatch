import { MarketingLayout } from '@/layouts/MarketingLayout'
import { LegalDocument } from '@/components/Marketing/LegalDocument'
import { PageHero } from '@/components/Marketing/PageHero'
import { useI18n } from '@/lib/i18n'
import type { MarketingPageProps } from '@/types/marketing'

const SECTIONS = [
  'intro',
  'dataWeCollect',
  'howWeUseData',
  'electronicSignatureConsent',
  'smsConsentAndStop',
  'trackingLocationDriverConsent',
  'retention',
  'subprocessors',
  'yourRights',
  'dataSecurity',
  'childrensPrivacy',
  'changesToPolicy',
  'contactUs',
]

export default function Privacy(props: MarketingPageProps) {
  const { t } = useI18n()

  return (
    <MarketingLayout {...props}>
      <PageHero title={t('marketing.privacy.hero.title')} />
      <LegalDocument root="marketing.privacy" sections={SECTIONS} />
    </MarketingLayout>
  )
}
