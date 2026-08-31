import { Link } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Row {
  id: string
  number: string
  status: string | null
  isOversize: boolean
  isOverweight: boolean
  permitsIssued: number
  permitsPending: number
  oversizeValidatedAt: string | null
  permitReadyAt: string | null
}

interface Props {
  loads: Row[]
  can: { manage: boolean; rules: boolean }
}

/**
 * Las cargas con papeles pendientes.
 *
 * Solo salen las marcadas como sobredimensionadas o con sobrepeso, y esas
 * marcas las pone la evaluación — así que una carga ancha que nadie ha evaluado
 * todavía NO aparece aquí. Es deliberado: esta pantalla contesta «de lo que ya
 * sé que es especial, ¿qué me falta?», y prometer que encuentra sola las cargas
 * que nadie ha medido sería prometer algo que ningún dato sostiene.
 */
export default function PermitsIndex({ loads }: Props) {
  const { t } = useI18n()

  return (
    <AppLayout
      title={t('oversize.index.title')}
      description={t('oversize.index.description')}
      crumbs={[{ label: t('oversize.index.title') }]}
    >
      <div className="flex flex-col gap-4">
        <p className="rounded border border-steel-200 bg-steel-50 p-3 text-xs text-steel-700">
          {t('oversize.disclaimer.body')}
        </p>

        {loads.length === 0 ? (
          <p className="text-sm text-steel-600">{t('oversize.index.empty')}</p>
        ) : (
          <div className="overflow-x-auto rounded border border-steel-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-steel-50 text-xs uppercase tracking-wide text-steel-600">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{t('oversize.index.loadColumn')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('oversize.index.flagsColumn')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('oversize.index.permitsColumn')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('oversize.index.validationColumn')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('oversize.index.readyColumn')}</th>
                  <th className="px-4 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-steel-100">
                {loads.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2.5 text-carbon">{l.number}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {l.isOversize ? <Marca tono="warning">{t('oversize.outcome.oversize')}</Marca> : null}
                        {l.isOverweight ? <Marca tono="warning">{t('oversize.outcome.overweight')}</Marca> : null}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-steel-700">
                      {l.permitsIssued === 0 && l.permitsPending === 0
                        ? t('oversize.index.none')
                        : [
                            l.permitsIssued > 0
                              ? t('oversize.index.issuedCount', { n: String(l.permitsIssued) })
                              : null,
                            l.permitsPending > 0
                              ? t('oversize.index.pendingCount', { n: String(l.permitsPending) })
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                    </td>
                    <td className="px-4 py-2.5">
                      {l.oversizeValidatedAt === null ? (
                        <Marca tono="steel">{t('oversize.validation.status.pending')}</Marca>
                      ) : (
                        <Marca tono="success">{t('oversize.validation.status.validated')}</Marca>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {l.permitReadyAt === null ? (
                        <span className="text-xs text-steel-600">{t('oversize.readiness.notApproved')}</span>
                      ) : (
                        <Marca tono="success">{l.permitReadyAt}</Marca>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        href={`/loads/${l.id}/permits`}
                        className="text-sm font-medium text-navy-700 hover:underline"
                      >
                        {t('oversize.index.open')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}

export function Marca({ tono, children }: { tono: 'success' | 'warning' | 'danger' | 'steel'; children: React.ReactNode }) {
  const clases: Record<string, string> = {
    success: 'bg-success-50 text-success-700',
    warning: 'bg-warning-50 text-warning-700',
    danger: 'bg-danger-50 text-danger-700',
    steel: 'bg-steel-100 text-steel-700',
  }

  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${clases[tono]}`}>
      {children}
    </span>
  )
}
