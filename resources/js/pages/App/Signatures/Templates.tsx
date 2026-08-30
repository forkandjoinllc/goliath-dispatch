import { Link, useForm } from '@inertiajs/react'
import { useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Plantilla {
  id: string
  key: string
  version: number
  titleEn: string
  titleEs: string
  bodyEn: string
  bodyEs: string
  consentEn: string
  consentEs: string
  contentHash: string
  requiredTokens: string[]
  active: boolean
  effectiveFrom: string | null
  retiredAt: string | null
}

interface Props {
  templates: Plantilla[]
  can: { manage: boolean }
}

/**
 * Las plantillas y su historial.
 *
 * No hay formulario de edición y no es un olvido: publicar una versión escribe
 * una fila nueva. El texto de una versión ya firmada no puede cambiar sin
 * romper la huella que viaja dentro de cada firma hecha sobre ella — y esa
 * huella es lo único que permite decir, dentro de un año, sobre qué texto exacto
 * se firmó.
 */
export default function SignatureTemplates({ templates, can }: Props) {
  const { t } = useI18n()

  const porClave = new Map<string, Plantilla[]>()
  for (const p of templates) {
    porClave.set(p.key, [...(porClave.get(p.key) ?? []), p])
  }

  return (
    <AppLayout
      title={t('signature.templates.title')}
      description={t('signature.templates.description')}
      crumbs={[
        { label: t('signature.index.title'), href: '/signatures' },
        { label: t('signature.templates.title') },
      ]}
    >
      <div className="flex flex-col gap-4">
        <p className="rounded border border-steel-200 bg-steel-50 p-3 text-xs text-steel-700">
          {t('signature.templates.viewOnly')}
        </p>

        {templates.length === 0 ? (
          <div className="rounded border border-dashed border-steel-300 p-4">
            <p className="text-sm text-steel-700">{t('signature.templates.empty')}</p>
            {can.manage ? <Instalar /> : null}
          </div>
        ) : (
          [...porClave.entries()].map(([clave, versiones]) => (
            <Grupo key={clave} clave={clave} versiones={versiones} puedeGestionar={can.manage} />
          ))
        )}

        <Link href="/signatures" className="text-sm font-medium text-navy-700 hover:underline">
          {t('signature.detail.backToList')}
        </Link>
      </div>
    </AppLayout>
  )
}

function Grupo({
  clave, versiones, puedeGestionar,
}: { clave: string; versiones: Plantilla[]; puedeGestionar: boolean }) {
  const { t } = useI18n()
  const [abierto, setAbierto] = useState(false)
  // La vigente, o la más reciente si la clave entera está retirada. El grupo
  // solo existe porque hay al menos una versión, así que este caso no ocurre —
  // pero se contesta con nada en vez de reventar la pantalla entera.
  const vigente = versiones.find((v) => v.active) ?? versiones[0]

  if (vigente === undefined) return null

  return (
    <section className="rounded border border-steel-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-carbon">{vigente.titleEs} / {vigente.titleEn}</p>
          <p className="mt-0.5 font-mono text-xs text-steel-600">{clave}</p>
          <p className="mt-1 text-xs text-steel-600">
            {t('signature.templates.version', { version: String(vigente.version) })}
            {' · '}
            <span className={vigente.active ? 'text-success-700' : 'text-steel-600'}>
              {vigente.active ? t('signature.templates.active') : t('signature.templates.retired')}
            </span>
            {vigente.effectiveFrom ? ` · ${vigente.effectiveFrom}` : ''}
          </p>
        </div>

        {puedeGestionar && vigente.active ? <Retirar clave={clave} /> : null}
      </div>

      {vigente.requiredTokens.length > 0 ? (
        <p className="mt-3 text-xs text-steel-700">
          <span className="font-medium">{t('signature.templates.fields.requiredTokens')}: </span>
          <span className="font-mono">{vigente.requiredTokens.join(', ')}</span>
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-baseline gap-2">
        <span className="text-xs text-steel-600">{t('signature.templates.fields.contentHash')}</span>
        <span className="break-all font-mono text-[11px] text-carbon">{vigente.contentHash}</span>
      </div>
      <p className="mt-1 text-[11px] text-steel-500">{t('signature.templates.contentHashHint')}</p>

      <button
        type="button"
        onClick={() => setAbierto(! abierto)}
        className="mt-3 text-sm font-medium text-navy-700 hover:underline"
      >
        {abierto ? t('signature.templates.versionHistory') : t('signature.templates.versionHistory')}
        {` (${versiones.length})`}
      </button>

      {abierto ? (
        <div className="mt-3 flex flex-col gap-3 border-t border-steel-100 pt-3">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-steel-50 p-3 text-xs text-carbon">
            {vigente.bodyEs}
          </pre>
          <ul className="flex flex-col gap-1">
            {versiones.map((v) => (
              <li key={v.id} className="text-xs text-steel-700">
                {t('signature.templates.version', { version: String(v.version) })}
                {' · '}
                {v.active ? t('signature.templates.active') : t('signature.templates.retired')}
                {v.retiredAt ? ` · ${v.retiredAt}` : ''}
                {' · '}
                <span className="font-mono">{v.contentHash.slice(0, 16)}…</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function Instalar() {
  const { t } = useI18n()
  const form = useForm({})

  return (
    <div className="mt-3">
      <p className="text-xs text-steel-600">{t('signature.templates.installHint')}</p>
      <button
        type="button"
        disabled={form.processing}
        onClick={() => form.post('/signatures/templates/install', { preserveScroll: true })}
        className="mt-2 rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
      >
        {t('signature.templates.installAction')}
      </button>
    </div>
  )
}

function Retirar({ clave }: { clave: string }) {
  const { t } = useI18n()
  const [confirmando, setConfirmando] = useState(false)
  const form = useForm({})

  if (! confirmando) {
    return (
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        className="rounded border border-steel-300 bg-white px-3 py-2 text-sm text-steel-700 transition hover:bg-steel-50"
      >
        {t('signature.templates.retireAction')}
      </button>
    )
  }

  return (
    <div className="max-w-xs rounded border border-warning-300 bg-warning-50 p-3">
      <p className="text-sm font-semibold text-carbon">{t('signature.templates.retireDialogTitle')}</p>
      <p className="mt-1 text-xs text-steel-700">{t('signature.templates.retireDialogDescription')}</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={form.processing}
          onClick={() => form.post(`/signatures/templates/${clave}/retire`, { preserveScroll: true })}
          className="rounded bg-danger-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-danger-700 disabled:opacity-50"
        >
          {t('signature.templates.retireAction')}
        </button>
        <button
          type="button"
          onClick={() => setConfirmando(false)}
          className="rounded border border-steel-300 bg-white px-3 py-1.5 text-sm text-steel-700 transition hover:bg-steel-50"
        >
          {t('common.actions.cancel')}
        </button>
      </div>
    </div>
  )
}
