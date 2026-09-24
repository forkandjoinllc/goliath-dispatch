import { router } from '@inertiajs/react'
import { useEffect, useState } from 'react'
import { SearchableSelect, type Choice } from '@/components/Form/SearchableSelect'
import { useI18n } from '@/lib/i18n'

export interface PeriodoDelTablero {
  key: string
  from: string
  to: string
  options: string[]
}

export interface FiltroDeTransportista {
  selected: string | null
  options: Choice[]
}

/**
 * Los dos filtros del tablero: el periodo y el transportista.
 *
 * ## Viajan en la URL, como todo lo demás de esta pantalla
 *
 * `?period=`, `?from=`, `?to=` y `?carrier=`. El tablero ya llevaba la
 * pestaña y la selección así, y por el mismo motivo: el enlace se pega en un
 * mensaje y abre lo mismo, el botón de atrás deshace el filtro, y el refresco
 * de cada minuto no lo pierde.
 *
 * ## El periodo que se enseña es el que SE ESTÁ USANDO
 *
 * Lo resuelve el servidor y vuelve resuelto. Un rango a medida del revés
 * —del 15 al 1— no se arregla por dentro: vuelve a «hoy», y el desplegable
 * dice «hoy». Un desplegable que dice «marzo» sobre una lista de hoy es peor
 * que uno que dice «hoy».
 */
export function BoardFilters({
  period,
  carrier,
  tab,
}: {
  period: PeriodoDelTablero
  carrier: FiltroDeTransportista
  tab: string
}) {
  const { t } = useI18n()
  const [aMedida, setAMedida] = useState(period.key === 'custom')
  const [desde, setDesde] = useState(period.from)
  const [hasta, setHasta] = useState(period.to)

  // Cuando el servidor devuelve otro periodo —porque se eligió uno con nombre,
  // o porque el de a medida no cuadraba— las dos cajas se ponen al día. Sin
  // esto seguían enseñando lo que se tecleó, que ya no es lo que se ve.
  useEffect(() => {
    setAMedida(period.key === 'custom')
    setDesde(period.from)
    setHasta(period.to)
  }, [period.key, period.from, period.to])

  const ir = (params: Record<string, string>) => {
    router.get('/home', { tab, ...params }, { preserveScroll: true, preserveState: true })
  }

  const elegir = (clave: string) => {
    if (clave === 'custom') {
      // Todavía no se pregunta nada al servidor: primero se eligen las dos
      // fechas. Ir ahora recargaría el tablero para enseñar lo mismo.
      setAMedida(true)

      return
    }

    setAMedida(false)
    ir({ period: clave, ...transportistaEn(carrier) })
  }

  const aplicar = () => {
    ir({ period: 'custom', from: desde, to: hasta, ...transportistaEn(carrier) })
  }

  const elegido = carrier.options.find((c) => c.id === carrier.selected) ?? null

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-steel-600">{t('board.filters.period')}</span>
        <select
          value={aMedida ? 'custom' : period.key}
          onChange={(e) => elegir(e.target.value)}
          className="rounded border border-steel-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-navy-800 outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
        >
          {period.options.map((clave) => (
            <option key={clave} value={clave}>
              {t(`board.filters.periods.${clave}`)}
            </option>
          ))}
        </select>
      </label>

      {aMedida ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-600">{t('common.labels.from')}</span>
            <input
              type="date"
              value={desde}
              max={hasta}
              onChange={(e) => setDesde(e.target.value)}
              className={CAJA_FECHA}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-600">{t('common.labels.to')}</span>
            <input
              type="date"
              value={hasta}
              min={desde}
              onChange={(e) => setHasta(e.target.value)}
              className={CAJA_FECHA}
            />
          </label>
          <button
            type="button"
            onClick={aplicar}
            className="rounded bg-navy-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-navy-800"
          >
            {t('common.actions.apply')}
          </button>
        </>
      ) : null}

      {/*
        El transportista, con buscador. Una empresa con cuarenta
        transportistas no recorre una lista: escribe tres letras. Es el mismo
        componente que usan las altas, y por el mismo motivo.
      */}
      {carrier.options.length === 0 ? null : (
        <div className="w-56">
          <SearchableSelect
            label={t('board.filters.carrier')}
            choices={carrier.options}
            selected={elegido}
            onPick={(id) => ir({ ...periodoEn(period), carrier: id })}
            onClear={() => ir({ ...periodoEn(period) })}
            emptyText={t('board.filters.noCarriers')}
            changeText={t('common.actions.change')}
            placeholder={t('board.filters.allCarriers')}
          />
        </div>
      )}
    </div>
  )
}

const CAJA_FECHA =
  'rounded border border-steel-300 bg-white px-2.5 py-1.5 text-xs text-carbon outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200'

/** El periodo que ya está puesto, para no perderlo al tocar el otro filtro. */
function periodoEn(period: PeriodoDelTablero): Record<string, string> {
  return period.key === 'custom'
    ? { period: 'custom', from: period.from, to: period.to }
    : { period: period.key }
}

/** Y al revés: el transportista, para no perderlo al cambiar el periodo. */
function transportistaEn(carrier: FiltroDeTransportista): Record<string, string> {
  return carrier.selected === null ? {} : { carrier: carrier.selected }
}
