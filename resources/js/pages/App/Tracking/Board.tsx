import { Link } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Row {
  id: string
  number: string
  status: string
  carrierName: string | null
  plannedDeliveryOn: string | null
  lastCheckedAt: string | null
  lastLocation: string | null
  nextDueAt: string | null
  overdue: boolean
}

interface Props {
  loads: Row[]
  filters: { overdue: string }
  can: { manage: boolean }
}

/**
 * El tablero de lo que está rodando.
 *
 * No es la vista de flota del diccionario portado: aquella habla de sesiones de
 * GPS activas, y aquí todavía no hay ninguna. Esta contesta la misma pregunta
 * con lo que sí existe — cuándo habló alguien con el conductor por última vez —
 * y lo dice en la propia pantalla para que nadie confunda una cosa con la otra.
 */
export default function TrackingBoard({ loads, filters }: Props) {
  const { t } = useI18n()
  const soloAtrasadas = filters.overdue === '1'

  return (
    <AppLayout
      title={t('tracking.board.title')}
      description={t('tracking.board.subtitle')}
      crumbs={[{ label: t('tracking.board.title') }]}
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-steel-600">{t('tracking.board.noGpsNote')}</p>

        <div className="flex rounded border border-steel-300 self-start">
          <Filtro activo={!soloAtrasadas} href="/tracking">{t('tracking.board.all')}</Filtro>
          <Filtro activo={soloAtrasadas} href="/tracking?overdue=1">
            {t('tracking.board.onlyOverdue')}
          </Filtro>
        </div>

        <div className="overflow-x-auto rounded border border-steel-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-steel-50 text-xs uppercase tracking-wide text-steel-600">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t('tracking.board.loadColumn')}</th>
                <th className="px-4 py-2.5 font-medium">{t('tracking.board.carrierColumn')}</th>
                <th className="px-4 py-2.5 font-medium">{t('tracking.board.statusColumn')}</th>
                <th className="px-4 py-2.5 font-medium">{t('tracking.board.lastCheckColumn')}</th>
                <th className="px-4 py-2.5 font-medium">{t('tracking.board.nextCheckColumn')}</th>
                <th className="px-4 py-2.5 font-medium">{t('tracking.board.deliveryColumn')}</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {loads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-steel-600">
                    {t('tracking.board.empty')}
                  </td>
                </tr>
              ) : null}

              {loads.map((l) => (
                <tr key={l.id} className={`border-t border-steel-100 ${l.overdue ? 'bg-warning-50' : ''}`}>
                  <td className="px-4 py-2.5">
                    <Link href={`/loads/${l.id}/tracking`} className="font-medium text-navy-700 underline">
                      {l.number}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-steel-700">{l.carrierName ?? '—'}</td>
                  <td className="px-4 py-2.5">{t(`tracking.status.${l.status}`)}</td>
                  <td className="px-4 py-2.5">
                    {l.lastCheckedAt ? (
                      <>
                        <span className="tabular-nums text-steel-700">{l.lastCheckedAt}</span>
                        {l.lastLocation ? (
                          <p className="text-xs text-steel-600">{l.lastLocation}</p>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-steel-500">{t('tracking.board.never')}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {l.nextDueAt ? (
                      <span className={l.overdue ? 'font-medium text-warning-800' : 'tabular-nums text-steel-700'}>
                        {l.nextDueAt}
                        {l.overdue ? ` · ${t('tracking.board.overdue')}` : ''}
                      </span>
                    ) : (
                      <span className="text-steel-500">{t('tracking.board.noneScheduled')}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-steel-700">
                    {l.plannedDeliveryOn ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/loads/${l.id}/tracking`} className="text-navy-700 underline">
                      {t('tracking.board.view')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  )
}

function Filtro({ activo, href, children }: { activo: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      preserveScroll
      className={`px-3 py-1.5 text-sm transition ${
        activo ? 'bg-navy-700 font-semibold text-white' : 'text-navy-700 hover:bg-navy-50'
      }`}
    >
      {children}
    </Link>
  )
}
