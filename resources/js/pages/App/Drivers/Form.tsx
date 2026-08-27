import { Link, useForm } from '@inertiajs/react'
import type { ReactNode } from 'react'
import { CountryStateFields } from '@/components/Form/CountryStateFields'
import { SelectField, TextArea, TextField } from '@/components/Form/Field'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Props {
  driver: Record<string, unknown> | null
  carriers: { id: string; name: string }[]
  selectedCarriers: string[]
}

/** Los endosos de una CDL. Son cinco y no cambian. */
const ENDORSEMENTS = ['H', 'N', 'T', 'P', 'X', 'S']

export default function DriverForm({ driver, carriers, selectedCarriers }: Props) {
  const { t } = useI18n()
  const editing = driver !== null
  const g = (key: string): string => {
    const v = driver?.[key]
    return v === null || v === undefined ? '' : String(v)
  }

  const form = useForm({
    first_name: g('firstName'),
    last_name: g('lastName'),
    email: g('email'),
    phone: g('phone'),
    preferred_locale: g('preferredLocale') || 'en',
    license_country: g('licenseCountry') || 'US',
    license_state: g('licenseState'),
    // Nunca se precarga: el número no se puede leer de vuelta. Vacío significa
    // «conserva el que ya está», y el texto de ayuda lo dice.
    license_number: '',
    cdl_class: g('cdlClass'),
    endorsements: (driver?.endorsements as string[]) ?? [],
    restrictions: (driver?.restrictions as string[]) ?? [],
    license_expires_at: String(driver?.licenseExpiresAt ?? '').slice(0, 10),
    medical_card_expires_at: String(driver?.medicalCardExpiresAt ?? '').slice(0, 10),
    status: g('status') || 'available',
    notes: g('notes'),
    carrier_ids: selectedCarriers,
  })

  const toggleCarrier = (id: string) => {
    const next = form.data.carrier_ids.includes(id)
      ? form.data.carrier_ids.filter((c) => c !== id)
      : [...form.data.carrier_ids, id]

    form.setData('carrier_ids', next)
  }

  const toggleEndorsement = (code: string) => {
    const next = form.data.endorsements.includes(code)
      ? form.data.endorsements.filter((e) => e !== code)
      : [...form.data.endorsements, code]

    form.setData('endorsements', next)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editing) form.patch(`/drivers/${String(driver?.id)}`)
    else form.post('/drivers')
  }

  return (
    <AppLayout
      title={t(editing ? 'drivers.form.editTitle' : 'drivers.form.createTitle')}
      description={t(editing ? 'drivers.form.editSubtitle' : 'drivers.form.createSubtitle')}
      crumbs={[
        { label: t('drivers.index.title'), href: '/drivers' },
        ...(editing ? [{ label: g('name'), href: `/drivers/${String(driver?.id)}` }] : []),
        { label: t(editing ? 'drivers.form.editTitle' : 'drivers.form.createTitle') },
      ]}
    >
      <form onSubmit={submit} className="flex max-w-3xl flex-col gap-6">
        <Section title={t('drivers.form.identity')}>
          <TextField
            label={t('drivers.form.firstName')}
            required
            maxLength={100}
            value={form.data.first_name}
            onChange={(e) => form.setData('first_name', e.target.value)}
            error={form.errors.first_name}
          />
          <TextField
            label={t('drivers.form.lastName')}
            required
            maxLength={100}
            value={form.data.last_name}
            onChange={(e) => form.setData('last_name', e.target.value)}
            error={form.errors.last_name}
          />
          <TextField
            label={t('drivers.form.email')}
            type="email"
            maxLength={255}
            value={form.data.email}
            onChange={(e) => form.setData('email', e.target.value)}
            error={form.errors.email}
          />
          <TextField
            label={t('drivers.form.phone')}
            type="tel"
            maxLength={32}
            value={form.data.phone}
            onChange={(e) => form.setData('phone', e.target.value)}
            error={form.errors.phone}
          />
          <SelectField
            label={t('drivers.form.language')}
            value={form.data.preferred_locale}
            onChange={(e) => form.setData('preferred_locale', e.target.value)}
            options={[
              { value: 'en', label: 'English' },
              { value: 'es', label: 'Español' },
            ]}
          />
          <SelectField
            label={t('drivers.form.status')}
            value={form.data.status}
            onChange={(e) => form.setData('status', e.target.value)}
            options={['available', 'on_load', 'off_duty', 'inactive'].map((s) => ({
              value: s,
              label: t(`drivers.status.${s}`),
            }))}
          />
        </Section>

        <Section title={t('drivers.form.licence')}>
          <div className="sm:col-span-2">
            <TextField
              label={t('drivers.form.licenceNumber')}
              hint={editing ? t('drivers.form.licenceKeep') : t('drivers.form.licenceHint')}
              maxLength={40}
              autoComplete="off"
              value={form.data.license_number}
              onChange={(e) => form.setData('license_number', e.target.value)}
              error={form.errors.license_number}
            />
          </div>
          <CountryStateFields
            country={form.data.license_country}
            state={form.data.license_state}
            onChange={(v) =>
              form.setData((d) => ({ ...d, license_country: v.country, license_state: v.state }))
            }
            countryError={form.errors.license_country}
            stateError={form.errors.license_state}
            stateLabel={t('drivers.form.licenceState')}
          />
          <SelectField
            label={t('drivers.form.cdlClass')}
            value={form.data.cdl_class}
            onChange={(e) => form.setData('cdl_class', e.target.value)}
            options={[
              { value: '', label: t('drivers.form.anyClass') },
              ...['A', 'B', 'C'].map((c) => ({ value: c, label: c })),
            ]}
          />
          <TextField
            label={t('drivers.form.licenceExpires')}
            type="date"
            value={form.data.license_expires_at}
            onChange={(e) => form.setData('license_expires_at', e.target.value)}
            error={form.errors.license_expires_at}
          />
          <TextField
            label={t('drivers.form.medicalExpires')}
            type="date"
            value={form.data.medical_card_expires_at}
            onChange={(e) => form.setData('medical_card_expires_at', e.target.value)}
            error={form.errors.medical_card_expires_at}
          />

          <div className="sm:col-span-2">
            <span className="text-sm font-medium text-carbon">{t('drivers.form.endorsements')}</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {ENDORSEMENTS.map((code) => {
                const on = form.data.endorsements.includes(code)

                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => toggleEndorsement(code)}
                    aria-pressed={on}
                    className={`h-9 w-9 rounded border text-sm font-bold transition ${
                      on
                        ? 'border-navy-700 bg-navy-700 text-white'
                        : 'border-steel-300 bg-white text-steel-700 hover:bg-navy-50'
                    }`}
                  >
                    {code}
                  </button>
                )
              })}
            </div>
            <p className="mt-1 text-xs text-steel-600">{t('drivers.form.endorsementsHint')}</p>
          </div>
        </Section>

        <fieldset className="rounded border border-steel-200 bg-white p-5">
          <legend className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-safety-600">
            {t('drivers.form.carriers')}
          </legend>

          {carriers.length === 0 ? (
            <p className="mt-2 text-sm text-steel-700">{t('drivers.form.noCarriers')}</p>
          ) : (
            <>
              <p className="mt-2 text-xs text-steel-600">{t('drivers.form.carriersHint')}</p>
              <div className="mt-2 flex flex-col gap-1.5">
                {carriers.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.data.carrier_ids.includes(c.id)}
                      onChange={() => toggleCarrier(c.id)}
                      className="h-4 w-4 rounded border-steel-300 text-navy-700 focus:ring-navy-500"
                    />
                    {c.name}
                    {form.data.carrier_ids[0] === c.id ? (
                      <span className="rounded-full bg-navy-100 px-2 py-0.5 text-[11px] font-medium text-navy-800">
                        {t('drivers.detail.primary')}
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>
            </>
          )}
        </fieldset>

        <Section title={t('drivers.form.notesSection')}>
          <div className="sm:col-span-2">
            <TextArea
              label={t('drivers.form.notes')}
              maxLength={5000}
              value={form.data.notes}
              onChange={(e) => form.setData('notes', e.target.value)}
            />
          </div>
        </Section>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={form.processing}
            className="rounded bg-safety-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {form.processing
              ? t('common.states.saving')
              : t(editing ? 'drivers.form.saveChanges' : 'drivers.form.save')}
          </button>
          <Link
            href={editing ? `/drivers/${String(driver?.id)}` : '/drivers'}
            className="rounded border border-steel-300 px-4 py-2.5 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
          >
            {t('drivers.form.cancel')}
          </Link>
        </div>
      </form>
    </AppLayout>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded border border-steel-200 bg-white p-5">
      <legend className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-safety-600">
        {title}
      </legend>
      <div className="mt-2 grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  )
}
