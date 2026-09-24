import { useForm } from '@inertiajs/react'
import { AppLayout } from '@/layouts/AppLayout'
import { CountryStateFields } from '@/components/Form/CountryStateFields'
import { CheckboxField, SelectField, TextArea, TextField } from '@/components/Form/Field'
import { useI18n } from '@/lib/i18n'

interface Contacto {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string
  phone_extension: string
  position: string
  preferred_locale: string
  notes: string
}

interface Props {
  vendor: Record<string, unknown> | null
  contacts: Record<string, unknown>[]
  selectedCarriers: string[]
  carriers: { id: string; name: string }[]
  codes: {
    types: string[]
    statuses: string[]
    paymentMethods: string[]
    countries: string[]
    locales: string[]
  }
}

const CONTACTO_VACIO: Contacto = {
  id: '',
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  phone_extension: '',
  position: '',
  preferred_locale: 'en',
  notes: '',
}

/**
 * El alta y la edición de un proveedor.
 *
 * ## El identificador fiscal no vuelve
 *
 * Se guarda cifrado y solo se enseñan los cuatro últimos. Por eso el campo sale
 * SIEMPRE en blanco, incluso editando: no hay nada que devolverle. Dejarlo en
 * blanco conserva el que hay —el servidor solo escribe esa columna si la clave
 * viene—, y escribir algo lo reemplaza. Al lado se dice cuál está guardado,
 * porque un campo en blanco sin más se lee como «no hay ninguno».
 *
 * ## El contacto principal es el primero
 *
 * No hay casilla que marcar. La base tiene un único que no admite dos
 * principales vivos a la vez, así que si la pantalla dejara marcar dos, el
 * guardado fallaría con un error de SQL que nadie sabe leer. El orden ES la
 * respuesta, y se dice.
 */
export default function VendorForm({ vendor, contacts, selectedCarriers, carriers, codes }: Props) {
  const { t } = useI18n()

  const g = (clave: string): string => {
    const v = vendor?.[clave]

    return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v)
  }

  const form = useForm({
    company_name: g('companyName'),
    vendor_type: g('vendorType') || 'leasing',
    website: g('website'),
    phone: g('phone'),
    email: g('email'),
    preferred_locale: g('preferredLocale') || 'en',

    line1: g('line1'),
    line2: g('line2'),
    city: g('city'),
    state: g('state'),
    country: g('country') || 'US',
    postal_code: g('postalCode'),

    // En blanco a propósito, también al editar. Ver el comentario de arriba.
    tax_id: '',
    w9_on_file: vendor?.w9OnFile === true,
    w9_received_on: g('w9ReceivedOn'),

    payment_terms_days: vendor === null ? 30 : Number(vendor.paymentTermsDays ?? 30),
    payment_method: g('paymentMethod'),
    account_last4: g('accountLast4'),

    status: g('status') || 'active',
    notes: g('notes'),

    carrier_ids: selectedCarriers,
    contacts: contacts.length === 0
      ? [{ ...CONTACTO_VACIO }]
      : contacts.map((c): Contacto => ({
          id: String(c.id ?? ''),
          first_name: String(c.firstName ?? ''),
          last_name: String(c.lastName ?? ''),
          email: String(c.email ?? ''),
          phone: String(c.phone ?? ''),
          phone_extension: String(c.phoneExtension ?? ''),
          position: String(c.position ?? ''),
          preferred_locale: String(c.preferredLocale ?? 'en'),
          notes: String(c.notes ?? ''),
        })),
  })

  const editando = vendor !== null
  const ultimos4 = typeof vendor?.taxIdLast4 === 'string' ? vendor.taxIdLast4 : null

  const tocarContacto = (i: number, campo: keyof Contacto, valor: string) => {
    form.setData(
      'contacts',
      form.data.contacts.map((c, j) => (i === j ? { ...c, [campo]: valor } : c)),
    )
  }

  const enviar = (e: React.FormEvent) => {
    e.preventDefault()

    if (editando) {
      form.patch(`/vendors/${String(vendor.id)}`)
    } else {
      form.post('/vendors')
    }
  }

  return (
    <AppLayout
      title={editando ? t('vendors.form.editTitle', { name: g('companyName') }) : t('vendors.form.createTitle')}
      crumbs={[
        { label: t('vendors.index.title'), href: '/vendors' },
        { label: editando ? g('companyName') : t('vendors.form.createTitle') },
      ]}
    >
      <form onSubmit={enviar} className="mt-4 flex max-w-4xl flex-col gap-8">
        <Bloque titulo={t('vendors.form.identity')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('vendors.form.companyName')}
              required
              value={form.data.company_name}
              maxLength={200}
              onChange={(e) => form.setData('company_name', e.target.value)}
              error={form.errors.company_name}
            />
            <SelectField
              label={t('vendors.form.vendorType')}
              required
              value={form.data.vendor_type}
              onChange={(e) => form.setData('vendor_type', e.target.value)}
              options={codes.types.map((v) => ({ value: v, label: t(`vendors.type.${v}`) }))}
              error={form.errors.vendor_type}
            />
            <TextField
              label={t('common.labels.phone')}
              value={form.data.phone}
              maxLength={32}
              onChange={(e) => form.setData('phone', e.target.value)}
              error={form.errors.phone}
            />
            <TextField
              type="email"
              label={t('common.labels.email')}
              value={form.data.email}
              maxLength={255}
              onChange={(e) => form.setData('email', e.target.value)}
              error={form.errors.email}
            />
            <TextField
              label={t('vendors.form.website')}
              value={form.data.website}
              maxLength={255}
              onChange={(e) => form.setData('website', e.target.value)}
              error={form.errors.website}
            />
            <SelectField
              label={t('common.labels.status')}
              value={form.data.status}
              onChange={(e) => form.setData('status', e.target.value)}
              options={codes.statuses.map((v) => ({ value: v, label: t(`vendors.status.${v}`) }))}
              error={form.errors.status}
            />
          </div>
        </Bloque>

        <Bloque titulo={t('vendors.form.address')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('common.address.line1')}
              value={form.data.line1}
              maxLength={200}
              onChange={(e) => form.setData('line1', e.target.value)}
              error={form.errors.line1}
            />
            <TextField
              label={t('common.address.line2')}
              value={form.data.line2}
              maxLength={200}
              onChange={(e) => form.setData('line2', e.target.value)}
              error={form.errors.line2}
            />
            <TextField
              label={t('common.labels.city')}
              value={form.data.city}
              maxLength={120}
              onChange={(e) => form.setData('city', e.target.value)}
              error={form.errors.city}
            />
            <TextField
              label={t('common.labels.postalCode')}
              value={form.data.postal_code}
              maxLength={12}
              onChange={(e) => form.setData('postal_code', e.target.value)}
              error={form.errors.postal_code}
            />
            {/* País y subdivisión juntos: el estado que vale depende del país,
                y dos desplegables sueltos dejan elegir «Texas, México». */}
            <CountryStateFields
              country={form.data.country}
              state={form.data.state}
              /* Una sola llamada con el par entero: dos `setData` seguidos
                 pierden el primero cuando el padre calcula el siguiente
                 estado desde una variable capturada. Lo dice el propio
                 componente. */
              onChange={(next) => {
                form.setData((datos) => ({ ...datos, country: next.country, state: next.state }))
              }}
              countryError={form.errors.country}
              stateError={form.errors.state}
            />
          </div>
        </Bloque>

        <Bloque titulo={t('vendors.form.money')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('vendors.form.taxId')}
              value={form.data.tax_id}
              maxLength={40}
              autoComplete="off"
              onChange={(e) => form.setData('tax_id', e.target.value)}
              hint={
                ultimos4 === null
                  ? t('vendors.form.taxIdHint')
                  : `${t('vendors.form.taxIdOnFile', { last4: ultimos4 })} · ${t('vendors.form.taxIdHint')}`
              }
              error={form.errors.tax_id}
            />
            <TextField
              type="number"
              label={t('vendors.form.paymentTermsDays')}
              value={String(form.data.payment_terms_days)}
              min={0}
              max={365}
              onChange={(e) => form.setData('payment_terms_days', Number(e.target.value))}
              error={form.errors.payment_terms_days}
            />
            <SelectField
              label={t('vendors.form.paymentMethod')}
              value={form.data.payment_method}
              onChange={(e) => form.setData('payment_method', e.target.value)}
              options={[
                { value: '', label: t('common.labels.none') },
                ...codes.paymentMethods.map((v) => ({ value: v, label: t(`vendors.paymentMethod.${v}`) })),
              ]}
              error={form.errors.payment_method}
            />
            <TextField
              label={t('vendors.form.accountLast4')}
              value={form.data.account_last4}
              maxLength={4}
              inputMode="numeric"
              onChange={(e) => form.setData('account_last4', e.target.value.replace(/\D/g, ''))}
              hint={t('vendors.form.accountLast4Hint')}
              error={form.errors.account_last4}
            />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <CheckboxField
              label={t('vendors.form.w9OnFile')}
              checked={form.data.w9_on_file}
              onChange={(e) => {
                form.setData('w9_on_file', e.target.checked)

                // Sin W-9 no hay fecha de recepción. La base tiene la misma
                // regla; limpiarla aquí evita que llegue como un error de SQL.
                if (! e.target.checked) form.setData('w9_received_on', '')
              }}
              error={form.errors.w9_on_file}
            />
            {form.data.w9_on_file ? (
              <TextField
                type="date"
                label={t('vendors.form.w9ReceivedOn')}
                value={form.data.w9_received_on}
                onChange={(e) => form.setData('w9_received_on', e.target.value)}
                error={form.errors.w9_received_on}
              />
            ) : null}
          </div>
        </Bloque>

        <Bloque titulo={t('vendors.form.serves')} pista={t('vendors.form.servesHint')}>
          {carriers.length === 0 ? (
            <p className="text-sm text-steel-700">{t('vendors.form.noCarriers')}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {carriers.map((c) => (
                <CheckboxField
                  key={c.id}
                  label={c.name}
                  checked={form.data.carrier_ids.includes(c.id)}
                  onChange={(e) =>
                    form.setData(
                      'carrier_ids',
                      e.target.checked
                        ? [...form.data.carrier_ids, c.id]
                        : form.data.carrier_ids.filter((id) => id !== c.id),
                    )
                  }
                />
              ))}
            </div>
          )}
        </Bloque>

        <Bloque titulo={t('vendors.form.contacts')} pista={t('vendors.form.contactsHint')}>
          <div className="flex flex-col gap-5">
            {form.data.contacts.map((c, i) => (
              <fieldset key={c.id || `nuevo-${i}`} className="rounded border border-steel-200 p-4">
                <legend className="flex items-center gap-2 px-1 text-xs font-bold uppercase tracking-[0.1em] text-safety-600">
                  {i + 1}
                  {i === 0 ? (
                    <span className="rounded-full bg-navy-100 px-2 py-0.5 text-[10px] text-navy-800">
                      {t('vendors.form.primary')}
                    </span>
                  ) : null}
                </legend>

                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label={t('vendors.form.firstName')}
                    required
                    value={c.first_name}
                    maxLength={100}
                    onChange={(e) => tocarContacto(i, 'first_name', e.target.value)}
                    error={form.errors[`contacts.${i}.first_name` as keyof typeof form.errors] as string | undefined}
                  />
                  <TextField
                    label={t('vendors.form.lastName')}
                    required
                    value={c.last_name}
                    maxLength={100}
                    onChange={(e) => tocarContacto(i, 'last_name', e.target.value)}
                    error={form.errors[`contacts.${i}.last_name` as keyof typeof form.errors] as string | undefined}
                  />
                  <TextField
                    type="email"
                    label={t('common.labels.email')}
                    value={c.email}
                    maxLength={255}
                    onChange={(e) => tocarContacto(i, 'email', e.target.value)}
                    error={form.errors[`contacts.${i}.email` as keyof typeof form.errors] as string | undefined}
                  />
                  <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3">
                    <TextField
                      label={t('common.labels.phone')}
                      value={c.phone}
                      maxLength={32}
                      onChange={(e) => tocarContacto(i, 'phone', e.target.value)}
                    />
                    <TextField
                      label={t('vendors.form.extension')}
                      value={c.phone_extension}
                      maxLength={10}
                      onChange={(e) => tocarContacto(i, 'phone_extension', e.target.value)}
                    />
                  </div>
                  <TextField
                    label={t('vendors.form.position')}
                    value={c.position}
                    maxLength={120}
                    onChange={(e) => tocarContacto(i, 'position', e.target.value)}
                  />
                  <SelectField
                    label={t('common.labels.language')}
                    /* En su propio idioma, como en clientes: el nombre de un
                       idioma no se traduce, se escribe en él. */
                    value={c.preferred_locale}
                    onChange={(e) => tocarContacto(i, 'preferred_locale', e.target.value)}
                    options={[
                      { value: 'en', label: 'English' },
                      { value: 'es', label: 'Español' },
                    ]}
                  />
                </div>

                {form.data.contacts.length > 1 ? (
                  <button
                    type="button"
                    onClick={() =>
                      form.setData('contacts', form.data.contacts.filter((_, j) => j !== i))
                    }
                    className="mt-3 text-xs font-semibold text-safety-700 hover:underline"
                  >
                    {t('vendors.form.removeContact')}
                  </button>
                ) : null}
              </fieldset>
            ))}
          </div>

          <button
            type="button"
            onClick={() => form.setData('contacts', [...form.data.contacts, { ...CONTACTO_VACIO }])}
            className="mt-4 rounded border border-steel-300 px-3 py-1.5 text-sm font-semibold text-navy-700 transition hover:bg-navy-50"
          >
            {t('vendors.form.addContact')}
          </button>
        </Bloque>

        <Bloque titulo={t('vendors.form.notes')}>
          <TextArea
            label={t('vendors.form.notes')}
            value={form.data.notes}
            maxLength={5000}
            onChange={(e) => form.setData('notes', e.target.value)}
            error={form.errors.notes}
          />
        </Bloque>

        <div className="flex justify-end gap-3">
          <button
            type="submit"
            disabled={form.processing}
            className="rounded bg-navy-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-60"
          >
            {t('vendors.form.save')}
          </button>
        </div>
      </form>
    </AppLayout>
  )
}

function Bloque({
  titulo,
  pista,
  children,
}: {
  titulo: string
  pista?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="text-sm font-bold uppercase tracking-[0.1em] text-safety-600">{titulo}</h2>
      {pista === undefined ? null : <p className="mt-1 text-xs text-steel-600">{pista}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}
