import { Link, router } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Props {
  company: {
    id: string
    name: string
    website: string | null
    addressLine1: string | null
    addressCity: string | null
    addressState: string | null
    addressPostalCode: string | null
    fundingInstructions: string | null
    active: boolean
    contacts: {
      id: string
      first_name: string
      last_name: string
      email: string | null
      phone: string | null
      position: string
      notes: string | null
    }[]
  }
  carriers: { id: string; name: string; dot: string; status: string }[]
  can: { manage: boolean }
}

export default function FactoringShow({ company, carriers, can }: Props) {
  const { t } = useI18n()

  const region = [company.addressCity, company.addressState].filter(Boolean).join(', ')
  const linea3 = [region, company.addressPostalCode].filter(Boolean).join(' ')

  return (
    <AppLayout
      title={company.name}
      crumbs={[{ label: t('factoring.index.title'), href: '/factoring' }, { label: company.name }]}
      actions={
        can.manage ? (
          <div className="flex gap-2">
            <Link
              href={`/factoring/${company.id}/edit`}
              className="rounded border border-navy-700 px-4 py-2 text-sm font-semibold text-navy-700 transition hover:bg-navy-50"
            >
              {t('factoring.detail.edit')}
            </Link>
            <button
              type="button"
              onClick={() => router.delete(`/factoring/${company.id}`)}
              className="rounded border border-danger-300 px-4 py-2 text-sm font-semibold text-danger-700 transition hover:bg-danger-50"
            >
              {t('factoring.detail.delete')}
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded border border-steel-200 bg-white p-5">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
              company.active
                ? 'bg-success-50 text-success-700 ring-success-500/40'
                : 'bg-steel-100 text-steel-700 ring-steel-300'
            }`}
          >
            {t(`factoring.status.${company.active ? 'active' : 'inactive'}`)}
          </span>

          <address className="mt-4 not-italic text-sm text-steel-700">
            {company.addressLine1 ? <span className="block">{company.addressLine1}</span> : null}
            {linea3 !== '' ? <span className="block">{linea3}</span> : null}
          </address>

          {company.website ? (
            <p className="mt-3 text-sm">
              <span className="block text-xs uppercase tracking-wide text-steel-600">
                {t('factoring.detail.website')}
              </span>
              <a
                href={company.website}
                target="_blank"
                rel="noreferrer"
                className="text-navy-700 hover:underline"
              >
                {company.website.replace(/^https?:\/\//, '')}
              </a>
            </p>
          ) : null}

          {company.fundingInstructions ? (
            <div className="mt-4">
              <h2 className="uppercase-heading text-xs text-steel-600">
                {t('factoring.detail.fundingInstructions')}
              </h2>
              <p className="mt-2 whitespace-pre-line text-sm text-steel-700">
                {company.fundingInstructions}
              </p>
            </div>
          ) : null}

          <Link href="/factoring" className="mt-5 inline-block text-sm text-navy-700 hover:underline">
            ← {t('factoring.detail.back')}
          </Link>
        </section>

        <section className="rounded border border-steel-200 bg-white p-5 lg:col-span-2">
          <h2 className="uppercase-heading text-xs text-steel-600">{t('factoring.detail.contacts')}</h2>

          {company.contacts.length === 0 ? (
            <p className="mt-4 text-sm text-steel-700">{t('factoring.detail.noContacts')}</p>
          ) : (
            <ul className="mt-4 flex flex-col divide-y divide-steel-100">
              {company.contacts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
                  <span className="font-medium text-navy-700">
                    {c.first_name} {c.last_name}
                  </span>
                  <span className="rounded-full bg-navy-50 px-2 py-0.5 text-xs font-medium text-navy-800">
                    {t(`factoring.positions.${c.position}`)}
                  </span>
                  {c.email ? (
                    <a href={`mailto:${c.email}`} className="text-sm text-steel-700 hover:underline">
                      {c.email}
                    </a>
                  ) : null}
                  {c.phone ? (
                    <a
                      href={`tel:${c.phone.replace(/[^+\d]/g, '')}`}
                      className="text-sm text-steel-700 hover:underline"
                    >
                      {c.phone}
                    </a>
                  ) : null}
                  {c.notes ? <span className="w-full text-xs text-steel-600">{c.notes}</span> : null}
                </li>
              ))}
            </ul>
          )}

          <h2 className="uppercase-heading mt-8 text-xs text-steel-600">
            {t('factoring.detail.carriers')}
          </h2>

          {carriers.length === 0 ? (
            <p className="mt-4 text-sm text-steel-700">{t('factoring.detail.noCarriers')}</p>
          ) : (
            <ul className="mt-4 flex flex-col divide-y divide-steel-100">
              {carriers.map((c) => (
                <li key={c.id} className="flex flex-wrap items-baseline gap-x-4 py-2.5 text-sm">
                  <Link href={`/carriers/${c.id}`} className="font-medium text-navy-700 hover:underline">
                    {c.name}
                  </Link>
                  <span className="tabular-nums text-steel-600">
                    {t('factoring.detail.dot')} {c.dot}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppLayout>
  )
}
