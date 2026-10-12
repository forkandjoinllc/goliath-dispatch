import { router } from '@inertiajs/react'
import { useEffect, useState } from 'react'
import { SearchableSelect, type Choice } from '@/components/Form/SearchableSelect'
import { useI18n } from '@/lib/i18n'
import { useMenu } from '@/lib/useMenu'

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

export interface FiltroDeEstado {
  /** Vacío quiere decir «todos». */
  selected: string[]
  options: string[]
}

export interface FiltroDeEstadoDeConductor extends FiltroDeEstado {
  /** Cuántos conductores deja fuera este filtro ahora mismo. */
  hidden: number
  /**
   * Si lo elegido es el reparto de siempre.
   *
   * Lo dice el servidor porque es él quien lo decide. Sin esto el botón leería
   * «4 estados» en cuanto se abre el tablero, que es cierto y no dice nada.
   */
  isDefault: boolean
}

/**
 * Los cuatro filtros del tablero: periodo, transportista, estado de la carga y
 * estado del conductor.
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
 *
 * Lo mismo vale para los dos filtros por estado: lo que se pinta marcado es lo
 * que el servidor dice que está usando. Quien desmarque todos los estados de
 * conductor ve volver el reparto por defecto, porque una columna de conductores
 * vacía no contesta nada.
 *
 * ## Cada control manda TODOS los filtros
 *
 * Y no el suyo más el que recuerde. Con dos filtros había dos ayudas —«el
 * periodo que ya está puesto» y «el transportista que ya está puesto»— para que
 * tocar uno no borrara el otro. Con cuatro harían falta doce, y la que faltara
 * sería la que borra un filtro al tocar otro. `todos()` devuelve los cuatro, y
 * cada control sobrescribe el suyo encima.
 */
export function BoardFilters({
  period,
  carrier,
  loadStatus,
  driverStatus,
  tab,
}: {
  period: PeriodoDelTablero
  carrier: FiltroDeTransportista
  loadStatus: FiltroDeEstado
  driverStatus: FiltroDeEstadoDeConductor
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

  /** Los cuatro filtros tal como están ahora. */
  const todos = (): Record<string, string> => ({
    ...(period.key === 'custom'
      ? { period: 'custom', from: period.from, to: period.to }
      : { period: period.key }),
    ...(carrier.selected === null ? {} : { carrier: carrier.selected }),
    ...(loadStatus.selected.length === 0 ? {} : { status: loadStatus.selected.join(',') }),
    ...(driverStatus.selected.length === 0 ? {} : { driverStatus: driverStatus.selected.join(',') }),
  })

  const ir = (params: Record<string, string>) => {
    router.get('/home', { tab, ...todos(), ...params }, { preserveScroll: true, preserveState: true })
  }

  /*
   * Marcar o desmarcar un estado.
   *
   * Se manda la lista entera y no «quita este»: el servidor no guarda nada
   * entre peticiones, así que la URL es el estado completo. Vacío se manda
   * como cadena vacía y no se omite — omitirlo dejaría puesto lo que `todos()`
   * acaba de poner, y desmarcar el último estado no haría nada.
   */
  const alternar = (filtro: FiltroDeEstado, clave: string, estado: string): void => {
    const puestos = filtro.selected.includes(estado)
      ? filtro.selected.filter((v) => v !== estado)
      : filtro.options.filter((v) => filtro.selected.includes(v) || v === estado)

    ir({ [clave]: puestos.join(',') })
  }

  const elegir = (clave: string) => {
    if (clave === 'custom') {
      // Todavía no se pregunta nada al servidor: primero se eligen las dos
      // fechas. Ir ahora recargaría el tablero para enseñar lo mismo.
      setAMedida(true)

      return
    }

    setAMedida(false)
    ir({ period: clave, from: '', to: '' })
  }

  const aplicar = () => {
    ir({ period: 'custom', from: desde, to: hasta })
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
            onPick={(id) => ir({ carrier: id })}
            onClear={() => ir({ carrier: '' })}
            emptyText={t('board.filters.noCarriers')}
            changeText={t('common.actions.change')}
            placeholder={t('board.filters.allCarriers')}
          />
        </div>
      )}

      <EstadosElegibles
        etiqueta={t('board.filters.loadStatus')}
        todos={t('board.filters.allLoadStatuses')}
        prefijo="nav.status.load"
        enCamello
        filtro={loadStatus}
        onAlternar={(estado) => { alternar(loadStatus, 'status', estado) }}
        onLimpiar={() => { ir({ status: '' }) }}
      />

      <EstadosElegibles
        etiqueta={t('board.filters.driverStatus')}
        todos={t('board.filters.workingDrivers')}
        prefijo="drivers.status"
        filtro={driverStatus}
        onAlternar={(estado) => { alternar(driverStatus, 'driverStatus', estado) }}
        onLimpiar={() => { ir({ driverStatus: '' }) }}
        escondidos={driverStatus.hidden}
        esPorDefecto={driverStatus.isDefault}
      />
    </div>
  )
}

/**
 * Un desplegable de casillas: varios estados a la vez.
 *
 * En despacho se mira «en tránsito» y «en entrega» juntas, o «disponible» y
 * «en carga»: son una sola pregunta, y un desplegable de uno solo obliga a
 * mirar dos veces.
 *
 * Las opciones vienen del servidor. Escritas aquí, el día que se añada un
 * estado el filtro no lo ofrecería y las cargas de ese estado desaparecerían
 * del tablero en cuanto alguien tocara el filtro.
 */
function EstadosElegibles({
  etiqueta,
  todos,
  prefijo,
  enCamello = false,
  filtro,
  onAlternar,
  onLimpiar,
  escondidos,
  esPorDefecto,
}: {
  etiqueta: string
  /** Lo que se lee en el botón cuando lo elegido es lo de siempre. */
  todos: string
  /** De dónde salen los nombres: `nav.status.load` o `drivers.status`. */
  prefijo: string
  /**
   * Si ese diccionario escribe las claves en camello.
   *
   * Los dos no lo hacen igual: `nav.status.load` dice `enRouteToPickup` y
   * `drivers.status` dice `on_load`. No es un descuido —`UnnamedValuesTest`
   * lleva declarado cuál es cuál— así que se pregunta en vez de adivinarlo.
   * Convertir siempre a camello pintaba la clave cruda en los seis estados de
   * conductor.
   */
  enCamello?: boolean
  filtro: FiltroDeEstado
  onAlternar: (estado: string) => void
  onLimpiar: () => void
  /** Solo en conductores: cuántos deja fuera el filtro ahora mismo. */
  escondidos?: number
  /** Solo en conductores: si lo elegido es el reparto de siempre. */
  esPorDefecto?: boolean
}) {
  const { t } = useI18n()
  const { open, setOpen, container, trigger } = useMenu()

  const nombre = (estado: string): string => t(`${prefijo}.${enCamello ? camello(estado) : estado}`)

  const resumen =
    filtro.selected.length === 0 || esPorDefecto === true
      ? todos
      : filtro.selected.length === 1
        ? nombre(filtro.selected[0] ?? '')
        : t('board.filters.statusCount', { n: filtro.selected.length })

  return (
    <div className="relative flex flex-col gap-1" ref={container}>
      <span className="text-xs font-medium text-steel-600">{etiqueta}</span>
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
        className="flex min-w-44 items-center justify-between gap-2 rounded border border-steel-300 bg-white px-2.5 py-1.5 text-left text-xs font-semibold text-navy-800 outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
      >
        <span className="truncate">{resumen}</span>
        <span aria-hidden="true" className="text-steel-500">▾</span>
      </button>

      {/* Cuántos se quedan fuera. Un conductor que falta de la lista sin
          explicación se busca durante un rato. */}
      {escondidos === undefined || escondidos === 0 ? null : (
        <span className="absolute -bottom-4 left-0 whitespace-nowrap text-[11px] text-steel-500">
          {t('board.filters.driversHidden', { n: escondidos })}
        </span>
      )}

      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-72 min-w-56 overflow-y-auto rounded border border-steel-200 bg-white py-1 shadow-lg">
          {filtro.options.map((estado) => (
            <label
              key={estado}
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-carbon transition hover:bg-steel-50"
            >
              <input
                type="checkbox"
                checked={filtro.selected.includes(estado)}
                onChange={() => { onAlternar(estado) }}
                className="h-3.5 w-3.5 rounded border-steel-400 text-navy-700 focus:ring-navy-200"
              />
              {nombre(estado)}
            </label>
          ))}
          <button
            type="button"
            onClick={() => { onLimpiar() }}
            className="mt-1 w-full border-t border-steel-100 px-3 pb-0.5 pt-2 text-left text-xs font-medium text-navy-700 transition hover:bg-navy-50"
          >
            {todos}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** `on_load` → `onLoad`, que es la clave del diccionario. */
function camello(valor: string): string {
  return valor.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

const CAJA_FECHA =
  'rounded border border-steel-300 bg-white px-2.5 py-1.5 text-xs text-carbon outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200'
