import { useI18n } from '@/lib/i18n'

/**
 * Privacidad y Términos comparten forma: encabezado con fecha, un aviso de que
 * el texto no es asesoramiento legal, y N secciones numeradas.
 *
 * El aviso de revisión por abogado NO es decorativo y no se quita: el sistema
 * incluye firma electrónica y consentimiento de rastreo por GPS, y en ningún
 * sitio se afirma que la implementación técnica baste para la validez legal.
 */
export function LegalDocument({ root, sections }: { root: string; sections: string[] }) {
  const { t } = useI18n()

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <p className="text-sm text-steel-600">{t(`${root}.hero.lastUpdated`)}</p>

      <div className="mt-6 rounded border-l-4 border-safety-500 bg-safety-50 p-4">
        <p className="text-sm text-carbon">{t(`${root}.hero.counselNote`)}</p>
      </div>

      <div className="mt-12 flex flex-col gap-10">
        {sections.map((section, index) => (
          <section key={section} id={section}>
            <h2 className="font-display text-xl font-bold text-navy-700">
              <span className="text-steel-500">{index + 1}.</span>{' '}
              {t(`${root}.sections.${section}.title`)}
            </h2>
            <p className="mt-3 whitespace-pre-line text-steel-700">
              {t(`${root}.sections.${section}.body`)}
            </p>
          </section>
        ))}
      </div>
    </div>
  )
}
