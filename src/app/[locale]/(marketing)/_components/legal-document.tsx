import { AlertCircle } from 'lucide-react'
import type { TranslateFn } from '@/i18n/translate'

/**
 * Shared rendering for Privacy Policy / Terms and Conditions: a "last
 * updated" line, a visible counsel-review note, and numbered sections. Both
 * pages pass their own section-key list and `namespace` (`privacy` / `terms`)
 * so the copy lives entirely in `marketing.json`.
 */
export function LegalDocument({
  t,
  namespace,
  sectionKeys,
  lastUpdated,
}: {
  t: TranslateFn
  namespace: 'privacy' | 'terms'
  sectionKeys: readonly string[]
  lastUpdated: string
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-sm text-steel-600">{t(`marketing.${namespace}.hero.lastUpdated`, { date: lastUpdated })}</p>
      <div className="mt-4 flex gap-3 rounded-lg border border-info-500/30 bg-info-50 p-4 text-sm text-info-700">
        <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <p>{t(`marketing.${namespace}.hero.counselNote`)}</p>
      </div>

      <div className="mt-10 space-y-10">
        {sectionKeys.map((key, index) => (
          <section key={key} aria-labelledby={`${namespace}-${key}`}>
            <h2 id={`${namespace}-${key}`} className="text-xl font-bold tracking-tight">
              {index + 1}. {t(`marketing.${namespace}.sections.${key}.title`)}
            </h2>
            <p className="mt-3 text-steel-700">{t(`marketing.${namespace}.sections.${key}.body`)}</p>
          </section>
        ))}
      </div>
    </div>
  )
}
