import { Link, router, useForm } from '@inertiajs/react'
import { useState, type ReactNode } from 'react'
import { StatusBadge } from '@/components/App/StatusBadge'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Carrier {
  id: string
  legalName: string
  dba: string | null
  dotNumber: string
  mcNumber: string | null
  contact: string
  email: string
  phone: string
  website: string | null
  preferredLocale: string
  onboardingStatus: string | null
  fmcsaStatus: string | null
  dispatchFeeBps: number
  usesFactoring: boolean
  notes: string | null
  physical: {
    line1: string | null
    line2: string | null
    city: string | null
    state: string | null
    postalCode: string | null
    country: string | null
  }
  approvedAt: string | null
  suspendedAt: string | null
  suspensionReason: string | null
  fmcsaLastVerifiedAt: string | null
  fmcsaNextVerificationAt: string | null
  createdAt: string | null
}

interface Onboarding {
  status: string
  submittedAt: string | null
  reviewStartedAt: string | null
  decidedAt: string | null
  correctionNotes: string | null
  rejectionReason: string | null
  requiredDocumentTypes: string[]
  checklist: Record<string, boolean>
}

interface Verification {
  status: string
  provider: string
  attempt: number
  errorMessage: string | null
  normalized: Record<string, unknown> | null
  overriddenAt: string | null
  overrideReason: string | null
  checkedAt: string | null
}

interface DocumentRow {
  id: string
  type: string
  title: string | null
  reviewStatus: string
  expirationDate: string | null
  isRequired: boolean
}

interface Unit {
  id: string
  unitNumber: string
  year: number | null
  make: string | null
  model: string | null
  status: string
}

interface Props {
  carrier: Carrier
  onboarding: Onboarding | null
  verification: Verification | null
  documents: DocumentRow[] | null
  fleet: { trucks: Unit[]; trailers: Unit[] } | null
  can: {
    update: boolean
    updateFee: boolean
    delete: boolean
    submitOnboarding: boolean
    reviewOnboarding: boolean
    approveOnboarding: boolean
    runVerification: boolean
    overrideVerification: boolean
  }
}

/**
 * Qué acciones de alta caben desde cada estado, y qué permiso pide cada una.
 *
 * Es un ESPEJO de App\Support\Onboarding\Transitions, no la regla. El servidor
 * vuelve a comprobarlo todo; esto solo evita pintar un botón que va a fallar.
 */
const TRANSITIONS: Record<string, { action: string; needs: keyof Props['can']; danger?: boolean }[]> = {
  draft: [{ action: 'submitted', needs: 'submitOnboarding' }],
  corrections_required: [{ action: 'submitted', needs: 'submitOnboarding' }],
  submitted: [
    { action: 'under_review', needs: 'reviewOnboarding' },
    { action: 'corrections_required', needs: 'reviewOnboarding', danger: true },
  ],
  under_review: [
    { action: 'approved', needs: 'approveOnboarding' },
    { action: 'corrections_required', needs: 'reviewOnboarding', danger: true },
    { action: 'rejected', needs: 'approveOnboarding', danger: true },
  ],
  approved: [{ action: 'suspended', needs: 'approveOnboarding', danger: true }],
  suspended: [{ action: 'reinstate', needs: 'approveOnboarding' }],
}

const NEEDS_REASON = ['corrections_required', 'rejected', 'suspended']

export default function CarrierShow({ carrier, onboarding, verification, documents, fleet, can }: Props) {
  const { t, locale } = useI18n()
  const [pending, setPending] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [overriding, setOverriding] = useState(false)

  const date = (value: string | null): string =>
    value
      ? new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', { dateStyle: 'medium' }).format(
          new Date(value),
        )
      : '—'

  const available = (TRANSITIONS[onboarding?.status ?? ''] ?? []).filter((x) => can[x.needs])

  const run = (action: string) => {
    router.post(
      `/carriers/${carrier.id}/onboarding/${action}`,
      { reason },
      {
        preserveScroll: true,
        onFinish: () => {
          setPending(null)
          setReason('')
        },
      },
    )
  }

  return (
    <AppLayout
      title={carrier.legalName}
      description={carrier.dba ?? undefined}
      crumbs={[
        { label: t('carriers.index.title'), href: '/carriers' },
        { label: carrier.legalName },
      ]}
      actions={
        <>
          {can.update ? (
            <Link
              href={`/carriers/${carrier.id}/edit`}
              className="rounded border border-steel-300 px-4 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
            >
              {t('carriers.detail.edit')}
            </Link>
          ) : null}
          {can.delete ? <DeleteButton id={carrier.id} /> : null}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge family="onboarding" value={carrier.onboardingStatus} />
        <StatusBadge family="verification" value={carrier.fmcsaStatus} />
        <span className="text-sm text-steel-600">
          USDOT {carrier.dotNumber}
          {carrier.mcNumber ? ` · MC ${carrier.mcNumber}` : ''}
        </span>
      </div>

      {carrier.suspendedAt ? (
        <p role="alert" className="mt-4 rounded border-l-4 border-danger-500 bg-danger-50 p-3 text-sm">
          <strong>{t('carriers.detail.suspendedAt')}: {date(carrier.suspendedAt)}</strong>
          {carrier.suspensionReason ? <span className="block">{carrier.suspensionReason}</span> : null}
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card title={t('carriers.detail.identity')}>
            <Dl>
              <Item label={t('carriers.detail.legalName')}>{carrier.legalName}</Item>
              <Item label={t('carriers.detail.dba')}>{carrier.dba ?? '—'}</Item>
              <Item label="USDOT">{carrier.dotNumber}</Item>
              <Item label={t('carriers.detail.mcNumber')}>{carrier.mcNumber ?? '—'}</Item>
              <Item label={t('carriers.detail.createdAt')}>{date(carrier.createdAt)}</Item>
              <Item label={t('carriers.detail.approvedAt')}>{date(carrier.approvedAt)}</Item>
            </Dl>
          </Card>

          <Card title={t('carriers.detail.contact')}>
            <Dl>
              <Item label={t('carriers.columns.contact')}>{carrier.contact}</Item>
              <Item label={t('carriers.form.email')}>
                <a href={`mailto:${carrier.email}`} className="text-navy-700 hover:underline">
                  {carrier.email}
                </a>
              </Item>
              <Item label={t('carriers.form.phone')}>{carrier.phone}</Item>
              <Item label={t('carriers.detail.preferredLocale')}>
                {carrier.preferredLocale === 'es' ? 'Español' : 'English'}
              </Item>
              <Item label={t('carriers.detail.website')}>{carrier.website ?? '—'}</Item>
            </Dl>
          </Card>

          <Card title={t('carriers.detail.address')}>
            <address className="not-italic text-sm text-carbon">
              {carrier.physical.line1 ? (
                <>
                  {carrier.physical.line1}
                  {carrier.physical.line2 ? <><br />{carrier.physical.line2}</> : null}
                  <br />
                  {[carrier.physical.city, carrier.physical.state].filter(Boolean).join(', ')}{' '}
                  {carrier.physical.postalCode}
                </>
              ) : (
                '—'
              )}
            </address>
          </Card>

          {documents ? (
            <Card title={t('carriers.detail.documents')}>
              {documents.length === 0 ? (
                <p className="text-sm text-steel-700">{t('carriers.detail.noDocuments')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-steel-100">
                  {documents.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-carbon">
                          {d.title ?? d.type.replace(/_/g, ' ')}
                        </span>
                        <span className="text-xs text-steel-600">
                          {d.expirationDate
                            ? t('carriers.detail.expiresOn', { date: date(d.expirationDate) })
                            : t('carriers.detail.noExpiry')}
                        </span>
                      </span>
                      <StatusBadge family="document" value={d.reviewStatus} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {fleet ? (
            <Card title={t('carriers.detail.fleet')}>
              {fleet.trucks.length === 0 && fleet.trailers.length === 0 ? (
                <p className="text-sm text-steel-700">{t('carriers.detail.noFleet')}</p>
              ) : (
                <div className="grid gap-6 sm:grid-cols-2">
                  <UnitList title={t('carriers.detail.trucks')} units={fleet.trucks} />
                  <UnitList title={t('carriers.detail.trailers')} units={fleet.trailers} />
                </div>
              )}
            </Card>
          ) : null}

          <Card title={t('carriers.detail.notes')}>
            <p className="whitespace-pre-wrap text-sm text-carbon">
              {carrier.notes ?? t('carriers.detail.noNotes')}
            </p>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card title={t('carriers.detail.commercial')}>
            <Dl>
              <Item label={t('carriers.detail.dispatchFee')}>
                {(carrier.dispatchFeeBps / 100).toLocaleString(locale === 'es' ? 'es-US' : 'en-US', {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                })}
                %
              </Item>
              <Item label={t('carriers.detail.factoring')}>
                {carrier.usesFactoring ? t('common.labels.yes') : t('common.labels.no')}
              </Item>
            </Dl>
          </Card>

          {onboarding ? (
            <Card title={t('carriers.onboarding.title')}>
              <div className="flex flex-col items-start gap-3">
                <StatusBadge family="onboarding" value={onboarding.status} />

                {onboarding.correctionNotes ? (
                  <p className="w-full rounded border-l-4 border-safety-500 bg-safety-50 p-2.5 text-sm">
                    <strong className="block">{t('carriers.onboarding.correctionNotes')}</strong>
                    {onboarding.correctionNotes}
                  </p>
                ) : null}

                {onboarding.rejectionReason ? (
                  <p className="w-full rounded border-l-4 border-danger-500 bg-danger-50 p-2.5 text-sm">
                    <strong className="block">{t('carriers.onboarding.rejectionReason')}</strong>
                    {onboarding.rejectionReason}
                  </p>
                ) : null}

                {Object.keys(onboarding.checklist).length > 0 ? (
                  <div className="w-full">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-steel-600">
                      {t('carriers.onboarding.checklist')}
                    </h3>
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {Object.entries(onboarding.checklist).map(([key, done]) => (
                        <li key={key} className="flex items-center gap-2 text-sm">
                          <span
                            aria-hidden="true"
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[10px] font-bold ${
                              done ? 'bg-success-500 text-white' : 'border border-steel-300 text-transparent'
                            }`}
                          >
                            ✓
                          </span>
                          <span className={done ? 'text-carbon' : 'text-steel-600'}>
                            {t(`carriers.onboarding.checklistItems.${key}`)}
                          </span>
                          {/* El estado también en texto: la marca verde sola no
                              la lee un lector de pantalla. */}
                          <span className="sr-only">
                            {done ? t('common.labels.yes') : t('common.labels.no')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <Dl compact className="w-full">
                  <Item label={t('carriers.onboarding.submittedAt')}>{date(onboarding.submittedAt)}</Item>
                  <Item label={t('carriers.onboarding.decidedAt')}>{date(onboarding.decidedAt)}</Item>
                </Dl>

                {available.length > 0 ? (
                  <div className="flex w-full flex-col gap-2 border-t border-steel-100 pt-3">
                    {available.map((x) => (
                      <div key={x.action}>
                        <button
                          type="button"
                          onClick={() =>
                            NEEDS_REASON.includes(x.action) ? setPending(x.action) : run(x.action)
                          }
                          className={`w-full rounded px-3 py-2 text-sm font-semibold transition ${
                            x.danger
                              ? 'border border-danger-500 text-danger-700 hover:bg-danger-50'
                              : 'bg-navy-700 text-white hover:bg-navy-800'
                          }`}
                        >
                          {t(`carriers.onboarding.actions.${x.action}`)}
                        </button>

                        {pending === x.action ? (
                          <div className="mt-2 rounded border border-steel-200 bg-navy-50 p-3">
                            <label className="text-sm font-medium text-carbon">
                              {t('carriers.onboarding.reason')}
                              <textarea
                                autoFocus
                                rows={3}
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                className="mt-1 w-full rounded border border-steel-300 bg-white px-2.5 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
                              />
                            </label>
                            <p className="mt-1 text-xs text-steel-600">
                              {t('carriers.onboarding.reasonHint')}
                            </p>
                            <div className="mt-2 flex gap-2">
                              <button
                                type="button"
                                disabled={reason.trim() === ''}
                                onClick={() => run(x.action)}
                                className="rounded bg-navy-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {t('carriers.onboarding.confirm')}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setPending(null)
                                  setReason('')
                                }}
                                className="rounded border border-steel-300 px-3 py-1.5 text-sm transition hover:bg-white"
                              >
                                {t('carriers.onboarding.cancel')}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </Card>
          ) : null}

          {verification !== null || can.runVerification ? (
            <Card title={t('carriers.verification.title')}>
              {verification === null ? (
                <p className="text-sm text-steel-700">{t('carriers.verification.never')}</p>
              ) : (
                <div className="flex flex-col items-start gap-3">
                  <StatusBadge family="verification" value={verification.status} />

                  {verification.provider === 'mock' ? (
                    // El aviso va en la pantalla, no solo en el código: quien
                    // mire esto tiene que saber que nadie consultó a FMCSA.
                    <p className="w-full rounded border-l-4 border-safety-500 bg-safety-50 p-2.5 text-xs">
                      {t('carriers.verification.mockNotice')}
                    </p>
                  ) : null}

                  {verification.errorMessage ? (
                    <p className="text-sm text-danger-700">{verification.errorMessage}</p>
                  ) : null}

                  {verification.overrideReason ? (
                    <p className="w-full rounded border-l-4 border-safety-500 bg-safety-50 p-2.5 text-sm">
                      <strong className="block">{t('carriers.verification.overriddenAt')}</strong>
                      {verification.overrideReason}
                    </p>
                  ) : null}

                  <Dl compact className="w-full">
                    <Item label={t('carriers.verification.provider')}>{verification.provider}</Item>
                    <Item label={t('carriers.verification.attempt')}>{verification.attempt}</Item>
                    <Item label={t('carriers.detail.lastVerified')}>
                      {date(carrier.fmcsaLastVerifiedAt)}
                    </Item>
                    <Item label={t('carriers.detail.nextVerification')}>
                      {date(carrier.fmcsaNextVerificationAt)}
                    </Item>
                  </Dl>
                </div>
              )}

              <div className="mt-3 flex flex-col gap-2 border-t border-steel-100 pt-3">
                {can.runVerification ? (
                  <button
                    type="button"
                    onClick={() =>
                      router.post(`/carriers/${carrier.id}/verification`, {}, { preserveScroll: true })
                    }
                    className="rounded bg-navy-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-navy-800"
                  >
                    {t('carriers.verification.run')}
                  </button>
                ) : null}

                {can.overrideVerification ? (
                  <button
                    type="button"
                    onClick={() => setOverriding(true)}
                    className="rounded border border-steel-300 px-3 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
                  >
                    {t('carriers.verification.override')}
                  </button>
                ) : null}
              </div>

              {overriding ? <OverrideForm id={carrier.id} onClose={() => setOverriding(false)} /> : null}
            </Card>
          ) : null}
        </div>
      </div>
    </AppLayout>
  )
}

function OverrideForm({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useI18n()
  const form = useForm({ reason: '' })

  return (
    <form
      className="mt-3 rounded border border-safety-300 bg-safety-50 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        form.post(`/carriers/${id}/verification/override`, {
          preserveScroll: true,
          onSuccess: () => {
            form.reset()
            onClose()
          },
        })
      }}
    >
      <h3 className="text-sm font-semibold text-carbon">{t('carriers.verification.overrideTitle')}</h3>
      <p className="mt-1 text-xs text-steel-700">{t('carriers.verification.overrideHint')}</p>

      <label className="mt-2 block text-sm font-medium text-carbon">
        {t('carriers.verification.overrideReason')}
        <textarea
          autoFocus
          rows={3}
          required
          minLength={10}
          value={form.data.reason}
          onChange={(e) => form.setData('reason', e.target.value)}
          className="mt-1 w-full rounded border border-steel-300 bg-white px-2.5 py-2 text-sm outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-200"
        />
      </label>
      {form.errors.reason ? (
        <p role="alert" className="mt-1 text-xs font-medium text-danger-700">
          {form.errors.reason}
        </p>
      ) : null}

      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          disabled={form.processing}
          className="rounded bg-navy-700 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-40"
        >
          {t('carriers.onboarding.confirm')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-steel-300 bg-white px-3 py-1.5 text-sm transition"
        >
          {t('carriers.onboarding.cancel')}
        </button>
      </div>
    </form>
  )
}

function DeleteButton({ id }: { id: string }) {
  const { t } = useI18n()
  const [armed, setArmed] = useState(false)

  // Dos pasos y no un `confirm()` del navegador: un diálogo modal nativo
  // bloquea la página entera y no se puede traducir.
  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="rounded border border-danger-500 px-4 py-2 text-sm font-medium text-danger-700 transition hover:bg-danger-50"
      >
        {t('carriers.detail.delete')}
      </button>
    )
  }

  return (
    <span className="flex items-center gap-2 rounded border border-danger-500 bg-danger-50 px-3 py-1.5">
      <span className="max-w-xs text-xs text-carbon">{t('carriers.detail.deleteConfirm')}</span>
      <button
        type="button"
        onClick={() => router.delete(`/carriers/${id}`)}
        className="rounded bg-danger-500 px-2.5 py-1 text-xs font-semibold text-white"
      >
        {t('common.actions.confirm')}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="rounded border border-steel-300 bg-white px-2.5 py-1 text-xs"
      >
        {t('common.actions.cancel')}
      </button>
    </span>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded border border-steel-200 bg-white p-5">
      <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-safety-600">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Dl({
  children,
  compact,
  className = '',
}: {
  children: ReactNode
  compact?: boolean
  className?: string
}) {
  return (
    <dl className={`grid gap-x-6 gap-y-3 ${compact ? '' : 'sm:grid-cols-2'} ${className}`}>
      {children}
    </dl>
  )
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-steel-600">{label}</dt>
      <dd className="truncate text-sm text-carbon">{children}</dd>
    </div>
  )
}

function UnitList({ title, units }: { title: string; units: Unit[] }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wide text-steel-600">{title}</h3>
      {units.length === 0 ? (
        <p className="mt-2 text-sm text-steel-600">—</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {units.map((u) => (
            <li key={u.id} className="flex items-center gap-2 text-sm">
              <span className="font-medium text-carbon">{u.unitNumber}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-steel-600">
                {[u.year, u.make, u.model].filter(Boolean).join(' ')}
              </span>
              <StatusBadge family="equipment" value={u.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
