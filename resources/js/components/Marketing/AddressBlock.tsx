import { usePage } from '@inertiajs/react'
import { ContactIcon } from '@/components/Marketing/ContactIcon'
import { useI18n } from '@/lib/i18n'
import type { CompanyContact } from '@/types/marketing'

/**
 * El domicilio de quien opera este sitio.
 *
 * Lo resuelve el servidor (ver App\Support\Company): bajo el dominio de una
 * empresa cliente son los datos de ESA empresa, y bajo goliathdispatch.com los
 * de la plataforma. Aquí no se decide nada — si llega null no se pinta nada, que
 * es lo correcto para un cliente que todavía no ha rellenado su domicilio.
 *
 * El nombre del país sale del diccionario y no de la fila: el sitio es bilingüe
 * y «United States» no se escribe igual en las dos versiones.
 *
 * Los iconos van a la izquierda, en columna, con el texto alineado a su derecha.
 * Es la disposición que deja leer los tres datos de un vistazo sin necesidad de
 * encabezados que repitan «Teléfono» y «Correo» — la forma del icono ya lo dice.
 */
export function AddressBlock({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const { t } = useI18n()
  const { company } = usePage<{ company: CompanyContact | null }>().props

  if (company === null) {
    return null
  }

  const color = tone === 'dark' ? 'text-steel-100' : 'text-steel-700'
  const iconColor = tone === 'dark' ? 'text-steel-300' : 'text-steel-500'

  const region = [company.city, company.state].filter(Boolean).join(', ')
  const line3 = [region, company.postalCode].filter(Boolean).join(' ')
  const country = company.country ? t(`marketing.company.countries.${company.country}`) : null

  return (
    <address className={`flex flex-col gap-3 not-italic text-sm ${color}`}>
      <div className="flex gap-2.5">
        <ContactIcon name="location" className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} />
        <span>
          {company.legalName ? <span className="block font-medium">{company.legalName}</span> : null}
          {company.line1 ? <span className="block">{company.line1}</span> : null}
          {company.line2 ? <span className="block">{company.line2}</span> : null}
          {line3 !== '' ? <span className="block">{line3}</span> : null}
          {country ? <span className="block">{country}</span> : null}

          {company.directionsUrl ? (
            <a
              href={company.directionsUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block font-medium hover:underline"
            >
              {t('marketing.company.directions')}
            </a>
          ) : null}
        </span>
      </div>

      {company.phone ? (
        <div className="flex gap-2.5">
          <ContactIcon name="phone" className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} />
          <a href={`tel:${company.phoneHref ?? company.phone}`} className="hover:underline">
            {company.phone}
          </a>
        </div>
      ) : null}

      {company.email ? (
        <div className="flex gap-2.5">
          <ContactIcon name="email" className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} />
          <a href={`mailto:${company.email}`} className="hover:underline">
            {company.email}
          </a>
        </div>
      ) : null}
    </address>
  )
}
