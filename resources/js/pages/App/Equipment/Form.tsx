import { Link, useForm } from '@inertiajs/react'
import { useRef, useState, type ReactNode } from 'react'
import { CountryStateFields } from '@/components/Form/CountryStateFields'
import { CheckboxField, SelectField, TextArea, TextField } from '@/components/Form/Field'
import { FeetInchesField } from '@/components/Form/FeetInchesField'
import { SearchableSelect } from '@/components/Form/SearchableSelect'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'
import { splitInches, type FeetInches } from '@/lib/measure'

/** Los tres nombres de la propiedad, en el orden en que se ofrecen. */
const PROPIEDADES = ['owned', 'leased', 'lease_to_own'] as const

interface Props {
  type: 'trucks' | 'trailers'
  unit: Record<string, unknown> | null
  choices: {
    carriers: { id: string; name: string }[]
    equipmentTypes: { id: string; code: string; labelEn: string; labelEs: string }[]
  }
}

export default function EquipmentForm({ type, unit, choices }: Props) {
  const { t, locale } = useI18n()
  const editing = unit !== null
  const isTrailer = type === 'trailers'

  const g = (key: string): string => {
    const v = unit?.[key]
    return v === null || v === undefined ? '' : String(v)
  }
  const n = (key: string): number | null => {
    const v = unit?.[key]
    return typeof v === 'number' ? v : null
  }
  const date = (key: string): string => String(unit?.[key] ?? '').slice(0, 10)

  /*
   * Lo guardado viene en pulgadas —una cifra— y las casillas son dos. Se parte
   * UNA vez, al montar: a partir de ahí las dos casillas guardan lo que se
   * escribió en ellas, y es el servidor quien vuelve a sumarlas. Ver
   * `lib/measure.ts`.
   */
  const medida = (key: string): FeetInches => splitInches(n(key))

  const huecosGuardados: FeetInches[] = Array.isArray(unit?.axleSpacings)
    ? (unit.axleSpacings as number[]).map((v) => splitInches(v))
    : []

  const form = useForm({
    carrier_id: g('carrierId'),
    unit_number: g('unitNumber'),
    vin: g('vin'),
    year: n('year'),
    make: g('make'),
    model: g('model'),
    equipment_type_id: g('equipmentTypeId'),
    plate_number: g('plateNumber'),
    plate_country: g('plateCountry') || 'US',
    plate_state: g('plateState'),
    registration_number: g('registrationNumber'),
    registration_expires_at: date('registrationExpiresAt'),
    last_inspection_at: date('lastInspectionAt'),
    next_inspection_due_at: date('nextInspectionDueAt'),
    status: g('status') || 'pending_verification',
    notes: g('notes'),
    ownership: g('ownership') || 'owned',
    lessor_name: g('lessorName'),
    lease_ends_on: date('leaseEndsOn'),
    // Las cinco medidas van en el estado aunque cada clase de unidad enseñe
    // solo las suyas. El servidor valida las de SU tipo y descarta el resto:
    // `EquipmentController::medidasDe()` es quien decide cuáles son.
    length_feet: medida('lengthInches').feet,
    length_inches: medida('lengthInches').inches,
    width_feet: medida('widthInches').feet,
    width_inches: medida('widthInches').inches,
    height_feet: medida('heightInches').feet,
    height_inches: medida('heightInches').inches,
    deck_height_feet: medida('deckHeightInches').feet,
    deck_height_inches: medida('deckHeightInches').inches,
    well_length_feet: medida('wellLengthInches').feet,
    well_length_inches: medida('wellLengthInches').inches,
    capacity_pounds: n('capacityPounds'),
    axle_count: n('axleCount'),
    axle_configuration: g('axleConfiguration'),
    axle_spacings: huecosGuardados,
    removable_gooseneck: Boolean(unit?.removableGooseneck),
    is_extendable: Boolean(unit?.isExtendable),
  })

  const arrendada = form.data.ownership !== 'owned'
  const huecos = Math.max(0, (form.data.axle_count ?? 0) - 1)

  /*
   * El número de ejes manda sobre cuántos huecos hay: con cinco ejes, cuatro
   * distancias. Bajar el número BORRA las de más, aquí y al guardar, porque un
   * hueco número cuatro de una unidad que ya solo tiene tres ejes no es un dato
   * que se pueda conservar por si acaso: es basura que después se enseña.
   */
  const ponerEjes = (v: number | null) => {
    const cuantos = Math.max(0, (v ?? 0) - 1)

    form.setData((d) => ({
      ...d,
      axle_count: v,
      axle_spacings: Array.from(
        { length: cuantos },
        (_, i) => d.axle_spacings[i] ?? { feet: null, inches: null },
      ),
    }))
  }

  const campoMedida = (
    clave: 'length' | 'width' | 'height' | 'deck_height' | 'well_length',
    label: string,
  ) => (
    <FeetInchesField
      label={label}
      feet={form.data[`${clave}_feet`]}
      inches={form.data[`${clave}_inches`]}
      onChange={(v) => {
        form.setData((d) => ({ ...d, [`${clave}_feet`]: v.feet, [`${clave}_inches`]: v.inches }))
      }}
      feetLabel={t('equipment.form.feet')}
      inchesLabel={t('equipment.form.inches')}
      error={form.errors[`${clave}_feet`] ?? form.errors[`${clave}_inches`]}
    />
  )

  /*
   * El error de un hueco llega con la clave anidada que puso el servidor
   * —`axle_spacings.2.inches`—, y el tipo de errores de Inertia solo conoce
   * los campos de primer nivel. La conversión es solo para leerlo.
   */
  const errorDeHueco = (i: number): string | undefined =>
    (form.errors as Record<string, string | undefined>)[`axle_spacings.${String(i)}.inches`]

  const ponerHueco = (i: number, v: FeetInches) => {
    form.setData((d) => ({
      ...d,
      axle_spacings: d.axle_spacings.map((h, j) => (j === i ? v : h)),
    }))
  }

  const elegido = choices.carriers.find((c) => c.id === form.data.carrier_id) ?? null

  /*
   * El VIN rellena marca, modelo y año — SOLO lo que esté en blanco.
   *
   * Lo que la persona ya escribió no se toca nunca: en equipos viejos el dato
   * del fabricante y el de la placa no siempre coinciden, y quien corrigió uno
   * a mano tenía una razón. Debajo del campo se dice qué se rellenó y de
   * dónde salió, con un enlace para deshacerlo.
   *
   * El año y la marca los lee el servidor del propio número; el modelo solo
   * aparece si la instalación tiene encendida la consulta a la NHTSA, porque
   * el modelo no está en el VIN de forma legible.
   */
  const [vinEstado, setVinEstado] = useState<
    { estado: 'consultando' } | { estado: 'listo'; campos: string[]; live: boolean } | { estado: 'sinSuma' } | null
  >(null)
  const antesDelVin = useRef<{ make: string; model: string; year: number | null } | null>(null)
  const pedido = useRef(0)

  const consultarVin = async (vin: string) => {
    const limpio = vin.replace(/[^A-Za-z0-9]/g, '').toUpperCase()

    // Solo con el número completo. Consultar a cada tecla sería una llamada
    // por carácter y diecisiete respuestas que no sirven.
    if (limpio.length !== 17) {
      setVinEstado(null)

      return
    }

    const mio = ++pedido.current
    setVinEstado({ estado: 'consultando' })

    try {
      const r = await fetch(`/equipment/${type}/vin/${limpio}`, {
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      })

      // Una respuesta vieja que llega tarde no puede pisar a una nueva: se
      // escribe deprisa y el orden de vuelta no está garantizado.
      if (mio !== pedido.current) return

      if (! r.ok) {
        setVinEstado(null)

        return
      }

      const datos = await r.json()

      if (mio !== pedido.current) return

      if (datos.wellFormed === true && datos.checksumOk === false) {
        setVinEstado({ estado: 'sinSuma' })

        return
      }

      const d = datos.decoded

      if (d === null || d === undefined) {
        setVinEstado(null)

        return
      }

      antesDelVin.current = { make: form.data.make, model: form.data.model, year: form.data.year }

      const rellenados: string[] = []

      if (form.data.make === '' && typeof d.make === 'string' && d.make !== '') {
        form.setData('make', d.make)
        rellenados.push(t('equipment.form.make'))
      }

      if (form.data.model === '' && typeof d.model === 'string' && d.model !== '') {
        form.setData('model', d.model)
        rellenados.push(t('equipment.form.model'))
      }

      if (form.data.year === null && typeof d.year === 'number') {
        form.setData('year', d.year)
        rellenados.push(t('equipment.form.year'))
      }

      setVinEstado(rellenados.length === 0 ? null : { estado: 'listo', campos: rellenados, live: datos.live === true })
    } catch {
      // Sin red, o el servidor contestando cualquier cosa: el formulario sigue
      // siendo un formulario y la persona escribe los campos.
      if (mio === pedido.current) setVinEstado(null)
    }
  }

  const deshacerVin = () => {
    const antes = antesDelVin.current

    if (antes === null) return

    form.setData('make', antes.make)
    form.setData('model', antes.model)
    form.setData('year', antes.year)
    setVinEstado(null)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editing) form.patch(`/equipment/${type}/${String(unit?.id)}`)
    else form.post(`/equipment/${type}`)
  }

  const title = editing
    ? t('equipment.form.editTitle', { unit: g('unitNumber') })
    : t(isTrailer ? 'equipment.form.createTrailerTitle' : 'equipment.form.createTruckTitle')

  return (
    <AppLayout
      title={title}
      description={t(editing ? 'equipment.form.editSubtitle' : 'equipment.form.createSubtitle')}
      crumbs={[
        {
          label: t(isTrailer ? 'equipment.index.trailersTitle' : 'equipment.index.trucksTitle'),
          href: `/equipment/${type}`,
        },
        ...(editing ? [{ label: g('unitNumber'), href: `/equipment/${type}/${String(unit?.id)}` }] : []),
        { label: title },
      ]}
    >
      <form onSubmit={submit} className="flex max-w-3xl flex-col gap-6">
        <Section title={t('equipment.form.identity')}>
          <div className="sm:col-span-2">
            {/* Se busca escribiendo. Un desplegable deja de servir alrededor de
                los treinta transportistas y es hostil a los doscientos: quien
                da de alta un camión no quiere recorrer la lista, quiere
                escribir tres letras. Mismo componente que el alta de
                conductores, para que los dos se comporten igual. */}
            <SearchableSelect
              label={t('equipment.form.carrier')}
              required
              choices={choices.carriers.map((c) => ({ id: c.id, name: c.name }))}
              selected={elegido}
              onPick={(id) => form.setData('carrier_id', id)}
              onClear={() => form.setData('carrier_id', '')}
              placeholder={t('equipment.form.carrierSearchPlaceholder')}
              emptyText={t('equipment.form.noCarrierMatches')}
              changeText={t('common.actions.change')}
              error={form.errors.carrier_id}
            />
          </div>

          <TextField
            label={t('equipment.form.unitNumber')}
            hint={t('equipment.form.unitNumberHint')}
            required
            maxLength={40}
            value={form.data.unit_number}
            onChange={(e) => form.setData('unit_number', e.target.value)}
            error={form.errors.unit_number}
          />
          <div>
            <TextField
              label={t('equipment.form.vin')}
              hint={t('equipment.form.vinHint')}
              maxLength={32}
              value={form.data.vin}
              onChange={(e) => {
                const v = e.target.value.toUpperCase()
                form.setData('vin', v)
                void consultarVin(v)
              }}
              error={form.errors.vin}
            />

            {vinEstado?.estado === 'consultando' ? (
              <p className="mt-1 text-xs text-steel-600">{t('equipment.form.vinLooking')}</p>
            ) : null}

            {vinEstado?.estado === 'sinSuma' ? (
              // Ni se consulta ni se rellena nada: es casi siempre una errata
              // al copiar el número, y rellenar marca y año de otro vehículo
              // sería peor que no rellenar.
              <p className="mt-1 text-xs text-warning-700">{t('equipment.form.vinChecksum')}</p>
            ) : null}

            {vinEstado?.estado === 'listo' ? (
              <p className="mt-1 text-xs text-steel-700">
                {t(vinEstado.live ? 'equipment.form.vinFilledLive' : 'equipment.form.vinFilledOffline', {
                  fields: vinEstado.campos.join(', '),
                })}{' '}
                <button
                  type="button"
                  onClick={deshacerVin}
                  className="font-medium text-navy-700 underline transition hover:text-navy-900"
                >
                  {t('equipment.form.vinUndo')}
                </button>
              </p>
            ) : null}
          </div>
          <TextField
            label={t('equipment.form.year')}
            type="number"
            min={1950}
            max={2100}
            value={form.data.year ?? ''}
            onChange={(e) => form.setData('year', e.target.value === '' ? null : Number(e.target.value))}
            error={form.errors.year}
          />
          <SelectField
            label={t('equipment.form.equipmentType')}
            value={form.data.equipment_type_id}
            onChange={(e) => form.setData('equipment_type_id', e.target.value)}
            options={[
              { value: '', label: t('equipment.form.anyType') },
              ...choices.equipmentTypes.map((e) => ({
                value: e.id,
                label: locale === 'es' ? e.labelEs : e.labelEn,
              })),
            ]}
          />
          <TextField
            label={t('equipment.form.make')}
            maxLength={60}
            value={form.data.make}
            onChange={(e) => form.setData('make', e.target.value)}
          />
          <TextField
            label={t('equipment.form.model')}
            maxLength={60}
            value={form.data.model}
            onChange={(e) => form.setData('model', e.target.value)}
          />
        </Section>

        <Section title={t('equipment.form.registration')}>
          <TextField
            label={t('equipment.form.plate')}
            maxLength={20}
            value={form.data.plate_number}
            onChange={(e) => form.setData('plate_number', e.target.value.toUpperCase())}
          />
          <CountryStateFields
            country={form.data.plate_country}
            state={form.data.plate_state}
            onChange={(v) =>
              form.setData((d) => ({ ...d, plate_country: v.country, plate_state: v.state }))
            }
            countryError={form.errors.plate_country}
            stateError={form.errors.plate_state}
            stateLabel={t('equipment.form.plateState')}
          />
          <TextField
            label={t('equipment.form.registrationNumber')}
            maxLength={60}
            value={form.data.registration_number}
            onChange={(e) => form.setData('registration_number', e.target.value)}
          />
          <TextField
            label={t('equipment.form.registrationExpires')}
            type="date"
            value={form.data.registration_expires_at}
            onChange={(e) => form.setData('registration_expires_at', e.target.value)}
            error={form.errors.registration_expires_at}
          />
          <TextField
            label={t('equipment.form.lastInspection')}
            type="date"
            value={form.data.last_inspection_at}
            onChange={(e) => form.setData('last_inspection_at', e.target.value)}
          />
          <TextField
            label={t('equipment.form.nextInspection')}
            type="date"
            value={form.data.next_inspection_due_at}
            onChange={(e) => form.setData('next_inspection_due_at', e.target.value)}
          />
        </Section>

        <Section title={t('equipment.form.ownershipSection')}>
          <SelectField
            label={t('equipment.form.ownership')}
            value={form.data.ownership}
            onChange={(e) => form.setData('ownership', e.target.value)}
            options={PROPIEDADES.map((v) => ({
              value: v,
              label: t(`equipment.ownership.${v}`),
            }))}
            error={form.errors.ownership}
          />
          {arrendada ? (
            <TextField
              label={t('equipment.form.lessorName')}
              hint={t('equipment.form.lessorHint')}
              maxLength={160}
              value={form.data.lessor_name}
              onChange={(e) => form.setData('lessor_name', e.target.value)}
              error={form.errors.lessor_name}
            />
          ) : (
            /* Y se dice, porque al guardar se borran: quien pasa una unidad
               arrendada a propia no tiene por qué adivinar que el nombre del
               arrendador y la fecha se van con el cambio. */
            <p className="self-center text-xs text-steel-600">
              {t('equipment.form.ownershipOwnedHint')}
            </p>
          )}
          {arrendada ? (
            <TextField
              label={t('equipment.form.leaseEndsOn')}
              type="date"
              value={form.data.lease_ends_on}
              onChange={(e) => form.setData('lease_ends_on', e.target.value)}
              error={form.errors.lease_ends_on}
            />
          ) : null}
        </Section>

        <Section title={t(isTrailer ? 'equipment.form.dimensions' : 'equipment.form.dimensionsTruck')}>
          {campoMedida('length', t('equipment.form.length'))}
          {campoMedida('width', t('equipment.form.width'))}
          {isTrailer ? campoMedida('deck_height', t('equipment.form.deckHeight')) : null}
          {isTrailer ? campoMedida('well_length', t('equipment.form.wellLength')) : null}
          {isTrailer ? null : campoMedida('height', t('equipment.form.height'))}
          {isTrailer ? (
            <NumberField
              label={t('equipment.form.capacity')}
              value={form.data.capacity_pounds}
              onChange={(v) => form.setData('capacity_pounds', v)}
            />
          ) : null}
          <NumberField
            label={t('equipment.form.axles')}
            value={form.data.axle_count}
            onChange={ponerEjes}
          />
          <TextField
            label={t('equipment.form.axleConfiguration')}
            maxLength={60}
            value={form.data.axle_configuration}
            onChange={(e) => form.setData('axle_configuration', e.target.value)}
            error={form.errors.axle_configuration}
          />
          <div className="sm:col-span-2">
            <p className="text-sm font-medium text-carbon">{t('equipment.form.axleSpacings')}</p>
            {huecos === 0 ? (
              <p className="mt-1 text-xs text-steel-600">
                {t('equipment.form.axleSpacingsNeedCount')}
              </p>
            ) : (
              <>
                <p className="mt-1 text-xs text-steel-600">
                  {t('equipment.form.axleSpacingsHint')}
                </p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {Array.from({ length: huecos }, (_, i) => (
                    <FeetInchesField
                      key={i}
                      label={t('equipment.form.axleSpacingPair', {
                        from: String(i + 1),
                        to: String(i + 2),
                      })}
                      feet={form.data.axle_spacings[i]?.feet ?? null}
                      inches={form.data.axle_spacings[i]?.inches ?? null}
                      onChange={(v) => { ponerHueco(i, v) }}
                      feetLabel={t('equipment.form.feet')}
                      inchesLabel={t('equipment.form.inches')}
                      error={errorDeHueco(i)}
                    />
                  ))}
                </div>
              </>
            )}
            {form.errors.axle_spacings ? (
              <p role="alert" className="mt-2 text-xs font-medium text-safety-700">
                {form.errors.axle_spacings}
              </p>
            ) : null}
          </div>
          {isTrailer ? (
            <div className="self-end">
              <CheckboxField
                label={t('equipment.form.removableGooseneck')}
                checked={form.data.removable_gooseneck}
                onChange={(e) => form.setData('removable_gooseneck', e.target.checked)}
              />
            </div>
          ) : null}
          {isTrailer ? (
            <div className="self-end">
              <CheckboxField
                label={t('equipment.form.extendable')}
                checked={form.data.is_extendable}
                onChange={(e) => form.setData('is_extendable', e.target.checked)}
              />
            </div>
          ) : null}
        </Section>

        <Section title={t('equipment.form.notesSection')}>
          <div className="sm:col-span-2">
            <TextArea
              label={t('equipment.form.notes')}
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
              : t(editing ? 'equipment.form.saveChanges' : 'equipment.form.save')}
          </button>
          <Link
            href={editing ? `/equipment/${type}/${String(unit?.id)}` : `/equipment/${type}`}
            className="rounded border border-steel-300 px-4 py-2.5 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
          >
            {t('equipment.form.cancel')}
          </Link>
        </div>
      </form>
    </AppLayout>
  )
}

function NumberField({
  label, value, onChange,
}: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <TextField
      label={label}
      type="number"
      min={0}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
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
