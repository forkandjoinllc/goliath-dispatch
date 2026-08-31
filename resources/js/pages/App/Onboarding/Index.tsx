import { Link } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Firma {
  id: string
  status: string
  requestedAt: string
  firstViewedAt: string | null
}

interface Fila {
  id: string
  name: string
  dot: string | null
  mc: string | null
  status: string
  submittedAt: string | null
  correctionNotes: string | null
  rejectionReason: string | null
  suspensionReason: string | null
  waitingSince: string | null
  blocking: string[]
  warnings: string[]
  missingDocuments: string[]
  requiredDocuments: string[]
  approvedDocuments: string[]
  signature: Firma | null
  fmcsaCheckedAt: string | null
  canHaul: boolean
}

interface Props {
  carriers: Fila[]
  blockedApproved: Fila[]
  filters: { status: string }
  statuses: string[]
  counts: Record<string, number>
  can: { review: boolean; approve: boolean }
}

/**
 * La cola de incorporación.
 *
 * Dos cosas separadas a propósito: lo que BLOQUEA —falta un documento, la
 * incorporación no está aprobada— y lo que AVISA, como una verificación de
 * FMCSA fuera de plazo. Mezclarlas haría que un aviso pareciera una puerta
 * cerrada, o peor, que una puerta cerrada pareciera un aviso.
 *
 * Y arriba del todo, la sección que no existía en ningún sitio: los aprobados
 * que aun así no pueden llevar carga. Siguen en «aprobado», así que ninguna
 * lista por estado los enseña.
 */
export default function OnboardingIndex({
  carriers, blockedApproved, filters, statuses, counts,
}: Props) {
  const { t } = useI18n()

  return (
    <AppLayout
      title={t('onboarding.queue.title')}
      description={t('onboarding.queue.description')}
      crumbs={[{ label: t('onboarding.queue.title') }]}
    >
      <div className="flex flex-col gap-4">
        {blockedApproved.length > 0 ? (
          <section className="rounded border border-danger-300 bg-danger-50 p-4">
            <p className="text-sm font-semibold text-carbon">{t('onboarding.queue.blockedTitle')}</p>
            <p className="mt-0.5 text-xs text-carbon">{t('onboarding.queue.blockedDescription')}</p>
            <ul className="mt-3 flex flex-col gap-2">
              {blockedApproved.map((c) => (
                <li key={c.id} className="rounded border border-danger-300 bg-white p-3">
                  <Cabecera fila={c} />
                  <Faltantes fila={c} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Filtro activo={filters.status === ''} href="/onboarding">
            {t('onboarding.queue.all')}
          </Filtro>
          {statuses.map((s) => (
            <Filtro key={s} activo={filters.status === s} href={`/onboarding?status=${s}`}>
              {t(`onboarding.status.${s === 'corrections_required' ? 'corrections_required' : s}`)}
              {counts[s] !== undefined ? ` (${counts[s]})` : ''}
            </Filtro>
          ))}
        </div>

        {carriers.length === 0 ? (
          <p className="text-sm text-steel-600">{t('onboarding.queue.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {carriers.map((c) => (
              <li key={c.id} className="rounded border border-steel-200 bg-white p-4">
                <Cabecera fila={c} />

                <p className="mt-1 text-xs text-steel-600">
                  {t(`onboarding.statusDescription.${c.status}`)}
                </p>

                {c.correctionNotes ? (
                  <p className="mt-2 rounded border border-warning-300 bg-warning-50 p-2 text-sm text-carbon">
                    {c.correctionNotes}
                  </p>
                ) : null}
                {c.rejectionReason ? (
                  <p className="mt-2 rounded border border-danger-300 bg-danger-50 p-2 text-sm text-carbon">
                    {c.rejectionReason}
                  </p>
                ) : null}
                {c.suspensionReason ? (
                  <p className="mt-2 rounded border border-steel-300 bg-steel-50 p-2 text-sm text-carbon">
                    {c.suspensionReason}
                  </p>
                ) : null}

                <Faltantes fila={c} />
                <Lista fila={c} />
                <Avisos fila={c} />
                <Acuerdo fila={c} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppLayout>
  )
}

function Cabecera({ fila }: { fila: Fila }) {
  const { t } = useI18n()

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-carbon">{fila.name}</span>
          <Marca tono={tonoDeEstado(fila.status)}>{t(`onboarding.status.${fila.status}`)}</Marca>
          <Marca tono={fila.canHaul ? 'success' : 'danger'}>
            {fila.canHaul ? t('onboarding.queue.canHaul') : t('onboarding.queue.cannotHaul')}
          </Marca>
        </div>
        <p className="mt-0.5 text-xs text-steel-600">
          {[fila.dot ? `USDOT ${fila.dot}` : null, fila.mc ? `MC ${fila.mc}` : null]
            .filter(Boolean)
            .join(' · ')}
          {fila.waitingSince ? ` · ${t('onboarding.queue.waitingColumn')}: ${fila.waitingSince}` : ''}
        </p>
      </div>

      <Link
        href={`/carriers/${fila.id}`}
        className="shrink-0 text-sm font-medium text-navy-700 hover:underline"
      >
        {t('onboarding.queue.open')}
      </Link>
    </div>
  )
}

function Faltantes({ fila }: { fila: Fila }) {
  const { t } = useI18n()

  if (fila.blocking.length === 0 && fila.missingDocuments.length === 0) {
    return null
  }

  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {fila.blocking.map((b) => (
        <li key={b} className="rounded bg-danger-50 px-2 py-1 text-xs text-danger-700">
          {t(`onboarding.blocking.${b}`)}
        </li>
      ))}
      {fila.missingDocuments.map((d) => (
        <li key={d} className="rounded bg-danger-50 px-2 py-1 text-xs text-danger-700">
          {t(`onboarding.checklist.${d}`)}
        </li>
      ))}
    </ul>
  )
}

function Lista({ fila }: { fila: Fila }) {
  const { t } = useI18n()

  return (
    <div className="mt-3 border-t border-steel-100 pt-2">
      <p className="text-xs font-medium uppercase tracking-wide text-steel-600">
        {t('onboarding.checklist.title')}
      </p>
      <ul className="mt-1 flex flex-wrap gap-2">
        {fila.requiredDocuments.map((d) => {
          const tiene = fila.approvedDocuments.includes(d)

          return (
            <li
              key={d}
              className={`rounded border px-2 py-1 text-xs ${
                tiene ? 'border-success-500 text-success-700' : 'border-steel-300 text-steel-700'
              }`}
            >
              {tiene ? '✓ ' : '· '}
              {t(`onboarding.checklist.${d}`)}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Avisos({ fila }: { fila: Fila }) {
  const { t } = useI18n()

  if (fila.warnings.length === 0) {
    return null
  }

  return (
    <div className="mt-3 border-t border-steel-100 pt-2">
      <p className="text-xs font-medium uppercase tracking-wide text-steel-600">
        {t('onboarding.queue.warningsTitle')}
      </p>
      <p className="text-[11px] text-steel-500">{t('onboarding.queue.warningsHint')}</p>
      <ul className="mt-1 flex flex-wrap gap-2">
        {fila.warnings.map((w) => (
          <li key={w} className="rounded bg-warning-50 px-2 py-1 text-xs text-warning-700">
            {t(`onboarding.warnings.${w}`)}
            {w === 'fmcsaStale' && fila.fmcsaCheckedAt !== null ? ` · ${fila.fmcsaCheckedAt}` : ''}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Acuerdo({ fila }: { fila: Fila }) {
  const { t } = useI18n()

  return (
    <div className="mt-3 border-t border-steel-100 pt-2">
      <p className="text-xs font-medium uppercase tracking-wide text-steel-600">
        {t('onboarding.signature.title')}
      </p>
      {fila.signature === null ? (
        <p className="text-xs text-steel-600">{t('onboarding.signature.none')}</p>
      ) : (
        <p className="text-xs text-steel-700">
          <Link
            href={`/signatures/${fila.signature.id}`}
            className="font-medium text-navy-700 hover:underline"
          >
            {t(`signature.statuses.${fila.signature.status}`)}
          </Link>
          {' · '}
          {t('onboarding.signature.sentAt', { date: fila.signature.requestedAt })}
          {fila.signature.firstViewedAt !== null
            ? ` · ${t('onboarding.signature.viewedAt', { date: fila.signature.firstViewedAt })}`
            : ''}
        </p>
      )}
    </div>
  )
}

function tonoDeEstado(status: string): 'success' | 'warning' | 'danger' | 'steel' | 'navy' {
  return (
    {
      approved: 'success',
      submitted: 'navy',
      under_review: 'navy',
      corrections_required: 'warning',
      rejected: 'danger',
      suspended: 'danger',
      draft: 'steel',
    } as Record<string, 'success' | 'warning' | 'danger' | 'steel' | 'navy'>
  )[status] ?? 'steel'
}

function Marca({
  tono, children,
}: { tono: 'success' | 'warning' | 'danger' | 'steel' | 'navy'; children: React.ReactNode }) {
  const clases: Record<string, string> = {
    success: 'bg-success-50 text-success-700',
    warning: 'bg-warning-50 text-warning-700',
    danger: 'bg-danger-50 text-danger-700',
    steel: 'bg-steel-100 text-steel-700',
    navy: 'bg-navy-50 text-navy-700',
  }

  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${clases[tono]}`}>
      {children}
    </span>
  )
}

function Filtro({ activo, href, children }: { activo: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded border px-3 py-1.5 text-sm transition ${
        activo
          ? 'border-navy-600 bg-navy-50 font-medium text-navy-800'
          : 'border-steel-300 bg-white text-steel-700 hover:bg-steel-50'
      }`}
    >
      {children}
    </Link>
  )
}
