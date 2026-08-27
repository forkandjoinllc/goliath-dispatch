import { Link, useForm } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Contact {
  id?: string
  first_name: string
  last_name: string
  email: string
  phone: string
  position: string
  notes: string
}

interface Company {
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

interface Props {
  company: Company | null
  positions: string[]
}

const VACIO: Contact = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  position: 'account_manager',
  notes: '',
}

export default function FactoringForm({ company, positions }: Props) {
  const { t } = useI18n()

  const form = useForm({
    name: company?.name ?? '',
    website: company?.website ?? '',
    address_line1: company?.addressLine1 ?? '',
    address_city: company?.addressCity ?? '',
    address_state: company?.addressState ?? '',
    address_postal_code: company?.addressPostalCode ?? '',
    funding_instructions: company?.fundingInstructions ?? '',
    active: company?.active ?? true,
    contacts: (company?.contacts ?? []).map(
      (c): Contact => ({
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        email: c.email ?? '',
        phone: c.phone ?? '',
        position: c.position,
        notes: c.notes ?? '',
      }),
    ),
  })

  const setContact = (index: number, patch: Partial<Contact>) => {
    form.setData(
      'contacts',
      form.data.contacts.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    )
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()

    if (company === null) {
      form.post('/factoring')

      return
    }

    form.transform((data) => data).patch(`/factoring/${company.id}`)
  }

  return (
    <AppLayout
      title={t(company === null ? 'factoring.form.createTitle' : 'factoring.form.editTitle')}
      crumbs={[
        { label: t('factoring.index.title'), href: '/factoring' },
        { label: t(company === null ? 'factoring.form.createTitle' : 'factoring.form.editTitle') },
      ]}
    >
      <form onSubmit={submit} className="flex max-w-3xl flex-col gap-8">
        <section className="rounded border border-steel-200 bg-white p-5">
          <h2 className="uppercase-heading text-xs text-steel-600">{t('factoring.form.companyHeading')}</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label={t('factoring.form.name')} error={form.errors.name} required>
              <input
                value={form.data.name}
                onChange={(e) => form.setData('name', e.target.value)}
                className={input}
              />
            </Field>

            <Field label={t('factoring.form.website')} error={form.errors.website}>
              <input
                type="url"
                placeholder="https://"
                value={form.data.website}
                onChange={(e) => form.setData('website', e.target.value)}
                className={input}
              />
            </Field>
          </div>

          <label className="mt-4 flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={form.data.active}
              onChange={(e) => form.setData('active', e.target.checked)}
              className="mt-0.5 size-4 rounded border-steel-400 text-navy-700 focus:ring-navy-500"
            />
            <span>
              <span className="font-medium">{t('factoring.form.active')}</span>
              <span className="block text-xs text-steel-600">{t('factoring.form.activeHint')}</span>
            </span>
          </label>
        </section>

        <section className="rounded border border-steel-200 bg-white p-5">
          <h2 className="uppercase-heading text-xs text-steel-600">{t('factoring.form.addressHeading')}</h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label={t('factoring.form.addressLine1')} error={form.errors.address_line1}>
                <input
                  value={form.data.address_line1}
                  onChange={(e) => form.setData('address_line1', e.target.value)}
                  className={input}
                />
              </Field>
            </div>

            <Field label={t('factoring.form.addressCity')} error={form.errors.address_city}>
              <input
                value={form.data.address_city}
                onChange={(e) => form.setData('address_city', e.target.value)}
                className={input}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label={t('factoring.form.addressState')} error={form.errors.address_state}>
                <input
                  maxLength={2}
                  value={form.data.address_state}
                  onChange={(e) => form.setData('address_state', e.target.value.toUpperCase())}
                  className={input}
                />
              </Field>

              <Field label={t('factoring.form.addressPostalCode')} error={form.errors.address_postal_code}>
                <input
                  value={form.data.address_postal_code}
                  onChange={(e) => form.setData('address_postal_code', e.target.value)}
                  className={input}
                />
              </Field>
            </div>

            <div className="sm:col-span-2">
              <Field
                label={t('factoring.form.fundingInstructions')}
                error={form.errors.funding_instructions}
              >
                <textarea
                  rows={3}
                  value={form.data.funding_instructions}
                  onChange={(e) => form.setData('funding_instructions', e.target.value)}
                  className={input}
                />
              </Field>
            </div>
          </div>
        </section>

        <section className="rounded border border-steel-200 bg-white p-5">
          <h2 className="uppercase-heading text-xs text-steel-600">{t('factoring.form.contactsHeading')}</h2>
          <p className="mt-1 text-xs text-steel-600">{t('factoring.form.contactsHint')}</p>

          {form.data.contacts.length === 0 ? (
            <p className="mt-4 text-sm text-steel-700">{t('factoring.form.noContacts')}</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-5">
              {form.data.contacts.map((contact, index) => (
                <li key={contact.id ?? `nuevo-${index}`} className="rounded border border-steel-200 p-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label={t('factoring.form.firstName')}
                      error={form.errors[`contacts.${index}.first_name` as never]}
                      required
                    >
                      <input
                        value={contact.first_name}
                        onChange={(e) => setContact(index, { first_name: e.target.value })}
                        className={input}
                      />
                    </Field>

                    <Field
                      label={t('factoring.form.lastName')}
                      error={form.errors[`contacts.${index}.last_name` as never]}
                      required
                    >
                      <input
                        value={contact.last_name}
                        onChange={(e) => setContact(index, { last_name: e.target.value })}
                        className={input}
                      />
                    </Field>

                    <Field
                      label={t('factoring.form.email')}
                      error={form.errors[`contacts.${index}.email` as never]}
                    >
                      <input
                        type="email"
                        value={contact.email}
                        onChange={(e) => setContact(index, { email: e.target.value })}
                        className={input}
                      />
                    </Field>

                    <Field
                      label={t('factoring.form.phone')}
                      error={form.errors[`contacts.${index}.phone` as never]}
                    >
                      <input
                        value={contact.phone}
                        onChange={(e) => setContact(index, { phone: e.target.value })}
                        className={input}
                      />
                    </Field>

                    <Field
                      label={t('factoring.form.position')}
                      error={form.errors[`contacts.${index}.position` as never]}
                      required
                    >
                      <select
                        value={contact.position}
                        onChange={(e) => setContact(index, { position: e.target.value })}
                        className={input}
                      >
                        {positions.map((p) => (
                          <option key={p} value={p}>
                            {t(`factoring.positions.${p}`)}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() =>
                          form.setData(
                            'contacts',
                            form.data.contacts.filter((_, i) => i !== index),
                          )
                        }
                        className="rounded border border-danger-300 px-3 py-2 text-sm font-medium text-danger-700 transition hover:bg-danger-50"
                      >
                        {t('factoring.form.removeContact')}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => form.setData('contacts', [...form.data.contacts, { ...VACIO }])}
            className="mt-4 rounded border border-navy-700 px-4 py-2 text-sm font-semibold text-navy-700 transition hover:bg-navy-50"
          >
            {t('factoring.form.addContact')}
          </button>
        </section>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={form.processing}
            className="rounded bg-navy-700 px-5 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:bg-steel-300"
          >
            {t('factoring.form.save')}
          </button>

          <Link
            href={company === null ? '/factoring' : `/factoring/${company.id}`}
            className="rounded border border-steel-300 px-5 py-2 text-sm text-navy-700 transition hover:bg-navy-50"
          >
            {t('factoring.form.cancel')}
          </Link>
        </div>
      </form>
    </AppLayout>
  )
}

const input =
  'w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200'

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string
  error?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wide text-steel-700">
        {label}
        {required ? <span className="ml-0.5 text-danger-600">*</span> : null}
      </span>
      <span className="mt-1 block">{children}</span>
      {error ? <span className="mt-1 block text-xs text-danger-700">{error}</span> : null}
    </label>
  )
}
