import { usePage } from '@inertiajs/react'
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
 */
export function AddressBlock({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const { t } = useI18n()
  const { company } = usePage<{ company: CompanyContact | null }>().props

  if (company === null) {
    return null
  }

  const color = tone === 'dark' ? 'text-steel-100' : 'text-steel-700'

  const region = [company.city, company.state].filter(Boolean).join(', ')
  const line3 = [region, company.postalCode].filter(Boolean).join(' ')
  const country = company.country ? t(`marketing.company.countries.${company.country}`) : null

  return (
    <address className={`not-italic text-sm ${color}`}>
      {company.legalName ? <span className="block font-medium">{company.legalName}</span> : null}
      {company.line1 ? <span className="block">{company.line1}</span> : null}
      {company.line2 ? <span className="block">{company.line2}</span> : null}
      {line3 !== '' ? <span className="block">{line3}</span> : null}
      {country ? <span className="block">{country}</span> : null}

      {company.phone ? (
        <a href={`tel:${company.phone.replace(/[^+\d]/g, '')}`} className="mt-2 block hover:underline">
          {company.phone}
        </a>
      ) : null}
      {company.email ? (
        <a href={`mailto:${company.email}`} className="block hover:underline">
          {company.email}
        </a>
      ) : null}
    </address>
  )
}
