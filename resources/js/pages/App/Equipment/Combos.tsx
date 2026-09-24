import { router, useForm } from '@inertiajs/react'
import { useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { EquipmentTabs } from '@/components/App/Equipment/Tabs'
import { FeetInchesField } from '@/components/Form/FeetInchesField'
import { SearchableSelect } from '@/components/Form/SearchableSelect'
import { TextField } from '@/components/Form/Field'
import { formatDay } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import { formatInches, splitInches } from '@/lib/measure'

/**
 * Los conjuntos: qué mide un camión CON un remolque.
 *
 * ## Qué enseña esta pantalla que no enseña ninguna ficha
 *
 * La cadena entera de la combinación. La ficha del camión sabe sus huecos y la
 * del remolque los suyos; el tramo de en medio —de la última tracción al
 * primer eje del remolque— no es de ninguna de las dos, y sin él la distancia
 * del primer eje al último no se puede calcular.
 *
 * ## El total aparece o no aparece
 *
 * Y no aparece a medias. Si falta un hueco en cualquiera de las dos fichas, o
 * falta el número de ejes, o falta el enganche, la fila lo dice y no enseña
 * suma: un total al que le falta un tramo es un número que se parece a la
 * distancia de un permiso sin serlo, y ese número acabaría copiado en un papel.
 */
interface Combo {
  key: string
  truckId: string
  truck: string
  truckLabel: string | null
  truckAxles: number | null
  truckSpacings: number[]
  trailerId: string
  trailer: string
  trailerLabel: string | null
  trailerAxles: number | null
  trailerSpacings: number[]
  driveToTrailerInches: number | null
  bumperToBumperInches: number | null
  kingpinToRearInches: number | null
  kingpinToTrailerAxlesInches: number | null
  measuredOn: string | null
  notes: string | null
  axles: number | null
  /** Nula mientras falte una pieza. Ver la cabecera. */
  chain: number[] | null
  overallInches: number | null
  driver: string | null
}

interface Props {
  combos: Combo[]
  /** El alcance del que mira, tal como lo manda el servidor. */
  scope: string
  choices: { trucks: { id: string; name: string }[]; trailers: { id: string; name: string }[] } | null
  can: { update: boolean }
}

export default function Combos({ combos, scope, choices, can }: Props) {
  const { t, locale } = useI18n()
  const [abierto, setAbierto] = useState<Combo | 'nuevo' | null>(null)

  const sinMedir = combos.filter((c) => c.driveToTrailerInches === null).length

  return (
    <AppLayout
      title={t('equipment.combos.title')}
      description={t('equipment.combos.hint')}
      crumbs={[{ label: t('equipment.combos.title') }]}
      actions={
        can.update && choices !== null ? (
          <button
            type="button"
            onClick={() => { setAbierto('nuevo') }}
            className="rounded bg-safety-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-safety-700"
          >
            {t('equipment.combos.add')}
          </button>
        ) : null
      }
    >
      <EquipmentTabs active="combos" />

      {sinMedir === 0 ? null : (
        <p className="mt-4 rounded border border-warning-300 bg-warning-50 px-3 py-2 text-sm text-warning-800">
          {t('equipment.combos.pending', { n: sinMedir })}
        </p>
      )}

      {abierto !== null && choices !== null ? (
        <Formulario
          combo={abierto === 'nuevo' ? null : abierto}
          choices={choices}
          onCerrar={() => { setAbierto(null) }}
        />
      ) : null}

      {combos.length === 0 ? (
        /* El panel de vacío va escrito aquí y no con `EmptyState` porque este
           dominio no encaja en sus cuatro ramas: un conjunto no se «da de
           alta» en una lista —nace de una asignación o de una medida— así que
           la rama de «agregue el primero» no dice la verdad. Lo que sí se
           conserva es la lección que hizo nacer aquel componente: quien tiene
           el alcance acotado lee que la lista está ACOTADA, y no que la
           empresa no tenga ninguno. */
        <div className="mt-6 rounded border border-dashed border-steel-300 bg-white p-10 text-center">
          <p className="font-display text-lg font-bold text-navy-700">
            {t(scope === 'tenant' || scope === 'platform'
              ? 'equipment.combos.empty'
              : `common.states.scoped.${scope}`)}
          </p>
          <p className="mt-1 text-sm text-steel-700">
            {t(scope === 'tenant' || scope === 'platform'
              ? 'equipment.combos.emptyHint'
              : `common.states.scoped.${scope}Hint`)}
          </p>
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {combos.map((c) => (
            <li key={c.key} className="rounded border border-steel-200 bg-white p-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm font-semibold tabular-nums text-carbon">
                  {c.truck} · {c.trailer}
                </span>
                {c.axles === null ? null : (
                  <span className="text-xs text-steel-600">
                    {c.axles} {t('equipment.combos.axles').toLowerCase()}
                  </span>
                )}
                {c.driver === null ? null : (
                  <span className="rounded bg-navy-50 px-1.5 py-0.5 text-[11px] font-medium text-navy-700">
                    {c.driver}
                  </span>
                )}
                {c.driveToTrailerInches === null ? (
                  <span className="rounded bg-warning-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning-800">
                    {t('equipment.combos.notMeasured')}
                  </span>
                ) : null}
                {can.update && choices !== null ? (
                  <span className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setAbierto(c) }}
                      className="rounded border border-steel-300 px-2.5 py-1 text-xs font-medium text-navy-700 transition hover:bg-navy-50"
                    >
                      {t(c.driveToTrailerInches === null ? 'equipment.combos.measure' : 'equipment.combos.update')}
                    </button>
                    {c.driveToTrailerInches === null ? null : (
                      <button
                        type="button"
                        onClick={() => {
                          router.delete(`/equipment/combos/${c.truckId}/${c.trailerId}`, {
                            preserveScroll: true,
                          })
                        }}
                        className="rounded border border-steel-300 px-2.5 py-1 text-xs font-medium text-navy-700 transition hover:bg-navy-50"
                      >
                        {t('equipment.combos.forget')}
                      </button>
                    )}
                  </span>
                ) : null}
              </div>

              <p className="mt-0.5 text-xs text-steel-600">
                {[c.truckLabel, c.trailerLabel].filter((v) => v !== null).join(' · ')}
              </p>

              {/* La cadena, de delante atrás, con el tramo del conjunto
                  marcado: es el único que no sale de ninguna ficha. */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs tabular-nums">
                {c.truckSpacings.map((v, i) => (
                  <Tramo key={`t${String(i)}`} texto={formatInches(v) ?? '—'} />
                ))}
                <Tramo
                  texto={c.driveToTrailerInches === null ? '—' : (formatInches(c.driveToTrailerInches) ?? '—')}
                  destacado
                  titulo={t('equipment.combos.hitchGap')}
                />
                {c.trailerSpacings.map((v, i) => (
                  <Tramo key={`r${String(i)}`} texto={formatInches(v) ?? '—'} />
                ))}
              </div>

              {c.overallInches === null ? (
                <p className="mt-2 text-xs text-steel-600">{t('equipment.combos.chainIncomplete')}</p>
              ) : (
                <p className="mt-2 text-sm font-medium tabular-nums text-carbon">
                  {formatInches(c.overallInches)}{' '}
                  <span className="text-xs font-normal text-steel-600">
                    · {t('equipment.combos.overall')}
                  </span>
                </p>
              )}

              {c.bumperToBumperInches === null
              && c.kingpinToRearInches === null
              && c.kingpinToTrailerAxlesInches === null ? null : (
                <dl className="mt-3 grid gap-x-6 gap-y-1 border-t border-steel-100 pt-3 text-xs sm:grid-cols-3">
                  <Dato etiqueta={t('equipment.combos.bumperToBumper')} valor={formatInches(c.bumperToBumperInches)} />
                  <Dato etiqueta={t('equipment.combos.kingpinToRear')} valor={formatInches(c.kingpinToRearInches)} />
                  <Dato
                    etiqueta={t('equipment.combos.kingpinToTrailerAxles')}
                    valor={formatInches(c.kingpinToTrailerAxlesInches)}
                  />
                </dl>
              )}

              {c.notes === null || c.notes === '' ? null : (
                <p className="mt-2 text-xs text-steel-700">{c.notes}</p>
              )}

              {c.measuredOn === null ? null : (
                <p className="mt-1 text-[11px] text-steel-500">
                  {t('equipment.combos.measuredOn')}: {formatDay(c.measuredOn, locale)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </AppLayout>
  )
}

function Tramo({ texto, destacado, titulo }: { texto: string; destacado?: boolean; titulo?: string }) {
  return (
    <>
      <span
        title={titulo}
        className={`rounded px-1.5 py-0.5 ${
          destacado === true
            ? 'bg-safety-50 font-semibold text-safety-800 ring-1 ring-safety-200'
            : 'bg-steel-50 text-steel-700'
        }`}
      >
        {texto}
      </span>
    </>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  return (
    <div>
      <dt className="text-steel-600">{etiqueta}</dt>
      <dd className="tabular-nums text-carbon">{valor ?? '—'}</dd>
    </div>
  )
}

/**
 * El formulario: una pareja y sus medidas.
 *
 * El camión y el remolque solo se eligen cuando la pareja es nueva. Cambiarlos
 * sobre una medida existente no sería corregirla: sería medir otra cosa y
 * llamarla igual.
 */
function Formulario({
  combo,
  choices,
  onCerrar,
}: {
  combo: Combo | null
  choices: { trucks: { id: string; name: string }[]; trailers: { id: string; name: string }[] }
  onCerrar: () => void
}) {
  const { t } = useI18n()

  const form = useForm({
    truck_id: combo?.truckId ?? '',
    trailer_id: combo?.trailerId ?? '',
    drive_to_trailer: splitInches(combo?.driveToTrailerInches),
    bumper_to_bumper: splitInches(combo?.bumperToBumperInches),
    kingpin_to_rear: splitInches(combo?.kingpinToRearInches),
    kingpin_to_trailer_axles: splitInches(combo?.kingpinToTrailerAxlesInches),
    measured_on: combo?.measuredOn ?? '',
    notes: combo?.notes ?? '',
  })

  const camion = choices.trucks.find((c) => c.id === form.data.truck_id) ?? null
  const remolque = choices.trailers.find((c) => c.id === form.data.trailer_id) ?? null

  const error = (campo: string): string | undefined =>
    (form.errors as Record<string, string | undefined>)[campo]

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.post('/equipment/combos', { preserveScroll: true, onSuccess: onCerrar })
      }}
      className="mt-4 flex flex-col gap-4 rounded border border-steel-200 bg-white p-4"
    >
      {combo === null ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <SearchableSelect
            label={t('equipment.combos.truck')}
            required
            choices={choices.trucks}
            selected={camion}
            onPick={(id) => form.setData('truck_id', id)}
            onClear={() => form.setData('truck_id', '')}
            placeholder={t('equipment.combos.truck')}
            emptyText={t('equipment.combos.truck')}
            changeText={t('common.actions.change')}
            error={form.errors.truck_id}
          />
          <SearchableSelect
            label={t('equipment.combos.trailer')}
            required
            choices={choices.trailers}
            selected={remolque}
            onPick={(id) => form.setData('trailer_id', id)}
            onClear={() => form.setData('trailer_id', '')}
            placeholder={t('equipment.combos.trailer')}
            emptyText={t('equipment.combos.trailer')}
            changeText={t('common.actions.change')}
            error={form.errors.trailer_id}
          />
        </div>
      ) : (
        <p className="text-sm font-semibold tabular-nums text-carbon">
          {combo.truck} · {combo.trailer}
        </p>
      )}

      <FeetInchesField
        label={t('equipment.combos.hitchGap')}
        feet={form.data.drive_to_trailer.feet}
        inches={form.data.drive_to_trailer.inches}
        onChange={(v) => form.setData('drive_to_trailer', v)}
        feetLabel={t('equipment.combos.feet')}
        inchesLabel={t('equipment.combos.inches')}
        error={error('drive_to_trailer.inches') ?? error('drive_to_trailer.feet')}
      />

      <div className="border-t border-steel-100 pt-4">
        <p className="text-sm font-medium text-carbon">{t('equipment.combos.permitFigures')}</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <FeetInchesField
            label={t('equipment.combos.bumperToBumper')}
            feet={form.data.bumper_to_bumper.feet}
            inches={form.data.bumper_to_bumper.inches}
            onChange={(v) => form.setData('bumper_to_bumper', v)}
            feetLabel={t('equipment.combos.feet')}
            inchesLabel={t('equipment.combos.inches')}
            error={error('bumper_to_bumper.inches') ?? error('bumper_to_bumper.feet')}
          />
          <FeetInchesField
            label={t('equipment.combos.kingpinToRear')}
            feet={form.data.kingpin_to_rear.feet}
            inches={form.data.kingpin_to_rear.inches}
            onChange={(v) => form.setData('kingpin_to_rear', v)}
            feetLabel={t('equipment.combos.feet')}
            inchesLabel={t('equipment.combos.inches')}
            error={error('kingpin_to_rear.inches') ?? error('kingpin_to_rear.feet')}
          />
          <FeetInchesField
            label={t('equipment.combos.kingpinToTrailerAxles')}
            feet={form.data.kingpin_to_trailer_axles.feet}
            inches={form.data.kingpin_to_trailer_axles.inches}
            onChange={(v) => form.setData('kingpin_to_trailer_axles', v)}
            feetLabel={t('equipment.combos.feet')}
            inchesLabel={t('equipment.combos.inches')}
            error={error('kingpin_to_trailer_axles.inches') ?? error('kingpin_to_trailer_axles.feet')}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t('equipment.combos.measuredOn')}
          type="date"
          value={form.data.measured_on}
          onChange={(e) => form.setData('measured_on', e.target.value)}
          error={form.errors.measured_on}
        />
        <TextField
          label={t('equipment.combos.notes')}
          hint={t('equipment.combos.notesHint')}
          value={form.data.notes}
          onChange={(e) => form.setData('notes', e.target.value)}
          error={form.errors.notes}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={form.processing}
          className="rounded bg-safety-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-safety-700 disabled:opacity-50"
        >
          {t('common.actions.save')}
        </button>
        <button
          type="button"
          onClick={onCerrar}
          className="rounded border border-steel-300 px-3 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
        >
          {t('common.actions.cancel')}
        </button>
      </div>
    </form>
  )
}
