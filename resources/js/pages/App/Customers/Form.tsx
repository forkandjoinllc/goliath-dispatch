import { Link, useForm } from '@inertiajs/react'
import type { ReactNode } from 'react'
import { CountryStateFields } from '@/components/Form/CountryStateFields'
import { CheckboxField, SelectField, TextArea, TextField } from '@/components/Form/Field'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Address {
  line1: string | null
  line2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
}

interface CustomerDetail {
  id: string
  companyName: string
  website: string | null
  email: string | null
  phone: string | null
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
}

interface Props {
  customer: CustomerDetail | null
  /**
   * Lo que un prospecto ya nos contó. Lo resuelve el SERVIDOR leyendo el
   * prospecto por id; nunca llega por la URL, porque el nombre de empresa es el
   * campo del que depende la detección de duplicados.
   */
  prefill?: { company_name: string; email: string; phone: string } | null
  canOverrideDuplicate: boolean
}

/**
 * Alta y edición de un cliente.
 *
 * Lo particular de esta pantalla es el duplicado. El servidor no lo impide: lo
 * detecta y devuelve un error de validación. Si el usuario puede anularlo,
 * aparece el campo del motivo y el segundo envío pasa; si no puede, el error
 * nombra el cliente que ya existe para que use esa ficha en lugar de esta.
 *
 * El campo del motivo NO se enseña de entrada. Un campo «por qué es un
 * duplicado» visible desde el principio invita a rellenarlo por costumbre, y
 * entonces deja de significar nada.
 */
export default function CustomerForm({ customer, prefill = null, canOverrideDuplicate }: Props) {
  const { t } = useI18n()
  // `customer` va primero en cada `??`: al editar, el prospecto no pinta nada.
  const editing = customer !== null

  const form = useForm({
    company_name: customer?.companyName ?? prefill?.company_name ?? '',
    website: customer?.website ?? '',
    email: customer?.email ?? prefill?.email ?? '',
    phone: customer?.phone ?? prefill?.phone ?? '',
    physical_line1: customer?.physical.line1 ?? '',
    physical_line2: customer?.physical.line2 ?? '',
    physical_city: customer?.physical.city ?? '',
    physical_country: customer?.physical.country ?? 'US',
    physical_state: customer?.physical.state ?? '',
    physical_postal_code: customer?.physical.postalCode ?? '',
    billing_same_as_physical: customer?.billingSameAsPhysical ?? true,
    billing_line1: customer?.billing.line1 ?? '',
    billing_line2: customer?.billing.line2 ?? '',
    billing_city: customer?.billing.city ?? '',
    billing_country: customer?.billing.country ?? 'US',
    billing_state: customer?.billing.state ?? '',
    billing_postal_code: customer?.billing.postalCode ?? '',
    // En centavos por dentro, en dólares en pantalla — igual que la tarifa de
    // despacho del transportista, y por lo mismo: el dinero se guarda en
    // enteros para que no haya redondeos.
    credit_limit_cents: (customer?.creditLimitCents ?? null) as number | null,
    credit_approved: customer?.creditApproved ?? false,
    credit_notes: customer?.creditNotes ?? '',
    // El tipo se anota porque el campo se puede vaciar. Sin la anotación,
    // useForm infiere `number` del valor inicial y vaciarlo deja de compilar.
    payment_terms_days: (customer?.paymentTermsDays ?? 30) as number | null,
    uses_factoring: customer?.usesFactoring ?? false,
    factoring_company_name: customer?.factoringCompanyName ?? '',
    status: customer?.status ?? 'active',
    notes: customer?.notes ?? '',
    duplicate_override_reason: '',
  })

  // El servidor solo devuelve este error cuando hay un parecido Y el usuario
  // puede anularlo. Su presencia es la señal para enseñar el campo.
  const duplicateAsked = Boolean(form.errors.duplicate_override_reason)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()

    if (editing) {
      form.patch(`/customers/${customer.id}`)
    } else {
      form.post('/customers')
    }
  }

  return (
    <AppLayout
      title={t(editing ? 'customers.form.editTitle' : 'customers.form.createTitle')}
      description={t(editing ? 'customers.form.editSubtitle' : 'customers.form.createSubtitle')}
      crumbs={[
        { label: t('customers.index.title'), href: '/customers' },
        ...(editing ? [{ label: customer.companyName, href: `/customers/${customer.id}` }] : []),
        { label: t(editing ? 'customers.form.editTitle' : 'customers.form.createTitle') },
      ]}
    >
      <form onSubmit={submit} className="flex max-w-3xl flex-col gap-6">
        <Section title={t('customers.form.identity')}>
          <div className="sm:col-span-2">
            <TextField
              label={t('customers.form.companyName')}
              hint={t('customers.form.companyNameHint')}
              required
              maxLength={200}
              value={form.data.company_name}
              onChange={(e) => form.setData('company_name', e.target.value)}
              error={form.errors.company_name}
            />
          </div>
          <TextField
            label={t('customers.form.email')}
            type="email"
            maxLength={255}
            value={form.data.email}
            onChange={(e) => form.setData('email', e.target.value)}
            error={form.errors.email}
          />
          <TextField
            label={t('customers.form.phone')}
            type="tel"
            maxLength={32}
            value={form.data.phone}
            onChange={(e) => form.setData('phone', e.target.value)}
            error={form.errors.phone}
          />
          <TextField
            label={t('customers.form.website')}
            type="url"
            maxLength={255}
            placeholder="https://"
            value={form.data.website}
            onChange={(e) => form.setData('website', e.target.value)}
            error={form.errors.website}
          />
          <SelectField
            label={t('customers.form.status')}
            required
            value={form.data.status}
            onChange={(e) => form.setData('status', e.target.value)}
            options={['active', 'inactive', 'on_hold'].map((s) => ({
              value: s,
              label: t(`customers.status.${s}`),
            }))}
            error={form.errors.status}
          />
        </Section>

        {duplicateAsked && canOverrideDuplicate ? (
          <div className="rounded border-l-4 border-safety-500 bg-safety-50 p-4">
            <TextArea
              label={t('customers.duplicate.reasonLabel')}
              hint={t('customers.duplicate.reasonHint')}
              required
              rows={3}
              maxLength={2000}
              value={form.data.duplicate_override_reason}
              onChange={(e) => form.setData('duplicate_override_reason', e.target.value)}
              error={form.errors.duplicate_override_reason}
            />
          </div>
        ) : null}

        <Section title={t('customers.form.address')}>
          <div className="sm:col-span-2">
            <TextField
              label={t('customers.form.line1')}
              maxLength={200}
              value={form.data.physical_line1}
              onChange={(e) => form.setData('physical_line1', e.target.value)}
              error={form.errors.physical_line1}
            />
          </div>
          <TextField
            label={t('customers.form.line2')}
            maxLength={200}
            value={form.data.physical_line2}
            onChange={(e) => form.setData('physical_line2', e.target.value)}
            error={form.errors.physical_line2}
          />
          <TextField
            label={t('customers.form.city')}
            maxLength={120}
            value={form.data.physical_city}
            onChange={(e) => form.setData('physical_city', e.target.value)}
            error={form.errors.physical_city}
          />
          <CountryStateFields
            country={form.data.physical_country}
            state={form.data.physical_state}
            onChange={(v) =>
              form.setData((d) => ({ ...d, physical_country: v.country, physical_state: v.state }))
            }
            countryError={form.errors.physical_country}
            stateError={form.errors.physical_state}
          />
          <TextField
            label={t('customers.form.postalCode')}
            maxLength={12}
            value={form.data.physical_postal_code}
            onChange={(e) => form.setData('physical_postal_code', e.target.value)}
            error={form.errors.physical_postal_code}
          />
        </Section>

        <Section title={t('customers.form.billing')}>
          <div className="sm:col-span-2">
            <CheckboxField
              label={t('customers.form.billingSame')}
              checked={form.data.billing_same_as_physical}
              onChange={(e) => form.setData('billing_same_as_physical', e.target.checked)}
            />
          </div>

          {/* Los campos de facturación desaparecen cuando coincide con el físico.
              Dejarlos visibles y desactivados invitaría a rellenarlos y a
              preguntarse por qué no se guardan. */}
          {!form.data.billing_same_as_physical ? (
            <>
              <div className="sm:col-span-2">
                <TextField
                  label={t('customers.form.line1')}
                  maxLength={200}
                  value={form.data.billing_line1}
                  onChange={(e) => form.setData('billing_line1', e.target.value)}
                  error={form.errors.billing_line1}
                />
              </div>
              <TextField
                label={t('customers.form.city')}
                maxLength={120}
                value={form.data.billing_city}
                onChange={(e) => form.setData('billing_city', e.target.value)}
                error={form.errors.billing_city}
              />
              <CountryStateFields
                country={form.data.billing_country}
                state={form.data.billing_state}
                onChange={(v) =>
                  form.setData((d) => ({ ...d, billing_country: v.country, billing_state: v.state }))
                }
                countryError={form.errors.billing_country}
                stateError={form.errors.billing_state}
              />
              <TextField
                label={t('customers.form.postalCode')}
                maxLength={12}
                value={form.data.billing_postal_code}
                onChange={(e) => form.setData('billing_postal_code', e.target.value)}
                error={form.errors.billing_postal_code}
              />
            </>
          ) : null}
        </Section>

        <Section title={t('customers.form.commercial')}>
          <TextField
            label={t('customers.form.paymentTerms')}
            hint={t('customers.form.paymentTermsHint')}
            type="number"
            min={0}
            max={365}
            value={form.data.payment_terms_days ?? ''}
            onChange={(e) =>
              form.setData('payment_terms_days', e.target.value === '' ? null : Number(e.target.value))
            }
            error={form.errors.payment_terms_days}
          />
          <TextField
            label={t('customers.form.creditLimit')}
            hint={t('customers.form.creditLimitHint')}
            type="number"
            min={0}
            step={100}
            value={form.data.credit_limit_cents === null ? '' : form.data.credit_limit_cents / 100}
            onChange={(e) =>
              form.setData(
                'credit_limit_cents',
                e.target.value === '' ? null : Math.round(Number(e.target.value) * 100),
              )
            }
            error={form.errors.credit_limit_cents}
          />
          <div className="self-end">
            <CheckboxField
              label={t('customers.form.creditApproved')}
              checked={form.data.credit_approved}
              onChange={(e) => form.setData('credit_approved', e.target.checked)}
            />
          </div>
          <div className="self-end">
            <CheckboxField
              label={t('customers.form.usesFactoring')}
              checked={form.data.uses_factoring}
              onChange={(e) => form.setData('uses_factoring', e.target.checked)}
            />
          </div>

          {form.data.uses_factoring ? (
            <div className="sm:col-span-2">
              <TextField
                label={t('customers.form.factoringCompany')}
                maxLength={200}
                value={form.data.factoring_company_name}
                onChange={(e) => form.setData('factoring_company_name', e.target.value)}
                error={form.errors.factoring_company_name}
              />
            </div>
          ) : null}

          <div className="sm:col-span-2">
            <TextArea
              label={t('customers.form.creditNotes')}
              rows={3}
              maxLength={2000}
              value={form.data.credit_notes}
              onChange={(e) => form.setData('credit_notes', e.target.value)}
              error={form.errors.credit_notes}
            />
          </div>

          <div className="sm:col-span-2">
            <TextArea
              label={t('customers.form.notes')}
              hint={t('customers.form.notesHint')}
              maxLength={5000}
              value={form.data.notes}
              onChange={(e) => form.setData('notes', e.target.value)}
              error={form.errors.notes}
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
              : t(editing ? 'customers.form.saveChanges' : 'customers.form.save')}
          </button>
          <Link
            href={editing ? `/customers/${customer.id}` : '/customers'}
            className="rounded border border-steel-300 px-4 py-2.5 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
          >
            {t('customers.form.cancel')}
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
