import { Link, useForm } from '@inertiajs/react'
import { useState, type ReactNode } from 'react'
import { CountryStateFields } from '@/components/Form/CountryStateFields'
import { CheckboxField, SelectField, TextArea, TextField } from '@/components/Form/Field'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface StopDraft {
  id: string | null
  stop_type: 'pickup' | 'delivery'
  facility_name: string
  line1: string
  city: string
  state: string
  country: string
  postal_code: string
  timezone: string
  appointment_type: string
  window_start: string
  window_end: string
  contact_name: string
  contact_phone: string
  instructions: string
}

interface RequirementDraft {
  id: string | null
  type: string
  value: string
  source: string
  notes: string
}

interface Props {
  load: Record<string, unknown> | null
  stops: Record<string, unknown>[]
  requirements?: Record<string, unknown>[]
  choices: {
    customers: { id: string; name: string }[]
    carriers: { id: string; name: string; dispatchFeeBps: number }[]
    equipmentTypes: { id: string; code: string; labelEn: string; labelEs: string }[]
  }
  canEditFinancials: boolean
  canEditFreight?: boolean
}

/** Espejo de App\Enums\LoadRequirementType. */
const REQUIREMENT_TYPES = ['twic', 'endorsement', 'work_authorization', 'clean_record']

/** Espejo de App\Enums\WorkAuthorization. */
const WORK_AUTHORIZATIONS = [
  'us_citizen',
  'permanent_resident',
  'employment_authorization',
  'other',
]

const ENDORSEMENT_CODES = ['H', 'N', 'T', 'P', 'X', 'S']

const RECORD_YEARS = [1, 2, 3, 5, 10, 15, 20, 25, 30]

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage',
]

/** Una parada nueva y vacía. Las fechas se dejan sueltas a propósito. */
function blankStop(type: 'pickup' | 'delivery'): StopDraft {
  return {
    id: null,
    stop_type: type,
    facility_name: '',
    line1: '',
    city: '',
    state: '',
    country: 'US',
    postal_code: '',
    timezone: 'America/Chicago',
    appointment_type: 'window',
    window_start: '',
    window_end: '',
    contact_name: '',
    contact_phone: '',
    instructions: '',
  }
}

/** Corta un ISO a lo que espera <input type="datetime-local">. */
function toLocalInput(value: unknown): string {
  if (typeof value !== 'string' || value === '') return ''
  return value.slice(0, 16)
}

export default function LoadForm({
  load, stops, requirements, choices, canEditFinancials, canEditFreight = true,
}: Props) {
  const { t, locale } = useI18n()
  const editing = load !== null
  const g = (key: string): string => {
    const v = load?.[key]
    return v === null || v === undefined ? '' : String(v)
  }
  const n = (key: string): number | null => {
    const v = load?.[key]
    return typeof v === 'number' ? v : null
  }

  const [stopList, setStopList] = useState<StopDraft[]>(
    stops.length > 0
      ? stops.map((s) => ({
          id: String(s.id),
          stop_type: s.type as 'pickup' | 'delivery',
          facility_name: (s.name as string) ?? '',
          line1: (s.line1 as string) ?? '',
          city: (s.city as string) ?? '',
          state: (s.state as string) ?? '',
          country: (s.country as string) ?? 'US',
          postal_code: (s.postalCode as string) ?? '',
          timezone: (s.timezone as string) ?? 'America/Chicago',
          appointment_type: (s.appointmentType as string) ?? 'window',
          window_start: toLocalInput(s.windowStart),
          window_end: toLocalInput(s.windowEnd),
          contact_name: (s.contactName as string) ?? '',
          contact_phone: (s.contactPhone as string) ?? '',
          instructions: (s.instructions as string) ?? '',
        }))
      : [blankStop('pickup'), blankStop('delivery')],
  )

  const requisitosIniciales: RequirementDraft[] = (requirements ?? []).map((r) => ({
    id: (r.id as string) ?? null,
    type: (r.type as string) ?? 'twic',
    value: (r.value as string) ?? '',
    source: (r.source as string) ?? '',
    notes: (r.notes as string) ?? '',
  }))

  const [reqList, setReqList] = useState<RequirementDraft[]>(requisitosIniciales)

  const patchReq = (index: number, patch: Partial<RequirementDraft>) => {
    const next = reqList.map((r, i) => (i === index ? { ...r, ...patch } : r))
    setReqList(next)
    form.setData('requirements', next)
  }

  const addReq = () => {
    const next = [...reqList, { id: null, type: 'twic', value: '', source: '', notes: '' }]
    setReqList(next)
    form.setData('requirements', next)
  }

  const removeReq = (index: number) => {
    const next = reqList.filter((_, i) => i !== index)
    setReqList(next)
    form.setData('requirements', next)
  }

  const form = useForm({
    requirements: requisitosIniciales,
    customer_id: g('customer') ? String((load?.customer as { id: string })?.id ?? '') : '',
    customer_reference: g('customerReference'),
    po_number: g('poNumber'),
    commodity: g('commodity'),
    weight_pounds: n('weightPounds'),
    piece_count: n('pieceCount'),
    length_inches: (load?.dimensions as { length: number | null })?.length ?? null,
    width_inches: (load?.dimensions as { width: number | null })?.width ?? null,
    height_inches: (load?.dimensions as { height: number | null })?.height ?? null,
    required_equipment_type_id: g('requiredEquipmentTypeId'),
    is_oversize: Boolean(load?.isOversize),
    is_overweight: Boolean(load?.isOverweight),
    miles: n('miles'),
    deadhead_miles: n('deadheadMiles'),
    planned_pickup_at: toLocalInput(load?.plannedPickupAt),
    planned_delivery_at: toLocalInput(load?.plannedDeliveryAt),
    special_instructions: g('specialInstructions'),
    internal_notes: g('internalNotes'),
    customer_charge_cents: n('customerChargeCents'),
    carrier_gross_rate_cents: n('carrierGrossRateCents'),
    // Anotados porque el campo se puede vaciar. Sin la anotación, useForm
    // infiere `number` del valor inicial y borrarlo deja de compilar.
    carrier_dispatch_fee_bps: (n('carrierDispatchFeeBps') ?? 1000) as number | null,
    dispatcher_commission_bps: (n('dispatcherCommissionBps') ?? 2500) as number | null,
    stops: stopList as unknown as StopDraft[],
  })

  const patchStop = (index: number, patch: Partial<StopDraft>) => {
    const next = stopList.map((s, i) => (i === index ? { ...s, ...patch } : s))
    setStopList(next)
    form.setData('stops', next)
  }

  const addStop = (type: 'pickup' | 'delivery') => {
    const next = [...stopList, blankStop(type)]
    setStopList(next)
    form.setData('stops', next)
  }

  const removeStop = (index: number) => {
    const next = stopList.filter((_, i) => i !== index)
    setStopList(next)
    form.setData('stops', next)
  }

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= stopList.length) return
    const next = [...stopList]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    setStopList(next)
    form.setData('stops', next)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editing) form.patch(`/loads/${String(load?.id)}`)
    else form.post('/loads')
  }

  const number = g('loadNumber')

  return (
    <AppLayout
      title={editing ? t('loads.form.editTitle', { number }) : t('loads.form.createTitle')}
      description={editing ? t('loads.form.editSubtitle') : t('loads.form.createSubtitle')}
      crumbs={[
        { label: t('loads.index.title'), href: '/loads' },
        ...(editing ? [{ label: number, href: `/loads/${String(load?.id)}` }] : []),
        { label: editing ? t('loads.form.editTitle', { number }) : t('loads.form.createTitle') },
      ]}
    >
      <form onSubmit={submit} className="flex max-w-4xl flex-col gap-6">
        {canEditFreight ? (
        <Section title={t('loads.form.freight')}>
          <div className="sm:col-span-2">
            <SelectField
              label={t('loads.form.customer')}
              required
              value={form.data.customer_id}
              onChange={(e) => form.setData('customer_id', e.target.value)}
              options={[
                { value: '', label: t('loads.form.chooseCustomer') },
                ...choices.customers.map((c) => ({ value: c.id, label: c.name })),
              ]}
              error={form.errors.customer_id}
            />
          </div>

          <TextField
            label={t('loads.form.commodity')}
            maxLength={200}
            value={form.data.commodity}
            onChange={(e) => form.setData('commodity', e.target.value)}
            error={form.errors.commodity}
          />
          <SelectField
            label={t('loads.form.equipmentType')}
            value={form.data.required_equipment_type_id}
            onChange={(e) => form.setData('required_equipment_type_id', e.target.value)}
            options={[
              { value: '', label: t('loads.form.anyEquipment') },
              ...choices.equipmentTypes.map((e) => ({
                value: e.id,
                label: locale === 'es' ? e.labelEs : e.labelEn,
              })),
            ]}
          />

          <NumberField
            label={t('loads.form.weight')}
            value={form.data.weight_pounds}
            onChange={(v) => form.setData('weight_pounds', v)}
            error={form.errors.weight_pounds}
          />
          <NumberField
            label={t('loads.form.pieces')}
            value={form.data.piece_count}
            onChange={(v) => form.setData('piece_count', v)}
            error={form.errors.piece_count}
          />
          <NumberField
            label={t('loads.form.length')}
            value={form.data.length_inches}
            onChange={(v) => form.setData('length_inches', v)}
          />
          <NumberField
            label={t('loads.form.width')}
            value={form.data.width_inches}
            onChange={(v) => form.setData('width_inches', v)}
          />
          <NumberField
            label={t('loads.form.height')}
            value={form.data.height_inches}
            onChange={(v) => form.setData('height_inches', v)}
          />

          <div className="self-end">
            <CheckboxField
              label={t('loads.form.isOverweight')}
              checked={form.data.is_overweight}
              onChange={(e) => form.setData('is_overweight', e.target.checked)}
            />
          </div>
          <div className="sm:col-span-2">
            <CheckboxField
              label={t('loads.form.isOversize')}
              checked={form.data.is_oversize}
              onChange={(e) => form.setData('is_oversize', e.target.checked)}
            />
            {/* La consecuencia se dice AQUÍ, al marcar la casilla, no tres
                pasos después cuando el botón de despachar salga en gris. */}
            {form.data.is_oversize ? (
              <p className="mt-1 text-xs text-safety-700">{t('loads.form.oversizeHint')}</p>
            ) : null}
          </div>

          <TextField
            label={t('loads.form.reference')}
            maxLength={80}
            value={form.data.customer_reference}
            onChange={(e) => form.setData('customer_reference', e.target.value)}
          />
          <TextField
            label={t('loads.form.poNumber')}
            maxLength={80}
            value={form.data.po_number}
            onChange={(e) => form.setData('po_number', e.target.value)}
          />
        </Section>
        ) : null}

        {canEditFreight ? (
        <Section title={t('loads.form.route')}>
          <TextField
            label={t('loads.form.plannedPickup')}
            type="datetime-local"
            value={form.data.planned_pickup_at}
            onChange={(e) => form.setData('planned_pickup_at', e.target.value)}
            error={form.errors.planned_pickup_at}
          />
          <TextField
            label={t('loads.form.plannedDelivery')}
            type="datetime-local"
            value={form.data.planned_delivery_at}
            onChange={(e) => form.setData('planned_delivery_at', e.target.value)}
            error={form.errors.planned_delivery_at}
          />
          <NumberField
            label={t('loads.form.miles')}
            value={form.data.miles}
            onChange={(v) => form.setData('miles', v)}
          />
          <NumberField
            label={t('loads.form.deadhead')}
            value={form.data.deadhead_miles}
            onChange={(v) => form.setData('deadhead_miles', v)}
          />
        </Section>
        ) : null}

        {/* ── Paradas ─────────────────────────────────────────────────── */}
        {/* Contabilidad no las recibe ni las manda: son mercancía, no dinero. */}
        {canEditFreight ? (
        <fieldset className="rounded border border-steel-200 bg-white p-5">
          <legend className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-safety-600">
            {t('loads.form.stops')}
          </legend>

          {form.errors.stops ? (
            <p role="alert" className="mt-2 rounded border-l-4 border-danger-500 bg-danger-50 p-2 text-sm">
              {form.errors.stops}
            </p>
          ) : null}

          <div className="mt-3 flex flex-col gap-4">
            {stopList.map((stop, index) => (
              <div
                key={index}
                className={`rounded border-l-4 bg-navy-50/40 p-4 ${
                  stop.stop_type === 'pickup' ? 'border-navy-600' : 'border-safety-600'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-steel-700">
                    {t('loads.form.stopNumber', { n: index + 1 })} ·{' '}
                    {t(`loads.detail.${stop.stop_type}`)}
                  </span>

                  <div className="ml-auto flex gap-1">
                    <IconButton label={t('loads.form.moveUp')} onClick={() => move(index, -1)} disabled={index === 0}>
                      ↑
                    </IconButton>
                    <IconButton
                      label={t('loads.form.moveDown')}
                      onClick={() => move(index, 1)}
                      disabled={index === stopList.length - 1}
                    >
                      ↓
                    </IconButton>
                    <IconButton
                      label={t('loads.form.removeStop')}
                      onClick={() => removeStop(index)}
                      disabled={stopList.length <= 2}
                      danger
                    >
                      ×
                    </IconButton>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <TextField
                      label={t('loads.form.facilityName')}
                      maxLength={200}
                      value={stop.facility_name}
                      onChange={(e) => patchStop(index, { facility_name: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <TextField
                      label={t('loads.form.line1')}
                      maxLength={200}
                      value={stop.line1}
                      onChange={(e) => patchStop(index, { line1: e.target.value })}
                    />
                  </div>
                  <TextField
                    label={t('loads.form.city')}
                    maxLength={120}
                    value={stop.city}
                    onChange={(e) => patchStop(index, { city: e.target.value })}
                  />
                  <CountryStateFields
                    country={stop.country}
                    state={stop.state}
                    onChange={(v) => patchStop(index, { country: v.country, state: v.state })}
                    stateLabel={t('loads.form.state')}
                  />
                  <TextField
                    label={t('loads.form.postalCode')}
                    maxLength={12}
                    value={stop.postal_code}
                    onChange={(e) => patchStop(index, { postal_code: e.target.value })}
                  />
                  <SelectField
                    label={t('loads.form.timezone')}
                    value={stop.timezone}
                    onChange={(e) => patchStop(index, { timezone: e.target.value })}
                    options={TIMEZONES.map((z) => ({ value: z, label: z.replace('America/', '') }))}
                  />
                  <SelectField
                    label={t('loads.form.appointmentType')}
                    value={stop.appointment_type}
                    onChange={(e) => patchStop(index, { appointment_type: e.target.value })}
                    options={['exact', 'window', 'fcfs', 'open'].map((a) => ({
                      value: a,
                      label: t(`loads.appointmentType.${a}`),
                    }))}
                  />
                  <TextField
                    label={t('loads.form.windowStart')}
                    type="datetime-local"
                    value={stop.window_start}
                    onChange={(e) => patchStop(index, { window_start: e.target.value })}
                  />
                  <TextField
                    label={t('loads.form.windowEnd')}
                    type="datetime-local"
                    value={stop.window_end}
                    onChange={(e) => patchStop(index, { window_end: e.target.value })}
                  />
                  <TextField
                    label={t('loads.form.contactName')}
                    maxLength={200}
                    value={stop.contact_name}
                    onChange={(e) => patchStop(index, { contact_name: e.target.value })}
                  />
                  <TextField
                    label={t('loads.form.contactPhone')}
                    maxLength={32}
                    value={stop.contact_phone}
                    onChange={(e) => patchStop(index, { contact_phone: e.target.value })}
                  />
                  <div className="sm:col-span-2">
                    <TextArea
                      label={t('loads.form.instructions')}
                      rows={2}
                      maxLength={2000}
                      value={stop.instructions}
                      onChange={(e) => patchStop(index, { instructions: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => addStop('pickup')}
              className="rounded border border-navy-600 px-3 py-1.5 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
            >
              + {t('loads.form.addPickup')}
            </button>
            <button
              type="button"
              onClick={() => addStop('delivery')}
              className="rounded border border-safety-600 px-3 py-1.5 text-sm font-medium text-safety-700 transition hover:bg-safety-50"
            >
              + {t('loads.form.addDelivery')}
            </button>
          </div>
        </fieldset>
        ) : null}

        <Section title={t('loads.requirements.title')}>
          <div className="sm:col-span-2">
            <p className="text-xs text-steel-600">{t('loads.requirements.hint')}</p>
          </div>

          <div className="sm:col-span-2 flex flex-col gap-4">
            {reqList.length === 0 ? (
              <p className="text-sm text-steel-600">{t('loads.requirements.empty')}</p>
            ) : null}

            {reqList.map((r, i) => (
              <div key={i} className="rounded border border-steel-200 bg-steel-50/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-bold uppercase tracking-[0.12em] text-safety-600">
                    {t(`loads.requirementType.${r.type}`)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeReq(i)}
                    className="text-xs font-medium text-danger-700 underline transition hover:text-danger-900"
                  >
                    {t('loads.requirements.remove')}
                  </button>
                </div>

                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <SelectField
                    label={t('loads.requirements.type')}
                    value={r.type}
                    onChange={(e) => patchReq(i, { type: e.target.value, value: '' })}
                    options={REQUIREMENT_TYPES.map((v) => ({
                      value: v,
                      label: t(`loads.requirementType.${v}`),
                    }))}
                  />

                  {/* La TWIC no lleva valor: o se exige o no. Los otros tres sí,
                      y cada uno con su propia lista. */}
                  {r.type === 'endorsement' ? (
                    <SelectField
                      label={t('loads.requirements.value')}
                      value={r.value}
                      onChange={(e) => patchReq(i, { value: e.target.value })}
                      options={[
                        { value: '', label: t('loads.requirements.chooseEndorsement') },
                        ...ENDORSEMENT_CODES.map((c) => ({ value: c, label: c })),
                      ]}
                    />
                  ) : null}

                  {r.type === 'work_authorization' ? (
                    <SelectField
                      label={t('loads.requirements.value')}
                      value={r.value}
                      onChange={(e) => patchReq(i, { value: e.target.value })}
                      options={[
                        { value: '', label: t('loads.requirements.chooseStatus') },
                        ...WORK_AUTHORIZATIONS.map((v) => ({
                          value: v,
                          label: t(`drivers.workAuthorization.${v}`),
                        })),
                      ]}
                    />
                  ) : null}

                  {r.type === 'clean_record' ? (
                    <SelectField
                      label={t('loads.requirements.value')}
                      value={r.value}
                      onChange={(e) => patchReq(i, { value: e.target.value })}
                      options={[
                        { value: '', label: t('loads.requirements.chooseYears') },
                        ...RECORD_YEARS.map((y) => ({ value: String(y), label: String(y) })),
                      ]}
                    />
                  ) : null}

                  <div className="sm:col-span-2">
                    <TextField
                      label={t('loads.requirements.source')}
                      /* En un requisito de estatus el servidor lo EXIGE: sin un
                         contrato que lo pida por escrito, esto no es una regla
                         de negocio. */
                      hint={
                        r.type === 'work_authorization'
                          ? t('loads.requirements.sourceRequired')
                          : t('loads.requirements.sourceHint')
                      }
                      required={r.type === 'work_authorization'}
                      maxLength={2000}
                      value={r.source}
                      onChange={(e) => patchReq(i, { source: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            ))}

            <div>
              <button
                type="button"
                onClick={addReq}
                className="rounded border border-steel-300 bg-white px-4 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
              >
                {t('loads.requirements.add')}
              </button>
              {form.errors.requirements ? (
                <p role="alert" className="mt-2 text-xs font-medium text-safety-700">
                  {form.errors.requirements}
                </p>
              ) : null}
            </div>
          </div>
        </Section>

        <Section title={t('loads.form.money')}>
          {canEditFreight ? (
          <MoneyField
            label={t('loads.form.customerCharge')}
            hint={t('loads.form.customerChargeHint')}
            cents={form.data.customer_charge_cents}
            onChange={(v) => form.setData('customer_charge_cents', v)}
            error={form.errors.customer_charge_cents}
          />
          ) : null}

          {/* Los campos del reparto solo existen si el servidor los mandó.
              El despachador puede fijar el precio de venta pero no la tarifa
              del transportista ni los porcentajes. */}
          {canEditFinancials ? (
            <>
              <MoneyField
                label={t('loads.form.carrierRate')}
                hint={t('loads.form.carrierRateHint')}
                cents={form.data.carrier_gross_rate_cents}
                onChange={(v) => form.setData('carrier_gross_rate_cents', v)}
                error={form.errors.carrier_gross_rate_cents}
              />
              <PercentField
                label={t('loads.form.dispatchFee')}
                bps={form.data.carrier_dispatch_fee_bps}
                onChange={(v) => form.setData('carrier_dispatch_fee_bps', v)}
                error={form.errors.carrier_dispatch_fee_bps}
              />
              <PercentField
                label={t('loads.form.commission')}
                bps={form.data.dispatcher_commission_bps}
                onChange={(v) => form.setData('dispatcher_commission_bps', v)}
                error={form.errors.dispatcher_commission_bps}
              />
            </>
          ) : (
            <p className="self-end text-xs text-steel-600">{t('loads.form.financialsLocked')}</p>
          )}
        </Section>

        {canEditFreight ? (
        <Section title={t('loads.form.notes')}>
          <div className="sm:col-span-2">
            <TextArea
              label={t('loads.form.specialInstructions')}
              hint={t('loads.form.specialInstructionsHint')}
              maxLength={5000}
              value={form.data.special_instructions}
              onChange={(e) => form.setData('special_instructions', e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <TextArea
              label={t('loads.form.internalNotes')}
              hint={t('loads.form.internalNotesHint')}
              maxLength={5000}
              value={form.data.internal_notes}
              onChange={(e) => form.setData('internal_notes', e.target.value)}
            />
          </div>
        </Section>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={form.processing}
            className="rounded bg-safety-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {form.processing
              ? t('common.states.saving')
              : t(editing ? 'loads.form.saveChanges' : 'loads.form.save')}
          </button>
          <Link
            href={editing ? `/loads/${String(load?.id)}` : '/loads'}
            className="rounded border border-steel-300 px-4 py-2.5 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
          >
            {t('loads.form.cancel')}
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

function NumberField({
  label, value, onChange, error,
}: { label: string; value: number | null; onChange: (v: number | null) => void; error?: string }) {
  return (
    <TextField
      label={label}
      type="number"
      min={0}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      error={error}
    />
  )
}

/**
 * Dinero: dólares en pantalla, centavos por dentro.
 *
 * La conversión ocurre en el borde, una sola vez. Nada de guardar dólares con
 * coma y redondear al enviar — ver docs/finanzas.md.
 */
function MoneyField({
  label, hint, cents, onChange, error,
}: {
  label: string
  hint?: string
  cents: number | null
  onChange: (v: number | null) => void
  error?: string
}) {
  return (
    <TextField
      label={label}
      hint={hint}
      type="number"
      min={0}
      step={0.01}
      value={cents === null ? '' : cents / 100}
      onChange={(e) => onChange(e.target.value === '' ? null : Math.round(Number(e.target.value) * 100))}
      error={error}
    />
  )
}

/** Porcentaje en pantalla, puntos básicos por dentro. */
function PercentField({
  label, bps, onChange, error,
}: { label: string; bps: number | null; onChange: (v: number | null) => void; error?: string }) {
  return (
    <TextField
      label={label}
      type="number"
      min={0}
      max={100}
      step={0.25}
      value={bps === null ? '' : bps / 100}
      onChange={(e) => onChange(e.target.value === '' ? null : Math.round(Number(e.target.value) * 100))}
      error={error}
    />
  )
}

function IconButton({
  children, label, onClick, disabled, danger,
}: {
  children: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`h-7 w-7 rounded border text-sm leading-none transition disabled:cursor-not-allowed disabled:opacity-30 ${
        danger
          ? 'border-danger-300 text-danger-700 hover:bg-danger-50'
          : 'border-steel-300 text-steel-700 hover:bg-white'
      }`}
    >
      {children}
    </button>
  )
}
