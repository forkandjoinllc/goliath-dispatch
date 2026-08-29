import { Link } from '@inertiajs/react'
import { useI18n } from '@/lib/i18n'

export interface PageMeta {
  total: number
  perPage: number
  currentPage: number
  lastPage: number
}

/**
 * Los números de página de una lista paginada.
 *
 * Existe porque cuatro pantallas de dinero —facturas, cobros, gastos y
 * liquidaciones— paginaban de treinta en treinta en el servidor y no pintaban
 * ni un enlace: la página dos no se podía alcanzar de ninguna manera desde la
 * interfaz. La factura número treinta y uno era invisible.
 *
 * Las páginas se enumeran enteras y no con «anterior/siguiente» porque el
 * servidor ya devuelve `lastPage`: teniendo el total, esconderlo detrás de dos
 * flechas obliga a paginar a ciegas.
 */
export function Pager({
  meta,
  path,
  params = {},
}: {
  meta: PageMeta
  /** Ruta absoluta de la lista, sin parámetros. Por ejemplo `/invoices`. */
  path: string
  /** Filtros vigentes, que hay que conservar al cambiar de página. */
  params?: Record<string, string | number | null | undefined>
}) {
  const { t } = useI18n()

  const from = meta.total === 0 ? 0 : (meta.currentPage - 1) * meta.perPage + 1
  const to = Math.min(meta.currentPage * meta.perPage, meta.total)

  // Los filtros vacíos se caen de la URL: arrastrarlos como `status=` deja una
  // dirección que no se puede compartir sin explicarla.
  const limpios = Object.fromEntries(
    Object.entries(params)
      .filter(([, v]) => v !== '' && v !== null && v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  )

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-steel-700">
      <p>{t('common.pager.showing', { from, to, total: meta.total })}</p>

      {meta.lastPage > 1 ? (
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: meta.lastPage }, (_, i) => i + 1).map((n) => (
            <Link
              key={n}
              href={`${path}?${new URLSearchParams({ ...limpios, page: String(n) })}`}
              aria-current={n === meta.currentPage ? 'page' : undefined}
              preserveScroll
              className={`rounded px-3 py-1.5 transition ${
                n === meta.currentPage
                  ? 'bg-navy-700 font-semibold text-white'
                  : 'border border-steel-300 hover:bg-navy-50'
              }`}
            >
              {n}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}
