import { Link, useForm } from '@inertiajs/react'
import { useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'
import { Estado } from './Index'

interface Solicitud {
  id: string
  status: string
  title: string
  templateKey: string
  templateVersion: number
  signerEmail: string
  signerLegalName: string | null
  locale: string
  carrierName: string | null
  requestedAt: string | null
  firstViewedAt: string | null
  completedAt: string | null
  expiresAt: string | null
  declinedAt: string | null
  declineReason: string | null
  voidedAt: string | null
  voidReason: string | null
  contentHash: string
}

interface Registro {
  id: string
  signerLegalName: string
  signerEmail: string
  signerTitle: string | null
  method: string
  signedAt: string | null
  ipAddress: string
  userAgent: string
  documentSha256: string
  signatureSha256: string
  sealAlgorithm: string
  hasDocument: boolean
  hasCertificate: boolean
  signedDocumentId: string | null
  certificateDocumentId: string | null
}

interface Verificacion {
  seal: boolean
  sealDerivedKey: boolean
  document: 'valid' | 'invalid' | 'unavailable'
  chain: boolean
  chainBrokenAt: string | null
}

interface Evento {
  id: string
  type: string
  at: string | null
  ip: string | null
  actor: string | null
}

interface Props {
  request: Solicitud
  record: Registro | null
  verification: Verificacion | null
  events: Evento[]
  can: { void: boolean; download: boolean }
}

/**
 * El detalle de una solicitud de firma.
 *
 * Lo que hay que entender de esta pantalla: las tres comprobaciones de
 * integridad NO son columnas guardadas. Se recalculan en el servidor cada vez
 * que alguien abre esto — el sello a partir del registro, el hash a partir del
 * fichero que está en el disco, y la cadena recorriendo la bitácora entera. Una
 * bandera «verificado» la podría poner en verde el mismo `update` que rompió la
 * firma.
 */
export default function SignatureShow({ request, record, verification, events, can }: Props) {
  const { t } = useI18n()

  return (
    <AppLayout
      title={t('signature.detail.title')}
      heading={request.title}
      crumbs={[
        { label: t('signature.index.title'), href: '/signatures' },
        { label: request.title },
      ]}
    >
      <div className="flex flex-col gap-4">
        <section className="rounded border border-steel-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Estado status={request.status} />
            <span className="text-xs text-steel-600">
              {t('signature.fields.templateVersion', { version: String(request.templateVersion) })}
            </span>
          </div>

          <dl className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
            <Dato etiqueta={t('signature.fields.signer')} valor={request.signerLegalName ?? '—'} />
            <Dato etiqueta={t('signature.fields.signerEmail')} valor={request.signerEmail} />
            <Dato etiqueta={t('signature.subjectTypes.carrier')} valor={request.carrierName ?? '—'} />
            <Dato etiqueta={t('signature.fields.locale')} valor={request.locale.toUpperCase()} />
            <Dato etiqueta={t('signature.fields.sentAt')} valor={request.requestedAt ?? '—'} />
            <Dato etiqueta={t('signature.fields.viewedAt')} valor={request.firstViewedAt ?? '—'} />
            <Dato etiqueta={t('signature.fields.signedAt')} valor={request.completedAt ?? '—'} />
            <Dato etiqueta={t('signature.fields.expiresAt')} valor={request.expiresAt ?? t('signature.sendDialog.noExpiry')} />
          </dl>

          {request.declineReason ? (
            <p className="mt-3 rounded border border-danger-300 bg-danger-50 p-3 text-sm text-carbon">
              <strong>{t('signature.statuses.declined')}:</strong> {request.declineReason}
            </p>
          ) : null}

          {request.voidReason ? (
            <p className="mt-3 rounded border border-steel-300 bg-steel-50 p-3 text-sm text-carbon">
              <strong>{t('signature.statuses.voided')}:</strong> {request.voidReason}
            </p>
          ) : null}

          {can.void && request.status !== 'signed' && request.status !== 'voided' ? (
            <div className="mt-3 border-t border-steel-100 pt-3">
              <Anular id={request.id} />
            </div>
          ) : null}
        </section>

        <section className="rounded border border-steel-200 bg-white p-4">
          <p className="text-sm font-semibold text-carbon">{t('signature.detail.record')}</p>

          {record === null ? (
            <p className="mt-2 text-sm text-steel-600">{t('signature.detail.noRecordYet')}</p>
          ) : (
            <>
              <dl className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
                <Dato etiqueta={t('signature.fields.signerLegalName')} valor={record.signerLegalName} />
                <Dato etiqueta={t('signature.fields.signerTitle')} valor={record.signerTitle ?? '—'} />
                <Dato etiqueta={t('signature.detail.method')} valor={t(`signature.methods.${record.method}`)} />
                <Dato etiqueta={t('signature.fields.signedAt')} valor={record.signedAt ?? '—'} />
                <Dato etiqueta={t('signature.detail.ipAddress')} valor={record.ipAddress} />
                <Dato etiqueta={t('signature.detail.userAgent')} valor={record.userAgent} />
              </dl>

              {can.download ? (
                <div className="mt-3 flex flex-wrap gap-3 border-t border-steel-100 pt-3">
                  {record.signedDocumentId !== null ? (
                    <a
                      href={`/documents/${record.signedDocumentId}/download`}
                      className="text-sm font-medium text-navy-700 hover:underline"
                    >
                      {t('signature.detail.downloadDocument')}
                    </a>
                  ) : null}
                  {record.certificateDocumentId !== null ? (
                    <a
                      href={`/signatures/${request.id}/certificate`}
                      className="text-sm font-medium text-navy-700 hover:underline"
                    >
                      {t('signature.detail.downloadCertificate')}
                    </a>
                  ) : null}
                </div>
              ) : null}

              <p className="mt-4 text-xs font-medium uppercase tracking-wide text-steel-600">
                {t('signature.detail.hashes')}
              </p>
              <dl className="mt-1 flex flex-col gap-1">
                <Huella etiqueta="template_content_hash" valor={request.contentHash} />
                <Huella etiqueta="document_sha256" valor={record.documentSha256} />
                <Huella etiqueta="signature_sha256" valor={record.signatureSha256} />
              </dl>
            </>
          )}
        </section>

        {verification !== null ? (
          <section className="rounded border border-steel-200 bg-white p-4">
            <p className="text-sm font-semibold text-carbon">{t('signature.detail.integrity')}</p>
            <p className="mt-0.5 text-xs text-steel-600">{t('signature.detail.integrityDescription')}</p>

            <ul className="mt-3 flex flex-col gap-2">
              <Comprobacion
                bien={verification.seal}
                textoBien={t('signature.detail.sealValid')}
                textoMal={t('signature.detail.sealInvalid')}
              />
              {verification.document === 'unavailable' ? (
                <Comprobacion bien={null} textoBien="" textoMal={t('signature.detail.documentUnavailable')} />
              ) : (
                <Comprobacion
                  bien={verification.document === 'valid'}
                  textoBien={t('signature.detail.documentHashValid')}
                  textoMal={t('signature.detail.documentHashInvalid')}
                />
              )}
              <Comprobacion
                bien={verification.chain}
                textoBien={t('signature.detail.chainValid')}
                textoMal={t('signature.detail.chainInvalid', {
                  eventId: verification.chainBrokenAt ?? '—',
                })}
              />
            </ul>

            {verification.sealDerivedKey ? (
              <p className="mt-3 rounded border border-warning-300 bg-warning-50 p-3 text-xs text-carbon">
                {t('signature.detail.derivedKeyWarning')}
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="rounded border border-steel-200 bg-white p-4">
          <p className="text-sm font-semibold text-carbon">{t('signature.detail.ceremony')}</p>

          <ol className="mt-3 flex flex-col gap-2">
            {events.map((e) => (
              <li key={e.id} className="border-l-2 border-steel-200 pl-3">
                <p className="text-sm text-carbon">{t(`signature.events.${e.type}`)}</p>
                <p className="text-xs text-steel-600">
                  {e.at ?? '—'}
                  {e.actor ? ` · ${e.actor}` : ''}
                  {e.ip ? ` · ${e.ip}` : ''}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <p className="text-xs text-steel-600">{t('signature.ceremony.legalNotice')}</p>

        <Link href="/signatures" className="text-sm font-medium text-navy-700 hover:underline">
          {t('signature.detail.backToList')}
        </Link>
      </div>
    </AppLayout>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-steel-600">{etiqueta}</dt>
      <dd className="break-words text-sm text-carbon">{valor}</dd>
    </div>
  )
}

function Huella({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="text-xs text-steel-600">{etiqueta}</dt>
      <dd className="break-all font-mono text-[11px] text-carbon">{valor}</dd>
    </div>
  )
}

function Comprobacion({
  bien, textoBien, textoMal,
}: { bien: boolean | null; textoBien: string; textoMal: string }) {
  const tono =
    bien === null
      ? 'border-steel-300 bg-steel-50 text-steel-700'
      : bien
        ? 'border-success-500 bg-success-50 text-success-700'
        : 'border-danger-300 bg-danger-50 text-danger-800'

  return (
    <li className={`rounded border px-3 py-2 text-sm ${tono}`}>
      {bien === true ? textoBien : textoMal}
    </li>
  )
}

function Anular({ id }: { id: string }) {
  const { t } = useI18n()
  const [abierto, setAbierto] = useState(false)
  const form = useForm({ reason: '' })

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded border border-danger-300 bg-white px-3 py-2 text-sm font-medium text-danger-700 transition hover:bg-danger-50"
      >
        {t('signature.detail.voidAction')}
      </button>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.post(`/signatures/${id}/void`, { preserveScroll: true })
      }}
      className="flex flex-col gap-2"
    >
      <p className="text-sm font-semibold text-carbon">{t('signature.detail.voidDialogTitle')}</p>
      <p className="text-xs text-steel-600">{t('signature.detail.voidDialogDescription')}</p>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-steel-700">{t('signature.detail.reasonLabel')}</span>
        <textarea
          rows={2}
          value={form.data.reason}
          onChange={(e) => form.setData('reason', e.target.value)}
          placeholder={t('signature.detail.reasonPlaceholder')}
          className="rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={form.processing || form.data.reason.trim() === ''}
          className="rounded bg-danger-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-danger-700 disabled:opacity-50"
        >
          {t('signature.detail.voidAction')}
        </button>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="rounded border border-steel-300 bg-white px-3 py-2 text-sm text-steel-700 transition hover:bg-steel-50"
        >
          {t('common.actions.cancel')}
        </button>
      </div>
    </form>
  )
}
