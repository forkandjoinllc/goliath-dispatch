import { useForm } from '@inertiajs/react'
import { useState } from 'react'
import { Modal } from '@/components/App/Modal'
import { TextField } from '@/components/Form/Field'
import { SearchableSelect, type Choice } from '@/components/Form/SearchableSelect'
import { useI18n } from '@/lib/i18n'

export interface AltaRapida {
  canLoad: boolean
  canDriver: boolean
  customers: Choice[]
  carriers: Choice[]
}

/**
 * Las altas rápidas del tablero: una carga y un conductor.
 *
 * ## Lo esencial, y el resto en la ficha
 *
 * Cada ventana pide lo MÍNIMO que el servidor exige para que la cosa exista, y
 * nada más: una carga necesita cliente y dos paradas; un conductor, nombre y
 * apellido. Al guardar, el servidor lleva a la ficha —es lo que ya hacían
 * `LoadController::store` y `DriverController::store` desde antes de que
 * existieran estas ventanas— y ahí se rellena lo demás con sitio para hacerlo.
 *
 * La alternativa era meter el formulario entero en una caja más pequeña. Un
 * alta de carga tiene treinta campos; en una ventana se abandona a la mitad, y
 * media carga no se guarda.
 *
 * ## Por las puertas de siempre
 *
 * `POST /loads` y `POST /drivers`, las mismas dos rutas que usan los
 * formularios completos. No hay un camino de creación «del tablero»: un
 * segundo camino es un segundo sitio donde olvidarse de un límite de plan, de
 * un permiso o de una regla de validación.
 *
 * Por eso tampoco hay validación propia aquí. Los errores que se pintan son
 * los que devuelve el servidor, con sus mismas claves.
 */
export function QuickAdd({ quickAdd }: { quickAdd: AltaRapida }) {
  const { t } = useI18n()
  const [abierta, setAbierta] = useState<'load' | 'driver' | null>(null)

  if (! quickAdd.canLoad && ! quickAdd.canDriver) return null

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {quickAdd.canLoad ? (
          <BotonRapido onClick={() => setAbierta('load')} label={t('board.quick.load.button')} />
        ) : null}
        {quickAdd.canDriver ? (
          <BotonRapido onClick={() => setAbierta('driver')} label={t('board.quick.driver.button')} />
        ) : null}
      </div>

      <CargaRapida
        open={abierta === 'load'}
        onClose={() => setAbierta(null)}
        customers={quickAdd.customers}
      />
      <ConductorRapido
        open={abierta === 'driver'}
        onClose={() => setAbierta(null)}
        carriers={quickAdd.carriers}
      />
    </>
  )
}

function BotonRapido({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded border border-navy-300 bg-white px-3 py-1.5 text-xs font-semibold text-navy-800 transition hover:border-navy-500 hover:bg-navy-50"
    >
      <span aria-hidden="true" className="text-sm leading-none">+</span>
      {label}
    </button>
  )
}

/** Hoy, en el formato que espera un `input type="date"`. */
function hoy(): string {
  return new Date().toISOString().slice(0, 10)
}

function CargaRapida({
  open,
  onClose,
  customers,
}: {
  open: boolean
  onClose: () => void
  customers: Choice[]
}) {
  const { t } = useI18n()
  const { data, setData, post, processing, errors, reset, clearErrors } = useForm({
    customer_id: '',
    commodity: '',
    stops: [
      { stop_type: 'pickup', city: '', state: '', country: 'US', window_start: '' },
      { stop_type: 'delivery', city: '', state: '', country: 'US', window_start: '' },
    ],
  })

  const cliente = customers.find((c) => c.id === data.customer_id) ?? null

  const cerrar = () => {
    reset()
    clearErrors()
    onClose()
  }

  const parada = (i: number, campo: 'city' | 'state' | 'window_start', valor: string) => {
    setData(
      'stops',
      data.stops.map((s, j) => (i === j ? { ...s, [campo]: valor } : s)),
    )
  }

  return (
    <Modal
      open={open}
      title={t('board.quick.load.title')}
      onClose={cerrar}
      closeLabel={t('common.actions.close')}
      footer={
        <>
          <button type="button" onClick={cerrar} className={BOTON_SECUNDARIO}>
            {t('common.actions.cancel')}
          </button>
          <button type="submit" form="quick-load" disabled={processing} className={BOTON_PRIMARIO}>
            {t('board.quick.load.submit')}
          </button>
        </>
      }
    >
      <form
        id="quick-load"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          post('/loads', { preserveScroll: true })
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
          value={data.commodity}
          maxLength={200}
          onChange={(e) => setData('commodity', e.target.value)}
          error={errors.commodity}
        />

        {/*
          Dos paradas y no una: una carga con un solo sitio no es una carga, y
          el servidor la rechaza con `min:2`. Pedirlas aquí es lo que hace que
          la ventana no mienta sobre lo que hace falta.
        */}
        {data.stops.map((s, i) => (
          <fieldset key={s.stop_type} className="flex flex-col gap-3 rounded border border-steel-200 p-3">
            <legend className="px-1 text-xs font-bold uppercase tracking-[0.1em] text-safety-600">
              {t(`board.stop.${s.stop_type}`)}
            </legend>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem]">
              <TextField
                label={t('common.labels.city')}
                value={s.city}
                maxLength={120}
                onChange={(e) => parada(i, 'city', e.target.value)}
                error={errorDeParada(errors, i, 'city')}
              />
              <TextField
                label={t('common.labels.state')}
                value={s.state}
                maxLength={3}
                onChange={(e) => parada(i, 'state', e.target.value.toUpperCase())}
                error={errorDeParada(errors, i, 'state')}
              />
            </div>

            <TextField
              type="date"
              label={t('board.quick.load.date')}
              value={s.window_start}
              min={i === 0 ? undefined : (data.stops[0]?.window_start ?? '') || hoy()}
              onChange={(e) => parada(i, 'window_start', e.target.value)}
              error={errorDeParada(errors, i, 'window_start')}
            />
          </fieldset>
        ))}

        <p className="text-xs text-steel-600">{t('board.quick.load.rest')}</p>
      </form>
    </Modal>
  )
}

function ConductorRapido({
  open,
  onClose,
  carriers,
}: {
  open: boolean
  onClose: () => void
  carriers: Choice[]
}) {
  const { t } = useI18n()
  const { data, setData, post, processing, errors, reset, clearErrors } = useForm({
    first_name: '',
    last_name: '',
    phone: '',
    carrier_ids: [] as string[],
  })

  const transportista = carriers.find((c) => c.id === (data.carrier_ids[0] ?? '')) ?? null

  const cerrar = () => {
    reset()
    clearErrors()
    onClose()
  }

  return (
    <Modal
      open={open}
      title={t('board.quick.driver.title')}
      onClose={cerrar}
      closeLabel={t('common.actions.close')}
      footer={
        <>
          <button type="button" onClick={cerrar} className={BOTON_SECUNDARIO}>
            {t('common.actions.cancel')}
          </button>
          <button type="submit" form="quick-driver" disabled={processing} className={BOTON_PRIMARIO}>
            {t('board.quick.driver.submit')}
          </button>
        </>
      }
    >
      <form
        id="quick-driver"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          post('/drivers', { preserveScroll: true })
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label={t('board.quick.driver.firstName')}
            required
            value={data.first_name}
            maxLength={100}
            onChange={(e) => setData('first_name', e.target.value)}
            error={errors.first_name}
          />
          <TextField
            label={t('board.quick.driver.lastName')}
            required
            value={data.last_name}
            maxLength={100}
            onChange={(e) => setData('last_name', e.target.value)}
            error={errors.last_name}
          />
        </div>

        <TextField
          type="tel"
          label={t('board.quick.driver.phone')}
          value={data.phone}
          maxLength={32}
          onChange={(e) => setData('phone', e.target.value)}
          error={errors.phone}
        />

        {/*
          Un transportista, no varios: quien da de alta desde el tablero tiene
          uno en la cabeza. La ficha admite los que hagan falta, y el servidor
          sigue recibiendo la lista que siempre recibió.
        */}
        <SearchableSelect
          label={t('board.quick.driver.carrier')}
          choices={carriers}
          selected={transportista}
          onPick={(id) => setData('carrier_ids', [id])}
          onClear={() => setData('carrier_ids', [])}
          emptyText={t('board.quick.driver.noCarriers')}
          changeText={t('common.actions.change')}
          error={errors.carrier_ids}
        />

        <p className="text-xs text-steel-600">{t('board.quick.driver.rest')}</p>
      </form>
    </Modal>
  )
}

/** Los errores de parada llegan aplanados: `stops.0.city`. */
function errorDeParada(errores: object, i: number, campo: string): string | undefined {
  const valor = (errores as Record<string, string | undefined>)[`stops.${i}.${campo}`]

  return typeof valor === 'string' ? valor : undefined
}

const BOTON_PRIMARIO =
  'rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-60'

const BOTON_SECUNDARIO =
  'rounded border border-steel-300 bg-white px-4 py-2 text-sm font-semibold text-navy-800 transition hover:bg-steel-100'
