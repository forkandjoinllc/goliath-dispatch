import { Link, router, usePage } from '@inertiajs/react'
import { useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Firma {
  id: string
  status: string
  requestedAt: string
  firstViewedAt: string | null
}

interface Movimiento {
  action: string
  to: string
  reason: boolean
}

interface Fila {
  id: string
  name: string
  dot: string | null
  mc: string | null
  status: string
  correctionNotes: string | null
  rejectionReason: string | null
  suspensionReason: string | null
  waitingSince: string | null
  lastActivityAt: string | null
  blocking: string[]
  warnings: string[]
  missingDocuments: string[]
  requiredDocuments: string[]
  approvedDocuments: string[]
  signature: Firma | null
  fmcsaCheckedAt: string | null
  canHaul: boolean
  moves: Movimiento[]
}

interface Props {
  carriers: Fila[]
  columns: string[]
  blockedApproved: Fila[]
  filters: { ready: string }
  counts: { all: number; ready: number; blocked: number }
  can: { review: boolean; approve: boolean }
}

/**
 * El tablero de incorporación: una columna por estado del alta.
 *
 * ## A dónde puede ir una tarjeta lo dice el SERVIDOR
 *
 * Cada tarjeta trae sus `moves`, calculados con `Transitions::graph()` y con el
 * permiso ya resuelto. Esta pantalla no lleva ninguna copia de las siete reglas
 * del flujo: si la llevara, el día que alguien añadiera una arista en PHP el
 * tablero seguiría ofreciendo las de antes, invitando a un movimiento que la
 * transición va a negar. Una columna que no está en `moves` no acepta la
 * tarjeta, y se lo dice mientras se arrastra.
 *
 * Soltar EJECUTA la transición de verdad; los tres pasos que perjudican al
 * transportista —correcciones, rechazo, suspensión— piden el motivo escrito
 * antes de confirmar, igual que en su ficha. Y el servidor vuelve a comprobarlo
 * todo: si otra persona movió el alta desde otra pestaña, la suelta se rechaza
 * y el mensaje sale arriba.
 *
 * ## Arrastrar no puede ser la única forma
 *
 * Cada tarjeta lleva además un botón «Mover» con los mismos destinos. Un tablero
 * que solo funcione con el ratón deja fuera a quien navegue con el teclado, y
 * son exactamente los mismos movimientos: salen de la misma lista.
 *
 * ## El filtro NO es por estado
 *
 * Las columnas ya son los estados. Lo que el tablero no contesta de un vistazo
 * es quién está atascado, así que el filtro es «puede llevar carga / bloqueado»
 * — que incluye el caso que esta pantalla existe para encontrar: el aprobado
 * con un documento vencido, al que ninguna lista por estado enseña.
 */
export default function OnboardingIndex({
  carriers, columns, blockedApproved, filters, counts,
}: Props) {
  const { t } = useI18n()
  const { errors } = usePage().props as unknown as { errors: Record<string, string | undefined> }

  const [arrastrando, setArrastrando] = useState<Fila | null>(null)
  const [pendiente, setPendiente] = useState<{ fila: Fila; movimiento: Movimiento } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [enCurso, setEnCurso] = useState<string | null>(null)

  const mover = (fila: Fila, movimiento: Movimiento, texto: string): void => {
    setEnCurso(fila.id)

    router.post(
      `/carriers/${fila.id}/onboarding/${movimiento.action}`,
      { reason: texto },
      {
        preserveScroll: true,
        onFinish: () => {
          setEnCurso(null)
          setPendiente(null)
          setMotivo('')
        },
      },
    )
  }

  const pedir = (fila: Fila, movimiento: Movimiento): void => {
    if (movimiento.reason) {
      setMotivo('')
      setPendiente({ fila, movimiento })

      return
    }

    mover(fila, movimiento, '')
  }

  const destino = (fila: Fila | null, columna: string): Movimiento | undefined =>
    fila?.moves.find((m) => m.to === columna)

  const error = errors.action ?? errors.reason

  return (
    <AppLayout
      title={t('onboarding.board.title')}
      description={t('onboarding.queue.description')}
      crumbs={[{ label: t('onboarding.queue.title') }]}
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="rounded border border-danger-300 bg-danger-50 p-3 text-sm text-danger-700">
            {error}
          </p>
        ) : null}

        {blockedApproved.length > 0 ? (
          <section className="rounded border border-danger-300 bg-danger-50 p-4">
            <p className="text-sm font-semibold text-carbon">{t('onboarding.queue.blockedTitle')}</p>
            <p className="mt-0.5 text-xs text-carbon">{t('onboarding.queue.blockedDescription')}</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {blockedApproved.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/carriers/${c.id}`}
                    className="rounded border border-danger-300 bg-white px-2 py-1 text-xs font-medium text-danger-700 hover:underline"
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Filtro activo={filters.ready === ''} href="/onboarding">
            {t('onboarding.board.filterAll')} ({counts.all})
          </Filtro>
          <Filtro activo={filters.ready === 'ready'} href="/onboarding?ready=ready">
            {t('onboarding.board.filterReady')} ({counts.ready})
          </Filtro>
          <Filtro activo={filters.ready === 'blocked'} href="/onboarding?ready=blocked">
            {t('onboarding.board.filterBlocked')} ({counts.blocked})
          </Filtro>
        </div>

        <p className="text-xs text-steel-600">{t('onboarding.board.dropHint')}</p>

        {/* El tablero desborda a lo ancho y hace su propio scroll. Siete
            columnas no caben en una pantalla y encogerlas dejaría tarjetas
            ilegibles. */}
        <div className="-mx-1 overflow-x-auto pb-2">
          <div className="flex min-w-max gap-3 px-1">
            {columns.map((columna) => {
              const fichas = carriers.filter((c) => c.status === columna)
              const movimiento = destino(arrastrando, columna)
              const rechaza = arrastrando !== null && movimiento === undefined
              const acepta = arrastrando !== null && movimiento !== undefined

              return (
                <section
                  key={columna}
                  onDragOver={(e) => {
                    if (acepta) {
                      e.preventDefault()
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault()

                    if (arrastrando !== null && movimiento !== undefined) {
                      pedir(arrastrando, movimiento)
                    }

                    setArrastrando(null)
                  }}
                  className={`flex w-72 shrink-0 flex-col rounded border p-2 transition ${
                    acepta
                      ? 'border-dashed border-navy-500 bg-navy-50'
                      : rechaza
                        ? 'border-steel-200 bg-steel-50 opacity-50'
                        : 'border-steel-200 bg-steel-50'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2 px-1 pb-2">
                    <h2 className="text-sm font-semibold text-carbon">
                      {t(`onboarding.status.${columna}`)}
                    </h2>
                    <span className="text-xs tabular-nums text-steel-600">{fichas.length}</span>
                  </div>

                  {rechaza ? (
                    <p className="px-1 pb-2 text-xs text-steel-600">
                      {t('onboarding.board.notAllowed')}
                    </p>
                  ) : null}

                  {fichas.length === 0 ? (
                    <p className="px-1 py-3 text-xs text-steel-600">{t('onboarding.board.noCards')}</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {fichas.map((c) => (
                        <Tarjeta
                          key={c.id}
                          fila={c}
                          moviendo={enCurso === c.id}
                          onArrastrar={() => setArrastrando(c)}
                          onSoltar={() => setArrastrando(null)}
                          onMover={(m) => pedir(c, m)}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
        </div>
      </div>

      {pendiente !== null ? (
        <Motivo
          fila={pendiente.fila}
          movimiento={pendiente.movimiento}
          valor={motivo}
          onCambiar={setMotivo}
          onConfirmar={() => mover(pendiente.fila, pendiente.movimiento, motivo)}
          onCancelar={() => {
            setPendiente(null)
            setMotivo('')
          }}
        />
      ) : null}
    </AppLayout>
  )
}

function Tarjeta({
  fila, moviendo, onArrastrar, onSoltar, onMover,
}: {
  fila: Fila
  moviendo: boolean
  onArrastrar: () => void
  onSoltar: () => void
  onMover: (m: Movimiento) => void
}) {
  const { t } = useI18n()
  const [abierto, setAbierto] = useState(false)

  // `carrierNotApproved` NO se pinta en el tablero.
  //
  // En la lista de antes el estado era una etiqueta al lado del nombre y ese
  // motivo añadía algo. Aquí el estado ES la columna, así que la tarjeta
  // repetía en rojo lo que su propia cabecera ya decía: TODAS las tarjetas de
  // seis de las siete columnas salían con una alarma que no informa de nada.
  // Un aviso que aparece siempre deja de leerse, y arrastra consigo a los que sí
  // importan —el seguro vencido, el acuerdo sin firmar—, que estaban al lado.
  const bloqueos = fila.blocking.filter((b) => b !== 'carrierNotApproved')
  const falta = [...bloqueos, ...fila.missingDocuments]

  return (
    <li
      draggable={fila.moves.length > 0 && ! moviendo}
      onDragStart={onArrastrar}
      onDragEnd={onSoltar}
      className={`rounded border bg-white p-3 ${
        fila.canHaul ? 'border-steel-200' : 'border-danger-300'
      } ${fila.moves.length > 0 && ! moviendo ? 'cursor-grab active:cursor-grabbing' : ''} ${
        moviendo ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/carriers/${fila.id}`}
          className="min-w-0 text-sm font-semibold text-navy-700 hover:underline"
        >
          {fila.name}
        </Link>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${
            fila.canHaul ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700'
          }`}
        >
          {fila.canHaul ? t('onboarding.queue.canHaul') : t('onboarding.queue.cannotHaul')}
        </span>
      </div>

      <p className="mt-0.5 text-xs text-steel-600">
        {[fila.dot ? `USDOT ${fila.dot}` : null, fila.mc ? `MC ${fila.mc}` : null]
          .filter(Boolean)
          .join(' · ') || '—'}
      </p>

      {fila.waitingSince ? (
        <p className="mt-0.5 text-xs text-steel-600">
          {t('onboarding.queue.waitingColumn')}: {fila.waitingSince}
        </p>
      ) : null}

      {/* Lo último que se movió en esta ficha. Distinto de «esperando desde»:
          aquélla dice cuánto lleva parada EN ESTE PUNTO, ésta si alguien la ha
          tocado. Una tarjeta que lleva dos meses en revisión y se tocó ayer no
          es el mismo problema que una que nadie mira desde marzo. */}
      {fila.lastActivityAt ? (
        <p className="text-xs text-steel-600">
          {t('onboarding.board.lastActivity')}: {fila.lastActivityAt}
        </p>
      ) : null}

      {falta.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1">
          {bloqueos.map((b) => (
            <li key={b} className="rounded bg-danger-50 px-1.5 py-0.5 text-[11px] text-danger-700">
              {t(`onboarding.blocking.${b}`)}
            </li>
          ))}
          {fila.missingDocuments.map((d) => (
            <li key={d} className="rounded bg-danger-50 px-1.5 py-0.5 text-[11px] text-danger-700">
              {t(`onboarding.checklist.${d}`)}
            </li>
          ))}
        </ul>
      ) : null}

      {fila.warnings.length > 0 ? (
        <ul className="mt-1 flex flex-wrap gap-1">
          {fila.warnings.map((w) => (
            <li key={w} className="rounded bg-warning-50 px-1.5 py-0.5 text-[11px] text-carbon">
              {t(`onboarding.warnings.${w}`)}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Los mismos destinos que aceptan la tarjeta al arrastrarla. Un tablero
          que solo funcione con el ratón deja fuera a quien use el teclado. */}
      <div className="mt-2 border-t border-steel-100 pt-2">
        {moviendo ? (
          <p className="text-xs text-steel-600">{t('onboarding.board.moving')}</p>
        ) : fila.moves.length === 0 ? (
          <p className="text-xs text-steel-600">{t('onboarding.board.noMoves')}</p>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setAbierto((v) => ! v)}
              aria-expanded={abierto}
              className="text-xs font-medium text-navy-700 hover:underline"
            >
              {t('onboarding.board.moves')}
            </button>

            {abierto ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {fila.moves.map((m) => (
                  <button
                    key={m.action}
                    type="button"
                    onClick={() => onMover(m)}
                    className="rounded border border-steel-300 px-2 py-1 text-[11px] font-medium text-navy-700 transition hover:bg-navy-50"
                  >
                    {t(`carriers.onboarding.actions.${m.action}`)}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </li>
  )
}

function Motivo({
  fila, movimiento, valor, onCambiar, onConfirmar, onCancelar,
}: {
  fila: Fila
  movimiento: Movimiento
  valor: string
  onCambiar: (v: string) => void
  onConfirmar: () => void
  onCancelar: () => void
}) {
  const { t } = useI18n()

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onCancelar()
        }
      }}
    >
      {/* Igual que el cajón de navegación: el fondo es un botón, para que
          cerrar con el ratón fuera del diálogo no dependa de un `onClick` en un
          `div` que el teclado no alcanza. */}
      <button
        type="button"
        aria-label={t('common.a11y.closeDialog')}
        onClick={onCancelar}
        className="absolute inset-0 bg-carbon/40"
      />

      <div role="dialog" aria-modal="true" className="relative w-full max-w-md rounded border border-steel-300 bg-white p-4 shadow-lg">
        <p className="text-sm font-semibold text-carbon">
          {t(`carriers.onboarding.actions.${movimiento.action}`)} — {fila.name}
        </p>
        <p className="mt-1 text-xs text-steel-600">{t('onboarding.board.reasonRequired')}</p>

        <label className="mt-3 block text-sm font-medium text-carbon">
          {t('carriers.onboarding.reason')}
          <textarea
            autoFocus
            rows={4}
            value={valor}
            onChange={(e) => onCambiar(e.target.value)}
            className="mt-1 w-full rounded border border-steel-300 bg-white px-2.5 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
          />
        </label>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={valor.trim() === ''}
            onClick={onConfirmar}
            className="rounded bg-navy-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('carriers.onboarding.confirm')}
          </button>
          <button
            type="button"
            onClick={onCancelar}
            className="rounded border border-steel-300 px-3 py-1.5 text-sm font-medium text-carbon transition hover:bg-steel-50"
          >
            {t('onboarding.board.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Filtro({ activo, href, children }: { activo: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded border px-3 py-1.5 text-sm font-medium transition ${
        activo
          ? 'border-navy-600 bg-navy-700 text-white'
          : 'border-steel-300 text-carbon hover:bg-navy-50'
      }`}
    >
      {children}
    </Link>
  )
}
