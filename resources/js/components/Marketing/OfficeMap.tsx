import { usePage } from '@inertiajs/react'
import { useState } from 'react'
import { useI18n } from '@/lib/i18n'
import type { CompanyContact } from '@/types/marketing'

/**
 * El mapa de la oficina, que NO se carga hasta que alguien lo pide.
 *
 * La URL la construye el servidor a partir del domicilio (ver
 * App\Support\Company), así que una empresa cliente bajo su propio dominio ve
 * SU oficina sin que aquí haya que decidir nada.
 *
 * POR QUÉ HAY QUE PULSAR
 *
 * El marco lo sirve Google. En cuanto se carga, Google recibe la IP del
 * visitante, su navegador y la página desde la que viene — haya interactuado o
 * no con el mapa. Con `loading="lazy"` eso pasaba al hacer scroll hasta aquí,
 * que en la práctica es «a casi todo el que abra la página de contacto».
 *
 * Cargarlo solo al pulsar cambia quién decide. Quien quiere ver el mapa lo pide
 * y lo ve; quien solo venía a leer un teléfono no le entrega su IP a un tercero
 * sin enterarse. La política de privacidad ya declara «mapas y rutas» entre los
 * subencargados, así que esto no tapa un hueco legal: reduce cuánta gente entra
 * en ese supuesto, que es cosa distinta y más barata que una consulta jurídica.
 *
 * Esto es criterio de ingeniería, no asesoramiento legal.
 *
 * Si el mapa sobra del todo, `company.map.provider` en la configuración vale
 * 'none' y esto no pinta nada.
 */
export function OfficeMap() {
  const { t } = useI18n()
  const { company } = usePage<{ company: CompanyContact | null }>().props
  const [cargar, setCargar] = useState(false)

  if (company === null || company.mapEmbedUrl === null) {
    return null
  }

  if (! cargar) {
    return (
      <div className="flex h-56 w-full flex-col items-center justify-center gap-3 rounded border border-dashed border-steel-300 bg-steel-50 px-4 text-center">
        <p className="text-sm text-steel-700">{t('marketing.company.mapConsent')}</p>

        <button
          type="button"
          onClick={() => setCargar(true)}
          className="rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800"
        >
          {t('marketing.company.mapLoad')}
        </button>

        {/* Siempre hay una salida que no pasa por el tercero: la dirección ya
            está escrita encima, y este enlace abre el mapa en su sitio, con
            la decisión tomada a la vista. */}
        {company.directionsUrl ? (
          <a
            href={company.directionsUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-xs font-medium text-navy-700 underline"
          >
            {t('marketing.company.mapOpenExternal')}
          </a>
        ) : null}
      </div>
    )
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
