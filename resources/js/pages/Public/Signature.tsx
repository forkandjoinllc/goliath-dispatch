import { Head, useForm, usePage } from '@inertiajs/react'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import type { SharedProps } from '@/types'

interface Props {
  state: 'open' | 'not_found' | 'expired' | 'already_signed' | 'declined' | 'voided' | 'superseded'
  token: string | null
  document: { title: string; body: string; consent: string; version: number } | null
  signer: { email: string; legalName: string | null } | null
  senderName: string | null
}

/**
 * La ceremonia de firma. Sin sesión, sin menú, sin nada del armazón.
 *
 * Tres cosas de esta pantalla merecen explicación:
 *
 *  1. **El botón de firmar no se enciende hasta el final del documento.** Es
 *     una comprobación del navegador y por tanto se puede saltar; no está para
 *     impedir nada, está para que nadie firme sin haber tenido delante lo que
 *     firma. La evidencia de que se mostró está en la bitácora del servidor.
 *  2. **El aviso legal es literal.** Dice lo que esto hace —registra quién,
 *     cuándo, desde dónde y con qué huellas— y dice que por sí solo no
 *     garantiza la validez legal del acuerdo en ninguna jurisdicción. Venía así
 *     en el diccionario portado y no se ha suavizado.
 *  3. **Los seis motivos de rechazo tienen texto propio.** Al firmante le
 *     mandaron este enlace por correo: saber si su documento fue anulado o si
 *     venció es lo que necesita para saber a quién llamar.
 */
export default function PublicSignature({ state, token, document: doc, signer, senderName }: Props) {
  const { t } = useI18n()
  const { flash } = usePage<SharedProps>().props
  // OJO con el `null`. La bolsa `flash` compartida se arma con closures que
  // devuelven `session()->get('success')`, y eso es NULL —no ausente— cuando no
  // hay nada que contar. Un `!== undefined` daba verdadero siempre y esta
  // página enseñaba la pantalla de «firmado» con el título vacío a todo el que
  // abría su enlace. Se comprueba que HAYA texto, que es lo que se quiere saber.
  const flashSuccess = (flash as Record<string, unknown> | undefined)?.success
  const exito = typeof flashSuccess === 'string' && flashSuccess !== '' ? flashSuccess : null

  // El acuse de «firmado» va PRIMERO. Llega en el flash de la redirección que
  // sigue a la firma, y para entonces el estado ya es `already_signed`: mirar el
  // estado antes le enseñaría a quien acaba de firmar el texto genérico de «ya
  // firmado» en vez de la confirmación de lo que acaba de hacer.
  if (exito !== null) {
    return (
      <Marco titulo={doc?.title ?? ''}>
        <h1 className="font-display text-2xl font-bold text-carbon">{exito}</h1>
        <p className="mt-2 text-sm text-steel-700">{t('signature.ceremony.legalNotice')}</p>
      </Marco>
    )
  }

  if (state !== 'open' || doc === null || token === null) {
    const clave: Record<string, string> = {
      not_found: 'linkInvalid',
      expired: 'expired',
      already_signed: 'alreadySigned',
      declined: 'declined',
      voided: 'voided',
      superseded: 'superseded',
    }
    const k = clave[state] ?? 'linkInvalid'

    return (
      <Marco titulo={t('signature.detail.title')}>
        <h1 className="font-display text-2xl font-bold text-carbon">
          {t(`signature.ceremony.errors.${k}Title`)}
        </h1>
        <p className="mt-2 text-sm text-steel-700">{t(`signature.ceremony.errors.${k}Description`)}</p>
      </Marco>
    )
  }

  return <Ceremonia token={token} doc={doc} signer={signer} senderName={senderName} />
}

function Ceremonia({
  token, doc, signer, senderName,
}: {
  token: string
  doc: { title: string; body: string; consent: string; version: number }
  signer: { email: string; legalName: string | null } | null
  senderName: string | null
}) {
  const { t } = useI18n()
  const [alFinal, setAlFinal] = useState(false)
  const [modo, setModo] = useState<'drawn' | 'typed'>('typed')
  const [rechazando, setRechazando] = useState(false)
  const lienzo = useRef<HTMLCanvasElement | null>(null)
  const caja = useRef<HTMLDivElement | null>(null)
  const [dibujado, setDibujado] = useState(false)

  // Un acuerdo que cabe entero en la caja no dispara nunca un scroll, y sin
  // esto el botón se quedaría apagado para siempre en los documentos cortos. Se
  // mide DESPUÉS del montaje, no en el callback del ref: ahí el navegador
  // todavía no ha maquetado y las dos alturas valen cero, con lo que cualquier
  // documento parecería caber.
  useEffect(() => {
    const el = caja.current
    if (el === null) return
    if (el.scrollHeight <= el.clientHeight + 4) setAlFinal(true)
  }, [doc.body])

  const form = useForm({
    consent: false as boolean,
    legal_name: signer?.legalName ?? '',
    title: '',
    method: 'typed',
    drawn: '',
    typed: '',
  })

  const rechazo = useForm({ reason: '' })

  const firmaLista = modo === 'typed' ? form.data.typed.trim() !== '' : dibujado
  const puedeFirmar = alFinal && form.data.consent && form.data.legal_name.trim() !== '' && firmaLista

  return (
    <Marco titulo={doc.title}>
      {senderName ? (
        <p className="text-xs uppercase tracking-wide text-steel-600">{senderName}</p>
      ) : null}
      <h1 className="mt-1 font-display text-2xl font-bold text-carbon">{doc.title}</h1>
      <p className="mt-1 text-xs text-steel-600">
        {t('signature.fields.templateVersion', { version: String(doc.version) })}
      </p>

      <p className="mt-4 text-xs text-steel-600">{t('signature.ceremony.scrollHint')}</p>
      <div
        ref={caja}
        onScroll={(e) => {
          const el = e.currentTarget
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) setAlFinal(true)
        }}
        className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded border border-steel-200 bg-steel-50 p-4 text-sm leading-relaxed text-carbon"
      >
        {doc.body}
      </div>
      {alFinal ? (
        <p className="mt-1 text-xs text-success-700">{t('signature.ceremony.scrolledToEnd')}</p>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.transform((d) => ({
            ...d,
            method: modo,
            drawn: modo === 'drawn' ? (lienzo.current?.toDataURL('image/png') ?? '') : '',
            typed: modo === 'typed' ? d.typed : '',
          }))
          form.post(`/s/${token}/sign`, { preserveScroll: true })
        }}
        className="mt-6 flex flex-col gap-4"
      >
        <section>
          <h2 className="text-sm font-semibold text-carbon">{t('signature.ceremony.consentHeading')}</h2>
          <p className="mt-1 text-xs text-steel-700">{doc.consent}</p>
          <label className="mt-2 flex items-start gap-2 text-sm text-carbon">
            <input
              type="checkbox"
              checked={form.data.consent}
              onChange={(e) => form.setData('consent', e.target.checked)}
              className="mt-0.5"
            />
            <span>{t('signature.ceremony.consentCheckbox')}</span>
          </label>
        </section>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('signature.ceremony.legalNameLabel')}</span>
            <input
              type="text"
              value={form.data.legal_name}
              onChange={(e) => form.setData('legal_name', e.target.value)}
              placeholder={t('signature.ceremony.legalNamePlaceholder')}
              className={CAMPO}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('signature.ceremony.titleLabel')}</span>
            <input
              type="text"
              value={form.data.title}
              onChange={(e) => form.setData('title', e.target.value)}
              placeholder={t('signature.ceremony.titlePlaceholder')}
              className={CAMPO}
            />
          </label>
        </div>

        <section>
          <h2 className="text-sm font-semibold text-carbon">{t('signature.ceremony.signatureHeading')}</h2>

          <div className="mt-2 flex rounded border border-steel-300 self-start">
            <Pestana activo={modo === 'typed'} onClick={() => setModo('typed')}>
              {t('signature.pad.typeTab')}
            </Pestana>
            <Pestana activo={modo === 'drawn'} onClick={() => setModo('drawn')}>
              {t('signature.pad.drawTab')}
            </Pestana>
          </div>

          {modo === 'typed' ? (
            <input
              type="text"
              value={form.data.typed}
              onChange={(e) => form.setData('typed', e.target.value)}
              placeholder={t('signature.ceremony.signHere')}
              className={`${CAMPO} mt-2 w-full font-serif text-2xl italic`}
            />
          ) : (
            <Lienzo lienzo={lienzo} onDibujo={() => setDibujado(true)} onBorrar={() => setDibujado(false)} />
          )}
        </section>

        <p className="rounded border border-steel-200 bg-steel-50 p-3 text-xs text-steel-700">
          {t('signature.ceremony.legalNotice')}
        </p>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={! puedeFirmar || form.processing}
            className="rounded bg-navy-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
          >
            {form.processing ? t('signature.ceremony.submitting') : t('signature.ceremony.submit')}
          </button>
          <button
            type="button"
            onClick={() => setRechazando(! rechazando)}
            className="rounded border border-steel-300 bg-white px-4 py-2.5 text-sm text-steel-700 transition hover:bg-steel-50"
          >
            {t('signature.ceremony.decline')}
          </button>
        </div>
      </form>

      {rechazando ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            rechazo.post(`/s/${token}/decline`, { preserveScroll: true })
          }}
          className="mt-4 flex flex-col gap-2 rounded border border-steel-300 p-4"
        >
          <p className="text-sm font-semibold text-carbon">{t('signature.ceremony.declineDialogTitle')}</p>
          <p className="text-xs text-steel-700">{t('signature.ceremony.declineDialogDescription')}</p>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-steel-700">{t('signature.ceremony.declineReasonLabel')}</span>
            <textarea
              rows={3}
              value={rechazo.data.reason}
              onChange={(e) => rechazo.setData('reason', e.target.value)}
              className={CAMPO}
            />
          </label>
          <button
            type="submit"
            disabled={rechazo.processing || rechazo.data.reason.trim() === ''}
            className="self-start rounded bg-danger-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-danger-700 disabled:opacity-50"
          >
            {t('signature.ceremony.declineSubmit')}
          </button>
        </form>
      ) : null}
    </Marco>
  )
}

function Lienzo({
  lienzo, onDibujo, onBorrar,
}: {
  lienzo: React.MutableRefObject<HTMLCanvasElement | null>
  onDibujo: () => void
  onBorrar: () => void
}) {
  const { t } = useI18n()
  const pintando = useRef(false)

  useEffect(() => {
    const el = lienzo.current
    if (el === null) return
    const ctx = el.getContext('2d')
    if (ctx === null) return
    // Fondo blanco: sin esto el PNG sale con transparencia y la firma
    // desaparece sobre el papel blanco del PDF.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, el.width, el.height)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#111827'
  }, [lienzo])

  const punto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const el = e.currentTarget
    const caja = el.getBoundingClientRect()
    return {
      x: ((e.clientX - caja.left) / caja.width) * el.width,
      y: ((e.clientY - caja.top) / caja.height) * el.height,
    }
  }

  return (
    <div className="mt-2">
      <canvas
        ref={lienzo}
        width={800}
        height={220}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          const ctx = e.currentTarget.getContext('2d')
          if (ctx === null) return
          const p = punto(e)
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
          pintando.current = true
        }}
        onPointerMove={(e) => {
          if (! pintando.current) return
          const ctx = e.currentTarget.getContext('2d')
          if (ctx === null) return
          const p = punto(e)
          ctx.lineTo(p.x, p.y)
          ctx.stroke()
          onDibujo()
        }}
        onPointerUp={() => { pintando.current = false }}
        onPointerLeave={() => { pintando.current = false }}
        className="w-full touch-none rounded border border-steel-300 bg-white"
      />
      <button
        type="button"
        onClick={() => {
          const el = lienzo.current
          const ctx = el?.getContext('2d')
          if (el === null || el === undefined || ctx === null || ctx === undefined) return
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, el.width, el.height)
          onBorrar()
        }}
        className="mt-2 rounded border border-steel-300 bg-white px-3 py-1.5 text-sm text-steel-700 transition hover:bg-steel-50"
      >
        {t('signature.pad.clear')}
      </button>
    </div>
  )
}

function Pestana({
  activo, onClick, children,
}: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-1.5 text-sm transition ${
        activo ? 'bg-navy-50 font-medium text-navy-800' : 'bg-white text-steel-700 hover:bg-steel-50'
      }`}
    >
      {children}
    </button>
  )
}

function Marco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <>
      <Head title={titulo}>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <main className="min-h-screen bg-steel-50 px-4 py-10">
        <div className="mx-auto max-w-3xl rounded border border-steel-200 bg-white p-6 sm:p-8">
          {children}
        </div>
      </main>
    </>
  )
}

const CAMPO =
  'rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200'
