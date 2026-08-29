import { Link, useForm } from '@inertiajs/react'
import type { ReactNode } from 'react'
import { CountryStateFields } from '@/components/Form/CountryStateFields'
import { SearchableSelect } from '@/components/Form/SearchableSelect'
import { CheckboxField, SelectField, TextArea, TextField } from '@/components/Form/Field'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Props {
  driver: Record<string, unknown> | null
  carriers: { id: string; name: string }[]
  selectedCarriers: string[]
}

/** Los endosos de una CDL. Son cinco y no cambian. */
const ENDORSEMENTS = ['H', 'N', 'T', 'P', 'X', 'S']

/** Espejo de App\Enums\WorkAuthorization. */
const WORK_AUTHORIZATIONS = [
  'us_citizen',
  'permanent_resident',
  'employment_authorization',
  'other',
]

/** Los tramos que piden los clientes. 31 se pinta como «más de 30». */
const RECORD_YEARS = [0, 1, 2, 3, 5, 10, 15, 20, 25, 30, 31]

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
    twic_card: Boolean(driver?.twicCard ?? false),
    twic_number_last4: g('twicNumberLast4'),
    twic_expires_at: String(driver?.twicExpiresAt ?? '').slice(0, 10),
    work_authorization: g('workAuthorization'),
    // Vacío es «no se ha mirado». Cero es «se miró y hay algo dentro del último
    // año». No son lo mismo y el desplegable los distingue.
    record_clean_years: driver?.recordCleanYears === null || driver?.recordCleanYears === undefined
      ? ''
      : String(driver.recordCleanYears),
    record_checked_at: String(driver?.recordCheckedAt ?? '').slice(0, 10),
    record_notes: g('recordNotes'),
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
            <div className="mt-2 flex flex-col gap-3">
              {/* Se escribe y se elige de uno en uno. La lista de casillas
                  dejaba de servir alrededor de los treinta transportistas y era
                  hostil a los doscientos. */}
              <SearchableSelect
                label={t('drivers.form.addCarrier')}
                choices={carriers}
                exclude={form.data.carrier_ids}
                onPick={(id) => form.setData('carrier_ids', [...form.data.carrier_ids, id])}
                placeholder={t('drivers.form.carrierSearchPlaceholder')}
                hint={t('drivers.form.carriersHint')}
                emptyText={t('drivers.form.noCarrierMatches')}
              />

              {form.data.carrier_ids.length === 0 ? (
                <p className="text-sm text-steel-600">{t('drivers.form.noneChosen')}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {form.data.carrier_ids.map((id, i) => {
                    const c = carriers.find((x) => x.id === id)

                    return (
                      <li
                        key={id}
                        className="flex items-center justify-between gap-3 rounded border border-steel-200 bg-steel-50/60 px-3 py-2 text-sm"
                      >
                        <span className="flex items-center gap-2">
                          {c?.name ?? id}
                          {/* El primero es el principal, igual que antes. */}
                          {i === 0 ? (
                            <span className="rounded-full bg-navy-100 px-2 py-0.5 text-[11px] font-medium text-navy-800">
                              {t('drivers.detail.primary')}
                            </span>
                          ) : null}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleCarrier(id)}
                          className="text-xs font-medium text-danger-700 underline transition hover:text-danger-900"
                        >
                          {t('drivers.form.removeCarrier')}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </fieldset>

        <Section title={t('drivers.form.qualification')}>
          <div className="sm:col-span-2">
            <p className="text-xs text-steel-600">{t('drivers.form.qualificationHint')}</p>
          </div>

          <div className="self-end">
            <CheckboxField
              label={t('drivers.form.twicCard')}
              checked={form.data.twic_card}
              onChange={(e) => form.setData('twic_card', e.target.checked)}
            />
          </div>
          <div className="hidden sm:block" />

          {/* Los campos de la tarjeta salen al marcarla. Del número solo se
              guardan los cuatro últimos, igual que de la licencia: nadie
              necesita el número entero para saber que existe y cuándo caduca. */}
          {form.data.twic_card ? (
            <>
              <TextField
                label={t('drivers.form.twicLast4')}
                hint={t('drivers.form.twicLast4Hint')}
                inputMode="numeric"
                maxLength={4}
                value={form.data.twic_number_last4}
                onChange={(e) => form.setData('twic_number_last4', e.target.value.replace(/\D/g, ''))}
                error={form.errors.twic_number_last4}
              />
              <TextField
                label={t('drivers.form.twicExpires')}
                type="date"
                value={form.data.twic_expires_at}
                onChange={(e) => form.setData('twic_expires_at', e.target.value)}
                error={form.errors.twic_expires_at}
              />
            </>
          ) : null}

          <SelectField
            label={t('drivers.form.workAuthorization')}
            hint={t('drivers.form.workAuthorizationHint')}
            value={form.data.work_authorization}
            onChange={(e) => form.setData('work_authorization', e.target.value)}
            options={[
              { value: '', label: t('drivers.form.notRecorded') },
              ...WORK_AUTHORIZATIONS.map((v) => ({
                value: v,
                label: t(`drivers.workAuthorization.${v}`),
              })),
            ]}
            error={form.errors.work_authorization}
          />
          <div className="hidden sm:block" />

          <SelectField
            label={t('drivers.form.recordCleanYears')}
            hint={t('drivers.form.recordCleanYearsHint')}
            value={form.data.record_clean_years}
            onChange={(e) => form.setData('record_clean_years', e.target.value)}
            options={[
              { value: '', label: t('drivers.form.notRecorded') },
              ...RECORD_YEARS.map((y) => ({
                value: String(y),
                label: y === 31 ? t('drivers.form.moreThan30') : t('drivers.form.nYears', { n: String(y) }),
              })),
            ]}
            error={form.errors.record_clean_years}
          />
          <TextField
            label={t('drivers.form.recordCheckedAt')}
            type="date"
            value={form.data.record_checked_at}
            onChange={(e) => form.setData('record_checked_at', e.target.value)}
            error={form.errors.record_checked_at}
          />
          <div className="sm:col-span-2">
            <TextArea
              label={t('drivers.form.recordNotes')}
              hint={t('drivers.form.recordNotesHint')}
              maxLength={2000}
              value={form.data.record_notes}
              onChange={(e) => form.setData('record_notes', e.target.value)}
              error={form.errors.record_notes}
            />
          </div>
        </Section>

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
