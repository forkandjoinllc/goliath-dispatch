import { useState } from 'react'
import { useI18n } from '@/lib/i18n'

/** Lo que el registro federal devuelve de un transportista, ya proyectado. */
export interface FichaFederal {
  dotNumber: string | null
  mcNumber: string | null
  legalName: string | null
  dba: string | null
  phone: string | null
  line1: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
  entityType: string | null
  operatingStatus: string | null
  /** Nulo cuando el registro no lo dice. Falso es una respuesta, no una ausencia. */
  allowedToOperate: boolean | null
  safetyRating: string | null
  safetyRatingDate: string | null
  powerUnits: number | null
  driverCount: number | null
}

type Desenlace = 'idle' | 'searching' | 'found' | 'not_found' | 'invalid' | 'error' | 'rejected' | 'throttled'

interface Respuesta {
  status: string
  live: boolean
  provider: string
  carrier: FichaFederal | null
  checkedAt: string
}

/**
 * El primer paso del alta: el número, y lo que el registro federal sabe de él.
 *
 * ## Por qué va primero y no es un campo más
 *
 * Porque es el único dato que la persona trae seguro en la mano, y porque con
 * él el formulario puede rellenarse casi entero. Pedirlo en la casilla número
 * tres de veinte, como se pedía, es pedirle que teclee un domicilio que el
 * registro federal ya publica.
 *
 * ## Lo que esta pantalla no puede callarse
 *
 * 1. **De dónde salieron los datos y cuándo.** El registro publica fichas que
 *    llevan años sin tocarse. Pintarlas igual que lo que escribió la persona
 *    las presenta como suyas, y la primera vez que alguien lo nota es cuando
 *    le llega la documentación a una dirección en la que ya no está nadie.
 * 2. **Que se pueden corregir.** Ningún campo se bloquea.
 * 3. **Si NO es una consulta de verdad.** Sin credenciales, el adaptador
 *    simulado fabrica una ficha coherente para poder construir y demostrar.
 *    Enseñarla como si viniera de FMCSA sería la mentira más cara de este
 *    formulario.
 * 4. **Que ese transportista no puede operar**, cuando el registro lo dice. No
 *    bloquea el alta —eso lo decide la casa al revisarla— pero no se lo calla.
 *
 * ## No encontrado no es un error
 *
 * Un USDOT recién sacado todavía no está en el registro. Esa persona tiene que
 * poder seguir a mano sin que la pantalla la trate como si se hubiera
 * equivocado: por eso el formulario se abre igual, con el número ya puesto.
 */
export function FmcsaLookup({
  formToken,
  onFound,
  onSkip,
  abierto,
}: {
  formToken: string
  /** La ficha encontrada, para prerrellenar. */
  onFound: (ficha: FichaFederal, live: boolean, checkedAt: string) => void
  /** Seguir sin ficha, con lo tecleado. */
  onSkip: (kind: 'dot' | 'mc', numero: string) => void
  /** Si el formulario de abajo ya está abierto. */
  abierto: boolean
}) {
  const { t } = useI18n()
  const [kind, setKind] = useState<'dot' | 'mc'>('dot')
  const [numero, setNumero] = useState('')
  const [estado, setEstado] = useState<Desenlace>('idle')
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null)

  const texto = (clave: string) => t(`marketing.carrierSignup.lookup.${clave}`)

  const buscar = async () => {
    if (numero.trim() === '') return

    setEstado('searching')
    setRespuesta(null)

    try {
      const r = await fetch('/carrier-lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-XSRF-TOKEN': decodeURIComponent(
            (document.cookie.match(/XSRF-TOKEN=([^;]+)/) ?? [])[1] ?? '',
          ),
        },
        body: JSON.stringify({ kind, number: numero.trim(), form_token: formToken, hp_field: '' }),
      })

      // 429 es el tope por IP; 422 es el sello. Son cosas distintas y se dicen
      // distinto: una se arregla esperando y la otra recargando.
      if (r.status === 429) { setEstado('throttled'); return }
      if (r.status === 422) { setEstado('rejected'); return }
      if (!r.ok) { setEstado('error'); return }

      const d = (await r.json()) as Respuesta
      setRespuesta(d)

      if (d.status === 'found' && d.carrier !== null) {
        setEstado('found')
        onFound(d.carrier, d.live, d.checkedAt)

        return
      }

      setEstado(d.status === 'not_found' ? 'not_found' : d.status === 'invalid' ? 'invalid' : 'error')
    } catch {
      setEstado('error')
    }
  }

  const noPuedeOperar = respuesta?.carrier?.allowedToOperate === false

  return (
    <div className="rounded border border-steel-200 bg-navy-50/40 p-6">
      <h2 className="font-display text-lg font-bold text-navy-700">{texto('title')}</h2>
      <p className="mt-1 text-sm text-steel-700">{texto('intro')}</p>

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-steel-700">{texto('kind')}</span>
          <select
            value={kind}
            onChange={(e) => { setKind(e.target.value as 'dot' | 'mc') }}
            className="rounded border border-steel-300 bg-white px-3 py-2 text-sm font-semibold text-navy-800 outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
          >
            <option value="dot">{texto('dot')}</option>
            <option value="mc">{texto('mc')}</option>
          </select>
        </label>

        <label className="flex flex-1 flex-col gap-1" style={{ minWidth: '12rem' }}>
          <span className="text-sm font-medium text-steel-700">
            {kind === 'dot' ? texto('dotNumber') : texto('mcNumber')}
          </span>
          <input
            inputMode="numeric"
            value={numero}
            maxLength={20}
            onChange={(e) => { setNumero(e.target.value) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void buscar() } }}
            className="rounded border border-steel-300 bg-white px-3 py-2 text-sm text-carbon outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
          />
        </label>

        <button
          type="button"
          disabled={estado === 'searching' || numero.trim() === ''}
          onClick={() => { void buscar() }}
          className="rounded bg-safety-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-safety-700 disabled:opacity-50"
        >
          {estado === 'searching' ? texto('searching') : texto('search')}
        </button>
      </div>

      {estado === 'idle' || estado === 'searching' ? null : (
        <div role="status" className="mt-4 flex flex-col gap-2 text-sm">
          {estado === 'found' && respuesta !== null ? (
            <>
              <p className="font-medium text-success-700">
                {texto('found')} {respuesta.carrier?.legalName ?? ''}
              </p>

              {/* De dónde salió y cuándo. Va SIEMPRE, no solo cuando algo
                  falla: un dato traído de fuera y pintado sin procedencia se
                  lee como si lo hubiera escrito la persona. */}
              <p className="text-steel-700">
                {respuesta.live ? texto('fromRegistry') : texto('fromMock')}
              </p>
              <p className="text-steel-700">{texto('editable')}</p>

              {noPuedeOperar ? (
                <p className="rounded border border-warning-300 bg-warning-50 px-3 py-2 font-medium text-warning-800">
                  {texto('notAuthorized')}
                  {respuesta.carrier?.operatingStatus === null
                    ? null
                    : ` (${String(respuesta.carrier?.operatingStatus)})`}
                </p>
              ) : null}
            </>
          ) : null}

          {estado === 'not_found' ? <p className="text-steel-700">{texto('notFound')}</p> : null}
          {estado === 'invalid' ? (
            <p className="text-danger-700">{kind === 'dot' ? texto('badDot') : texto('badMc')}</p>
          ) : null}
          {estado === 'error' ? <p className="text-steel-700">{texto('providerDown')}</p> : null}
          {estado === 'throttled' ? <p className="text-steel-700">{texto('throttled')}</p> : null}
          {estado === 'rejected' ? <p className="text-steel-700">{texto('rejected')}</p> : null}
        </div>
      )}

      {/* Seguir a mano. Siempre disponible: un USDOT recién sacado no está en
          el registro todavía, y esa persona se da de alta igual. */}
      {abierto ? null : (
        <button
          type="button"
          onClick={() => { onSkip(kind, numero.trim()) }}
          className="mt-4 text-sm font-medium text-navy-700 underline underline-offset-2 hover:text-navy-900"
        >
          {texto('skip')}
        </button>
      )}
    </div>
  )
}
