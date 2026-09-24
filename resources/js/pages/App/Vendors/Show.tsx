import { Link, router } from '@inertiajs/react'
import { useState, type ReactNode } from 'react'
import { Modal } from '@/components/App/Modal'
import { AppLayout } from '@/layouts/AppLayout'
import { formatCents } from '@/lib/format'
import { useI18n } from '@/lib/i18n'

interface Contacto {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  phoneExtension: string | null
  position: string | null
  isPrimary: boolean
  notes: string | null
}

interface Unidad {
  id: string
  kind: 'truck' | 'trailer'
  unitNumber: string
  ownership: string | null
  leaseEndsOn: string | null
  status: string
}

interface Props {
  vendor: {
    id: string
    companyName: string
    vendorType: string
    phone: string | null
    email: string | null
    website: string | null
    line1: string | null
    line2: string | null
    city: string | null
    state: string | null
    country: string | null
    postalCode: string | null
    taxIdLast4: string | null
    w9OnFile: boolean
    w9ReceivedOn: string | null
    paymentTermsDays: number
    paymentMethod: string | null
    accountLast4: string | null
    status: string
    notes: string | null
    createdAt: string | null
  }
  contacts: Contacto[]
  carriers: { id: string; name: string; accountReference: string | null }[]
  leased: Unidad[]
  expenses: {
    rows: { id: string; amountCents: number; description: string | null; incurredOn: string | null; status: string }[]
    totalCents: number
    count: number
  } | null
  can: { update: boolean; delete: boolean }
}

/**
 * La ficha del proveedor.
 *
 * ## Lo que esta pantalla contesta y antes no se podía preguntar
 *
 * «¿Qué me arrienda esta empresa y cuándo vence cada contrato?». Sale de las
 * unidades que APUNTAN a esta ficha, no de un nombre parecido: mientras el
 * arrendador fue texto libre, la misma empresa estaba escrita de tres formas y
 * la pregunta no tenía respuesta.
 *
 * Lo que vence antes va primero, y lo que no tiene fecha al final: son los
 * contratos abiertos, y no son los que hay que mirar hoy.
 */
export default function VendorShow({ vendor, contacts, carriers, leased, expenses, can }: Props) {
  const { t, locale } = useI18n()
  const [retirando, setRetirando] = useState(false)

  const direccion = [
    vendor.line1,
    vendor.line2,
    [vendor.city, vendor.state].filter((v) => v !== null && v !== '').join(', '),
    vendor.postalCode,
  ].filter((v) => v !== null && v !== '')

  return (
    <AppLayout
      title={vendor.companyName}
      description={t(`vendors.type.${vendor.vendorType}`)}
      crumbs={[{ label: t('vendors.index.title'), href: '/vendors' }, { label: vendor.companyName }]}
      actions={
        <div className="flex flex-wrap gap-2">
          {can.update ? (
            <Link
              href={`/vendors/${vendor.id}/edit`}
              className="rounded border border-steel-300 bg-white px-3 py-1.5 text-sm font-semibold text-navy-800 transition hover:bg-navy-50"
            >
              {t('vendors.detail.edit')}
            </Link>
          ) : null}
          {can.delete ? (
            <button
              type="button"
              onClick={() => setRetirando(true)}
              className="rounded border border-safety-300 bg-white px-3 py-1.5 text-sm font-semibold text-safety-700 transition hover:bg-safety-50"
            >
              {t('vendors.detail.delete')}
            </button>
          ) : null}
        </div>
      }
    >
      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex flex-col gap-6">
          <Tarjeta titulo={t('vendors.form.identity')}>
            <Datos
              filas={[
                [t('common.labels.phone'), vendor.phone],
                [t('common.labels.email'), vendor.email],
                [t('vendors.form.website'), vendor.website],
                [t('common.labels.address'), direccion.length === 0 ? null : direccion.join(' · ')],
                [t('common.labels.status'), t(`vendors.status.${vendor.status}`)],
                [t('vendors.detail.onFileSince'), vendor.createdAt],
              ]}
            />
          </Tarjeta>

          <Tarjeta titulo={t('vendors.form.money')}>
            <Datos
              filas={[
                [
                  t('vendors.detail.terms'),
                  t('vendors.detail.termsDays', { n: vendor.paymentTermsDays }),
                ],
                [
                  t('vendors.form.paymentMethod'),
                  vendor.paymentMethod === null ? null : t(`vendors.paymentMethod.${vendor.paymentMethod}`),
                ],
                [
                  t('vendors.form.accountLast4'),
                  vendor.accountLast4 === null ? null : `•••• ${vendor.accountLast4}`,
                ],
                [
                  // Nunca el identificador entero. Ver `VendorController`.
                  t('vendors.detail.taxId'),
                  vendor.taxIdLast4 === null
                    ? null
                    : t('vendors.detail.taxIdMasked', { last4: vendor.taxIdLast4 }),
                ],
                [
                  t('vendors.detail.w9'),
                  vendor.w9OnFile
                    ? vendor.w9ReceivedOn === null
                      ? t('vendors.detail.w9YesNoDate')
                      : t('vendors.detail.w9Yes', { date: vendor.w9ReceivedOn })
                    : t('vendors.detail.w9No'),
                ],
              ]}
            />
          </Tarjeta>

          <Tarjeta titulo={t('vendors.detail.serves')}>
            {carriers.length === 0 ? (
              <Vacio texto={t('vendors.detail.noServes')} />
            ) : (
              <ul className="flex flex-col gap-2">
                {carriers.map((c) => (
                  <li key={c.id} className="text-sm">
                    <Link href={`/carriers/${c.id}`} className="font-medium text-navy-700 hover:underline">
                      {c.name}
                    </Link>
                    {c.accountReference === null ? null : (
                      <span className="ml-2 text-xs text-steel-600">
                        {t('vendors.detail.account', { reference: c.accountReference })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>
        </div>

        <div className="flex flex-col gap-6">
          <Tarjeta titulo={t('vendors.detail.contacts')}>
            {contacts.length === 0 ? (
              <Vacio texto={t('vendors.detail.noContacts')} />
            ) : (
              <ul className="flex flex-col gap-3">
                {contacts.map((c) => (
                  <li key={c.id} className="rounded border border-steel-200 p-3">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-carbon">
                      {c.firstName} {c.lastName}
                      {c.isPrimary ? (
                        <span className="rounded-full bg-navy-100 px-2 py-0.5 text-[10px] font-semibold text-navy-800">
                          {t('vendors.form.primary')}
                        </span>
                      ) : null}
                    </p>
                    {c.position === null ? null : (
                      <p className="text-xs text-steel-600">{c.position}</p>
                    )}
                    <p className="mt-1 flex flex-wrap gap-x-4 text-xs">
                      {c.phone === null ? null : (
                        <a href={`tel:${c.phone}`} className="tabular-nums text-navy-700 hover:underline">
                          {c.phone}
                          {c.phoneExtension === null ? '' : ` ·${c.phoneExtension}`}
                        </a>
                      )}
                      {c.email === null ? null : (
                        <a href={`mailto:${c.email}`} className="text-navy-700 hover:underline">
                          {c.email}
                        </a>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>

          <Tarjeta titulo={t('vendors.detail.leased')}>
            {leased.length === 0 ? (
              <Vacio texto={t('vendors.detail.noLeased')} />
            ) : (
              <ul className="flex flex-col gap-2">
                {leased.map((u) => (
                  <li
                    key={`${u.kind}-${u.id}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 rounded border border-steel-200 px-3 py-2"
                  >
                    <Link
                      href={`/equipment/${u.kind}s/${u.id}`}
                      className="font-medium tabular-nums text-navy-700 hover:underline"
                    >
                      {u.unitNumber}
                    </Link>
                    <span className="text-xs uppercase tracking-wide text-steel-600">
                      {t(`equipment.kind.${u.kind}`)}
                    </span>
                    {/* La fecha es lo que se mira en esta lista: sin ella, el
                        contrato está abierto y hay que decirlo, no dejar un
                        hueco que se lee como «no lo sé». */}
                    <span className="text-xs text-steel-700">
                      {u.leaseEndsOn === null
                        ? t('vendors.detail.leaseOpen')
                        : t('vendors.detail.leaseEndsOn', { date: u.leaseEndsOn })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>

          {expenses === null ? null : (
            <Tarjeta titulo={t('vendors.detail.expenses')}>
              {expenses.count === 0 ? (
                <Vacio texto={t('vendors.detail.noExpenses')} />
              ) : (
                <>
                  <p className="text-sm font-semibold text-navy-800">
                    {t('vendors.detail.expenseTotal', {
                      amount: formatCents(expenses.totalCents, locale),
                      n: expenses.count,
                    })}
                  </p>
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {expenses.rows.map((g) => (
                      <li key={g.id} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                        <span className="tabular-nums text-steel-600">{g.incurredOn ?? '—'}</span>
                        <span className="min-w-0 flex-1 truncate text-carbon">{g.description ?? '—'}</span>
                        <span className="tabular-nums font-medium">
                          {formatCents(g.amountCents, locale)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {expenses.count > expenses.rows.length ? (
                    <p className="mt-2 text-xs text-steel-600">{t('vendors.detail.showingRecent')}</p>
                  ) : null}
                </>
              )}
            </Tarjeta>
          )}
        </div>
      </div>

      {vendor.notes === null || vendor.notes === '' ? null : (
        <div className="mt-6">
          <Tarjeta titulo={t('vendors.form.notes')}>
            <p className="whitespace-pre-wrap text-sm text-carbon">{vendor.notes}</p>
          </Tarjeta>
        </div>
      )}

      <Modal
        open={retirando}
        title={t('vendors.detail.delete')}
        onClose={() => setRetirando(false)}
        closeLabel={t('common.actions.close')}
        footer={
          <>
            <button
              type="button"
              onClick={() => setRetirando(false)}
              className="rounded border border-steel-300 bg-white px-4 py-2 text-sm font-semibold text-navy-800 transition hover:bg-steel-100"
            >
              {t('common.actions.cancel')}
            </button>
            <button
              type="button"
              onClick={() =>
                router.delete(`/vendors/${vendor.id}`, { onFinish: () => setRetirando(false) })
              }
              className="rounded bg-safety-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-safety-800"
            >
              {t('vendors.detail.delete')}
            </button>
          </>
        }
      >
        <p className="text-sm text-carbon">{t('vendors.detail.deleteConfirm')}</p>
      </Modal>
    </AppLayout>
  )
}

function Tarjeta({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="rounded border border-steel-200 bg-white p-4">
      <h2 className="pb-3 text-xs font-bold uppercase tracking-[0.1em] text-safety-600">{titulo}</h2>
      {children}
    </section>
  )
}

/** Dos columnas. Lo que no hay se DICE, no se deja en blanco. */
function Datos({ filas }: { filas: [string, string | null][] }) {
  const { t } = useI18n()

  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      {filas.map(([clave, valor]) => (
        <div key={clave} className="contents">
          <dt className="text-steel-600">{clave}</dt>
          <dd className={valor === null || valor === '' ? 'text-steel-500' : 'break-words text-carbon'}>
            {valor === null || valor === '' ? t('common.labels.none') : valor}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function Vacio({ texto }: { texto: string }) {
  return (
    <p className="rounded border border-dashed border-steel-300 p-3 text-sm text-steel-700">{texto}</p>
  )
}
