import { Link, router } from '@inertiajs/react'
import { useState, type ReactNode } from 'react'
import { StatusBadge } from '@/components/App/StatusBadge'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'
import { formatCents } from '@/lib/format'

interface Address {
  line1: string | null
  line2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
}

interface Customer {
  id: string
  companyName: string
  city: string | null
  state: string | null
  email: string | null
  phone: string | null
  website: string | null
  status: string
  paymentTermsDays: number | null
  creditLimitCents: number | null
  creditApproved: boolean
  creditNotes: string | null
  physical: Address
  billingSameAsPhysical: boolean
  billing: Address
  usesFactoring: boolean
  factoringCompanyName: string | null
  notes: string | null
  duplicateOverrideReason: string | null
  createdAt: string | null
}

interface Location {
  id: string
  name: string
  line1: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  timezone: string | null
  hours: string | null
  isPrimary: boolean
}

interface Contact {
  id: string
  name: string
  email: string | null
  phone: string | null
  position: string | null
  isPrimary: boolean
}

interface LoadRow {
  id: string
  loadNumber: string
  status: string
  commodity: string | null
  plannedPickupAt: string | null
  chargeCents: number
}

interface Props {
  customer: Customer
  locations: Location[]
  contacts: Contact[]
  loads: LoadRow[] | null
  can: { update: boolean; delete: boolean }
}

const STATUS_TONE: Record<string, string> = {
  active: 'bg-success-50 text-success-700 ring-success-500/40',
  inactive: 'bg-steel-100 text-steel-800 ring-steel-300',
  on_hold: 'bg-safety-100 text-safety-800 ring-safety-500/40',
}

export default function CustomerShow({ customer, locations, contacts, loads, can }: Props) {
  const { t, locale } = useI18n()

  const date = (value: string | null): string =>
    value
      ? new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', { dateStyle: 'medium' }).format(
          new Date(value),
        )
      : '—'

  const terms =
    customer.paymentTermsDays === null
      ? '—'
      : customer.paymentTermsDays === 0
        ? t('customers.detail.paymentTermsImmediate')
        : t('customers.detail.paymentTermsDays', { days: customer.paymentTermsDays })

  return (
    <AppLayout
      title={customer.companyName}
      crumbs={[
        { label: t('customers.index.title'), href: '/customers' },
        { label: customer.companyName },
      ]}
      actions={
        <>
          {can.update ? (
            <Link
              href={`/customers/${customer.id}/edit`}
              className="rounded border border-steel-300 px-4 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
            >
              {t('customers.detail.edit')}
            </Link>
          ) : null}
          {can.delete ? <DeleteButton id={customer.id} /> : null}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
            STATUS_TONE[customer.status] ?? STATUS_TONE.inactive
          }`}
        >
          {t(`customers.status.${customer.status}`)}
        </span>
        <span className="text-sm text-steel-600">
          {terms}
          {customer.creditLimitCents !== null
            ? ` · ${formatCents(customer.creditLimitCents, locale)}`
            : ''}
        </span>
      </div>

      {customer.duplicateOverrideReason ? (
        // Se enseña porque se guardó. Un aviso de duplicado aceptado que solo
        // vive en la base de datos no ayuda a quien encuentra las dos fichas.
        <p className="mt-4 rounded border-l-4 border-safety-500 bg-safety-50 p-3 text-sm">
          <strong className="block">{t('customers.duplicate.overrideNotice')}</strong>
          {customer.duplicateOverrideReason}
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card title={t('customers.detail.identity')}>
            <Dl>
              <Item label={t('customers.detail.companyName')}>{customer.companyName}</Item>
              <Item label={t('customers.detail.website')}>{customer.website ?? '—'}</Item>
              <Item label={t('customers.detail.email')}>
                {customer.email ? (
                  <a href={`mailto:${customer.email}`} className="text-navy-700 hover:underline">
                    {customer.email}
                  </a>
                ) : (
                  '—'
                )}
              </Item>
              <Item label={t('customers.detail.phone')}>{customer.phone ?? '—'}</Item>
              <Item label={t('customers.detail.createdAt')}>{date(customer.createdAt)}</Item>
            </Dl>
          </Card>

          <div className="grid gap-6 sm:grid-cols-2">
            <Card title={t('customers.detail.address')}>
              <AddressBlock address={customer.physical} />
            </Card>
            <Card title={t('customers.detail.billing')}>
              {customer.billingSameAsPhysical ? (
                <p className="text-sm text-steel-700">{t('customers.detail.billingSame')}</p>
              ) : (
                <AddressBlock address={customer.billing} />
              )}
            </Card>
          </div>

          <Card title={t('customers.detail.locations')}>
            {locations.length === 0 ? (
              <p className="text-sm text-steel-700">{t('customers.detail.noLocations')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-steel-100">
                {locations.map((l) => (
                  <li key={l.id} className="py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-carbon">{l.name}</span>
                      {l.isPrimary ? (
                        <span className="rounded-full bg-navy-100 px-2 py-0.5 text-[11px] font-medium text-navy-800">
                          {t('customers.detail.primary')}
                        </span>
                      ) : null}
                    </div>
                    <span className="block text-xs text-steel-600">
                      {[l.line1, l.city, l.state, l.postalCode].filter(Boolean).join(', ')}
                    </span>
                    {l.hours ? (
                      <span className="block text-xs text-steel-600">
                        {t('customers.detail.hours')}: {l.hours}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t('customers.detail.contacts')}>
            {contacts.length === 0 ? (
              <p className="text-sm text-steel-700">{t('customers.detail.noContacts')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-steel-100">
                {contacts.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                    <span className="font-medium text-carbon">{k.name}</span>
                    {k.position ? (
                      <span className="text-xs text-steel-600">{k.position}</span>
                    ) : null}
                    <span className="ml-auto text-xs text-steel-600">{k.email ?? k.phone ?? ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {loads ? (
            <Card title={t('customers.detail.loads')}>
              {loads.length === 0 ? (
                <p className="text-sm text-steel-700">{t('customers.detail.noLoads')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-steel-100">
                  {loads.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                      <span className="font-medium tabular-nums text-carbon">{l.loadNumber}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-steel-600">
                        {l.commodity} · {date(l.plannedPickupAt)}
                      </span>
                      <span className="tabular-nums text-steel-700">
                        {formatCents(l.chargeCents, locale)}
                      </span>
                      <StatusBadge family="load" value={l.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          <Card title={t('customers.detail.notes')}>
            <p className="whitespace-pre-wrap text-sm text-carbon">
              {customer.notes ?? t('customers.detail.noNotes')}
            </p>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card title={t('customers.detail.commercial')}>
            <Dl compact>
              <Item label={t('customers.detail.paymentTerms')}>{terms}</Item>
              <Item label={t('customers.detail.creditLimit')}>
                {customer.creditLimitCents === null
                  ? t('customers.detail.noCreditLimit')
                  : formatCents(customer.creditLimitCents, locale)}
              </Item>
              <Item label={t('customers.detail.creditApproved')}>
                {customer.creditApproved ? t('common.labels.yes') : t('common.labels.no')}
              </Item>
              <Item label={t('customers.detail.factoring')}>
                {customer.usesFactoring ? t('common.labels.yes') : t('common.labels.no')}
              </Item>
              {customer.usesFactoring ? (
                <Item label={t('customers.detail.factoringCompany')}>
                  {customer.factoringCompanyName ?? '—'}
                </Item>
              ) : null}
            </Dl>

            {customer.creditNotes ? (
              <p className="mt-3 border-t border-steel-100 pt-3 text-sm text-carbon">
                <strong className="block text-xs text-steel-600">
                  {t('customers.detail.creditNotes')}
                </strong>
                {customer.creditNotes}
              </p>
            ) : null}
          </Card>
        </div>
      </div>
    </AppLayout>
  )
}

function AddressBlock({ address }: { address: Address }) {
  if (!address.line1) {
    return <p className="text-sm text-steel-700">—</p>
  }

  return (
    <address className="not-italic text-sm text-carbon">
      {address.line1}
      {address.line2 ? (
        <>
          <br />
          {address.line2}
        </>
      ) : null}
      <br />
      {[address.city, address.state].filter(Boolean).join(', ')} {address.postalCode}
    </address>
  )
}

function DeleteButton({ id }: { id: string }) {
  const { t } = useI18n()
  const [armed, setArmed] = useState(false)

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="rounded border border-danger-500 px-4 py-2 text-sm font-medium text-danger-700 transition hover:bg-danger-50"
      >
        {t('customers.detail.delete')}
      </button>
    )
  }

  return (
    <span className="flex items-center gap-2 rounded border border-danger-500 bg-danger-50 px-3 py-1.5">
      <span className="max-w-xs text-xs text-carbon">{t('customers.detail.deleteConfirm')}</span>
      <button
        type="button"
        onClick={() => router.delete(`/customers/${id}`)}
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

function Dl({ children, compact }: { children: ReactNode; compact?: boolean }) {
  return <dl className={`grid gap-x-6 gap-y-3 ${compact ? '' : 'sm:grid-cols-2'}`}>{children}</dl>
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-steel-600">{label}</dt>
      <dd className="truncate text-sm text-carbon">{children}</dd>
    </div>
  )
}
