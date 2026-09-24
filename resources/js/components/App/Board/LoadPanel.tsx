import { Link, router, useForm } from '@inertiajs/react'
import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/App/Modal'
import { StatusBadge } from '@/components/App/StatusBadge'
import { Avatar } from '@/components/App/Board/Avatar'
import { Timeline, type Suceso } from '@/components/App/Board/Timeline'
import { boardHref, type FiltrosDelTablero } from '@/components/App/Board/href'
import { TextField } from '@/components/Form/Field'
import { SearchableSelect, type Choice } from '@/components/Form/SearchableSelect'
import { useI18n } from '@/lib/i18n'

export interface ParadaDelPanel {
  id: string
  type: string
  sequence: number
  name: string | null
  line1: string | null
  city: string | null
  state: string | null
  at: string | null
  zone: string
  arrived: string | null
}

/**
 * Una parada TAL Y COMO vuelve al servidor.
 *
 * Están todas las columnas que `syncStops` escribe, no solo las tres que la
 * ventana enseña: lo que no vuelva se pierde. Escritas una a una y no con una
 * firma de índice porque el formulario de Inertia necesita saber qué hay
 * dentro, y porque una firma de índice deja pasar el campo mal escrito que
 * luego llega vacío.
 */
interface ParadaDelFormulario {
  id: string
  stop_type: string
  facility_name: string | null
  customer_location_id: string | null
  line1: string | null
  city: string | null
  state: string | null
  country: string | null
  postal_code: string | null
  timezone: string | null
  appointment_type: string | null
  window_start: string | null
  window_end: string | null
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  instructions: string | null
  confirmation_number: string | null
  /**
   * El sitio del cliente al que apunta la parada. SOLO para enseñarlo: se
   * quita antes de mandar el formulario. Ver `BoardController::paradasParaEditar`.
   */
  locationName: string | null
}

/** El formulario de edición entero. Ver `BoardController::edicionDe`. */
export interface EdicionDeCarga {
  customer_id: string
  customer_reference: string | null
  po_number: string | null
  commodity: string | null
  weight_pounds: number | null
  piece_count: number | null
  length_inches: number | null
  width_inches: number | null
  height_inches: number | null
  required_equipment_type_id: string | null
  is_oversize: boolean
  is_overweight: boolean
  miles: number | null
  deadhead_miles: number | null
  special_instructions: string | null
  internal_notes: string | null
  stops: ParadaDelFormulario[]
  /** Solo si quien mira puede tocar dinero. */
  carrier_dispatch_fee_bps?: number
  dispatcher_commission_bps?: number
}

export interface CargaElegida {
  id: string
  loadNumber: string
  status: string
  commodity: string | null
  reference: string | null
  weightPounds: number | null
  driver: { id: string; firstName: string; lastName: string } | null
  truck: string | null
  trailer: string | null
  stops: ParadaDelPanel[]
  customer: {
    id: string
    name: string
    email: string | null
    phone: string | null
    termsDays: number | null
    status: string | null
    contact: string | null
  } | null
  history: Suceso[]
  edit: EdicionDeCarga | null
  can: { update: boolean; assign: boolean; cancel: boolean }
}

type Pestana = 'detail' | 'customer' | 'history'

/**
 * La carga abierta, en el mismo sitio donde estaba su tarjeta.
 *
 * ## Por qué aquí y no en otra pantalla
 *
 * Mirar una carga sin soltar el mapa es la mitad del trabajo de despachar: se
 * abre, se mira dónde va, se mira quién está cerca, se cierra. Mandar a
 * `/loads/{id}` a cada clic obliga a volver, y al volver el tablero está en la
 * primera pestaña y el mapa en el encuadre inicial.
 *
 * Es un RESUMEN, y lo dice: abajo hay un enlace a la ficha entera. Lo que cabe
 * aquí es lo que se mira de pie.
 *
 * ## Las tres acciones
 *
 * Quién puede hacer cada una lo decidió el servidor, en `can`. Un menú que
 * ofrece lo que luego devuelve 403 al pulsar es peor que un menú corto: hace
 * creer que se puede y solo se descubre que no después de intentarlo.
 *
 * Reasignar conductor lleva a la ficha, y eso es a propósito: asignar de verdad
 * comprueba licencias, tarjetas médicas, inspecciones y solapes de agenda, y
 * los enseña uno a uno. Una ventanita con una lista de nombres sin esa
 * comprobación ofrecería conductores que el servidor va a rechazar.
 */
export function LoadPanel({
  carga,
  customers,
  filtros,
}: {
  carga: CargaElegida
  customers: Choice[]
  filtros: FiltrosDelTablero
}) {
  const { t } = useI18n()
  const [pestana, setPestana] = useState<Pestana>('detail')
  const [editando, setEditando] = useState(false)
  const [cancelando, setCancelando] = useState(false)

  // Al cambiar de carga, se vuelve a Detalle: dejar abierto «Historial» hace
  // que la siguiente carga se abra por donde nadie la pidió.
  useEffect(() => { setPestana('detail') }, [carga.id])

  return (
    <div className="flex flex-col gap-3 rounded border border-navy-300 bg-white p-3.5 shadow-sm">
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <p className="font-semibold tabular-nums text-navy-800">{carga.loadNumber}</p>
          <p className="mt-0.5">
            <StatusBadge family="load" value={carga.status} />
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Kebab
            carga={carga}
            onEdit={() => setEditando(true)}
            onCancel={() => setCancelando(true)}
          />
          <Link
            href={boardHref(filtros)}
            preserveScroll
            aria-label={t('common.actions.close')}
            className="rounded px-2 py-1 text-lg leading-none text-steel-600 transition hover:bg-steel-100 hover:text-carbon"
          >
            <span aria-hidden="true">×</span>
          </Link>
        </div>
      </div>

      <div className="flex gap-1 border-b border-steel-200" role="tablist">
        {(['detail', 'customer', 'history'] as Pestana[]).map((clave) => (
          <button
            key={clave}
            type="button"
            role="tab"
            aria-selected={pestana === clave}
            onClick={() => setPestana(clave)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-semibold transition ${
              pestana === clave
                ? 'border-safety-600 text-navy-800'
                : 'border-transparent text-steel-600 hover:text-navy-700'
            }`}
          >
            {t(`board.panel.tabs.${clave}`)}
          </button>
        ))}
      </div>

      {pestana === 'detail' ? <Detalle carga={carga} filtros={filtros} /> : null}
      {pestana === 'customer' ? <Cliente carga={carga} /> : null}
      {pestana === 'history' ? (
        <Timeline sucesos={carga.history} vacio={t('board.panel.history.empty')} filtros={filtros} />
      ) : null}

      <Link
        href={`/loads/${carga.id}`}
        className="mt-1 text-xs font-semibold text-navy-700 underline-offset-2 hover:underline"
      >
        {t('board.panel.openFull')}
      </Link>

      {carga.edit === null ? null : (
        <EditarCarga
          open={editando}
          onClose={() => setEditando(false)}
          carga={carga}
          customers={customers}
        />
      )}

      <CancelarCarga open={cancelando} onClose={() => setCancelando(false)} carga={carga} />
    </div>
  )
}

/** El menú de los tres puntos. */
function Kebab({
  carga,
  onEdit,
  onCancel,
}: {
  carga: CargaElegida
  onEdit: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (! abierto) return

    const fuera = (e: MouseEvent) => {
      if (caja.current !== null && ! caja.current.contains(e.target as Node)) setAbierto(false)
    }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }

    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', escape)

    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', escape)
    }
  }, [abierto])

  // Sin ninguna de las tres no hay menú. Un botón que abre una lista vacía es
  // una promesa de que hay algo detrás.
  if (! carga.can.update && ! carga.can.assign && ! carga.can.cancel) return null

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => ! v)}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label={t('board.panel.actions')}
        className="rounded px-2 py-1 text-lg leading-none text-steel-600 transition hover:bg-steel-100 hover:text-carbon"
      >
        <span aria-hidden="true">⋯</span>
      </button>

      {abierto ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded border border-steel-300 bg-white py-1 shadow-lg"
        >
          {carga.can.update && carga.edit !== null ? (
            <ItemMenu onClick={() => { setAbierto(false); onEdit() }}>
              {t('board.panel.menu.edit')}
            </ItemMenu>
          ) : null}

          {carga.can.assign ? (
            <Link
              role="menuitem"
              href={`/loads/${carga.id}#assign`}
              onClick={() => setAbierto(false)}
              className={ITEM_CLASS}
            >
              {t('board.panel.menu.reassign')}
            </Link>
          ) : null}

          {carga.can.cancel ? (
            <ItemMenu onClick={() => { setAbierto(false); onCancel() }} peligro>
              {t('board.panel.menu.cancel')}
            </ItemMenu>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const ITEM_CLASS = 'block w-full px-3 py-2 text-left text-sm text-carbon transition hover:bg-navy-50'

function ItemMenu({
  onClick,
  children,
  peligro = false,
}: {
  onClick: () => void
  children: string
  peligro?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`${ITEM_CLASS} ${peligro ? 'text-safety-700' : ''}`}
    >
      {children}
    </button>
  )
}

function Detalle({ carga, filtros }: { carga: CargaElegida; filtros: FiltrosDelTablero }) {
  const { t, locale } = useI18n()
  const equipo = [carga.truck, carga.trailer].filter((v) => v !== null && v !== '')

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        {carga.driver === null ? (
          <span className="text-sm text-steel-600">{t('board.loads.noDriver')}</span>
        ) : (
          <>
            <Avatar
              id={carga.driver.id}
              firstName={carga.driver.firstName}
              lastName={carga.driver.lastName}
            />
            <span className="min-w-0">
              <Link
                href={boardHref(filtros, { driver: carga.driver.id })}
                preserveScroll
                className="block truncate text-sm font-medium text-navy-800 hover:underline"
              >
                {carga.driver.firstName} {carga.driver.lastName}
              </Link>
              <span className="block truncate text-xs tabular-nums text-steel-600">
                {equipo.length === 0 ? t('board.loads.noEquipment') : equipo.join(' · ')}
              </span>
            </span>
          </>
        )}
      </div>

      <Datos
        filas={[
          [t('board.panel.detail.commodity'), carga.commodity],
          [t('board.panel.detail.reference'), carga.reference],
          [
            t('board.panel.detail.weight'),
            carga.weightPounds === null
              ? null
              : t('board.panel.detail.pounds', { n: carga.weightPounds.toLocaleString() }),
          ],
        ]}
      />

      <ol className="flex flex-col gap-2">
        {carga.stops.map((parada) => (
          <li key={parada.id} className="rounded border border-steel-200 p-2.5">
            <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span
                className={`rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide ${
                  parada.type === 'pickup'
                    ? 'bg-safety-100 text-safety-800'
                    : 'bg-navy-100 text-navy-800'
                }`}
              >
                {t(`board.stop.${parada.type}`)}
              </span>
              <span className="tabular-nums text-steel-700">
                {parada.at === null
                  ? t('board.loads.noDate')
                  : `${fecha(parada.at, locale)} · ${parada.zone}`}
              </span>
            </p>
            <p className="mt-1 text-sm text-carbon">
              {parada.name ?? t('board.panel.detail.noFacility')}
            </p>
            {parada.city === null ? null : (
              <p className="text-xs text-steel-600">
                {parada.city}
                {parada.state === null ? '' : `, ${parada.state}`}
              </p>
            )}
            {/* Llegó de verdad, que no es lo mismo que «iba a las ocho». */}
            {parada.arrived === null ? null : (
              <p className="mt-1 text-xs font-medium text-navy-700">
                {t('board.panel.detail.arrived', { time: fecha(parada.arrived, locale) })}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

function Cliente({ carga }: { carga: CargaElegida }) {
  const { t } = useI18n()

  if (carga.customer === null) {
    return <p className="text-sm text-steel-600">{t('board.loads.noCustomer')}</p>
  }

  const c = carga.customer

  return (
    <div className="flex flex-col gap-3">
      <Link
        href={`/customers/${c.id}`}
        className="text-sm font-semibold text-navy-800 hover:underline"
      >
        {c.name}
      </Link>

      <Datos
        filas={[
          [t('board.panel.customer.contact'), c.contact],
          [t('common.labels.phone'), c.phone],
          [t('common.labels.email'), c.email],
          [
            t('board.panel.customer.terms'),
            c.termsDays === null ? null : t('board.panel.customer.days', { n: c.termsDays }),
          ],
        ]}
      />
    </div>
  )
}

/** Una tabla de dos columnas. Lo que no hay se DICE, no se esconde. */
function Datos({ filas }: { filas: [string, string | null][] }) {
  const { t } = useI18n()

  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
      {filas.map(([clave, valor]) => (
        <div key={clave} className="contents">
          <dt className="text-steel-600">{clave}</dt>
          <dd className={valor === null || valor === '' ? 'text-steel-500' : 'text-carbon'}>
            {valor === null || valor === '' ? t('common.labels.none') : valor}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function fecha(at: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(at.replace(' ', 'T')))
}

/**
 * La ventana de edición.
 *
 * Enseña cuatro campos y MANDA la carga entera. No es una redundancia: el
 * guardado reemplaza las paradas por las que recibe y escribe cada columna con
 * lo que venga, así que lo que la ventana no devuelva se pierde. Ver
 * `BoardController::edicionDe`.
 */
function EditarCarga({
  open,
  onClose,
  carga,
  customers,
}: {
  open: boolean
  onClose: () => void
  carga: CargaElegida
  customers: Choice[]
}) {
  const { t } = useI18n()
  const { data, setData, patch, transform, processing, errors, clearErrors } = useForm<EdicionDeCarga>(
    () => ({ ...carga.edit! }),
  )

  const paradas = data.stops
  const cliente = customers.find((c) => c.id === data.customer_id) ?? null

  const cerrar = () => {
    clearErrors()
    onClose()
  }

  const parada = (i: number, campo: 'city' | 'state' | 'window_start', valor: string) => {
    setData(
      'stops',
      paradas.map((s, j) => (i === j ? { ...s, [campo]: valor } : s)),
    )
  }

  return (
    <Modal
      open={open}
      title={t('board.panel.edit.title', { number: carga.loadNumber })}
      onClose={cerrar}
      closeLabel={t('common.actions.close')}
      footer={
        <>
          <button type="button" onClick={cerrar} className={BOTON_SECUNDARIO}>
            {t('common.actions.cancel')}
          </button>
          <button type="submit" form="edit-load" disabled={processing} className={BOTON_PRIMARIO}>
            {t('common.actions.save')}
          </button>
        </>
      }
    >
      <form
        id="edit-load"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          // `locationName` no viaja: es un rótulo, no un campo. Mandarlo
          // metería una clave que ninguna regla valida en el mismo array que
          // `syncStops` recorre.
          transform((datos) => ({
            ...datos,
            stops: datos.stops.map(({ locationName: _, ...resto }) => resto),
          }))
          patch(`/loads/${carga.id}`, { preserveScroll: true, onSuccess: onClose })
        }}
      >
        <SearchableSelect
          label={t('board.quick.load.customer')}
          required
          choices={customers}
          selected={cliente}
          onPick={(id) => setData('customer_id', id)}
          onClear={() => setData('customer_id', '')}
          emptyText={t('board.quick.load.noCustomers')}
          changeText={t('common.actions.change')}
          error={errors.customer_id}
        />

        <TextField
          label={t('board.quick.load.commodity')}
          value={data.commodity ?? ''}
          maxLength={200}
          onChange={(e) => setData('commodity', e.target.value)}
          error={errors.commodity}
        />

        <TextField
          label={t('board.panel.detail.reference')}
          value={data.customer_reference ?? ''}
          maxLength={80}
          onChange={(e) => setData('customer_reference', e.target.value)}
          error={errors.customer_reference}
        />

        {paradas.map((s, i) => (
          <fieldset key={s.id} className="flex flex-col gap-3 rounded border border-steel-200 p-3">
            <legend className="px-1 text-xs font-bold uppercase tracking-[0.1em] text-safety-600">
              {t(`board.stop.${s.stop_type}`)} {i + 1}
            </legend>

            {/*
              Una parada que apunta a una instalación del cliente NO tiene
              ciudad propia: la dirección vive en `customer_locations` y estas
              dos casillas estarían en blanco sin mandar en nada de lo que se
              ve. Se enseña el sitio y se dice dónde se cambia.
            */}
            {s.locationName === null ? (
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem]">
                <TextField
                  label={t('common.labels.city')}
                  value={s.city ?? ''}
                  maxLength={120}
                  onChange={(e) => parada(i, 'city', e.target.value)}
                  error={errorDeParada(errors, i, 'city')}
                />
                <TextField
                  label={t('common.labels.state')}
                  value={s.state ?? ''}
                  maxLength={3}
                  onChange={(e) => parada(i, 'state', e.target.value.toUpperCase())}
                  error={errorDeParada(errors, i, 'state')}
                />
              </div>
            ) : (
              <div className="rounded bg-navy-50 p-2.5">
                <p className="text-sm font-medium text-carbon">{s.locationName}</p>
                <p className="mt-0.5 text-xs text-steel-600">
                  {t('board.panel.edit.fromLocation')}
                </p>
              </div>
            )}

            <TextField
              type="datetime-local"
              label={t('board.quick.load.date')}
              value={s.window_start ?? ''}
              onChange={(e) => parada(i, 'window_start', e.target.value)}
              error={errorDeParada(errors, i, 'window_start')}
            />
          </fieldset>
        ))}

        <p className="text-xs text-steel-600">{t('board.panel.edit.rest')}</p>
      </form>
    </Modal>
  )
}

/**
 * La ventana de cancelar.
 *
 * Pide un motivo y no pregunta «¿seguro?». El motivo es lo que exige el
 * servidor —diez caracteres— y además es lo que se le dice al cliente tres
 * semanas después; un «¿seguro?» no deja nada escrito.
 */
function CancelarCarga({
  open,
  onClose,
  carga,
}: {
  open: boolean
  onClose: () => void
  carga: CargaElegida
}) {
  const { t } = useI18n()
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const cerrar = () => {
    setMotivo('')
    setError(null)
    onClose()
  }

  return (
    <Modal
      open={open}
      title={t('board.panel.cancel.title', { number: carga.loadNumber })}
      onClose={cerrar}
      closeLabel={t('common.actions.close')}
      footer={
        <>
          <button type="button" onClick={cerrar} className={BOTON_SECUNDARIO}>
            {t('board.panel.cancel.keep')}
          </button>
          <button
            type="submit"
            form="cancel-load"
            disabled={enviando}
            className="rounded bg-safety-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-safety-800 disabled:opacity-60"
          >
            {t('board.panel.menu.cancel')}
          </button>
        </>
      }
    >
      <form
        id="cancel-load"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          setEnviando(true)
          router.post(
            `/loads/${carga.id}/status/cancelled`,
            { reason: motivo },
            {
              preserveScroll: true,
              onSuccess: cerrar,
              onError: (errores) => {
                setError(errores.reason ?? errores.action ?? null)
              },
              onFinish: () => setEnviando(false),
            },
          )
        }}
      >
        <p className="text-sm text-carbon">{t('board.panel.cancel.warning')}</p>

        <TextField
          label={t('common.labels.reason')}
          required
          minLength={10}
          maxLength={500}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          hint={t('board.panel.cancel.reasonHint')}
          error={error ?? undefined}
        />
      </form>
    </Modal>
  )
}

/**
 * El error de una parada concreta.
 *
 * Laravel los devuelve aplanados —`stops.0.city`— y el tipo de los errores de
 * Inertia solo conoce las claves de primer nivel, así que la búsqueda pasa por
 * aquí una vez en vez de llevar un `as` en cada campo. Los `as` repetidos son
 * donde se cuela la clave mal escrita: el error existe, nadie lo pinta, y la
 * ventana se queda en silencio diciendo que no pasó nada.
 */
function errorDeParada(errores: object, i: number, campo: string): string | undefined {
  const valor = (errores as Record<string, string | undefined>)[`stops.${i}.${campo}`]

  return typeof valor === 'string' ? valor : undefined
}

const BOTON_PRIMARIO =
  'rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-60'

const BOTON_SECUNDARIO =
  'rounded border border-steel-300 bg-white px-4 py-2 text-sm font-semibold text-navy-800 transition hover:bg-steel-100'
