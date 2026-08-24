import { usePage } from '@inertiajs/react'
import { useI18n } from '@/lib/i18n'
import type { CompanyContact } from '@/types/marketing'

/**
 * El mapa de la oficina.
 *
 * La URL la construye el servidor a partir del domicilio (ver
 * App\Support\Company), así que una empresa cliente bajo su propio dominio ve
 * SU oficina sin que aquí haya que decidir nada.
 *
 * `loading="lazy"` no es una optimización de más: el marco lo sirve un tercero,
 * y así no se carga —ni se le da la IP del visitante— hasta que el mapa está a
 * punto de entrar en pantalla. Si eso sigue sobrando, `company.map.provider` en
 * la configuración vale 'none' y esto no pinta nada.
 */
export function OfficeMap() {
  const { t } = useI18n()
  const { company } = usePage<{ company: CompanyContact | null }>().props

  if (company === null || company.mapEmbedUrl === null) {
    return null
  }

  return (
    <iframe
      src={company.mapEmbedUrl}
      title={t('marketing.company.mapTitle')}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      className="h-56 w-full rounded border border-steel-200"
    />
  )
}
