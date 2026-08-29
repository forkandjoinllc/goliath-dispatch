import { router, useForm } from '@inertiajs/react'
import { useState } from 'react'
import { SearchableSelect } from '@/components/Form/SearchableSelect'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Assignment {
  id: string
  type: string
  resourceId: string
  label: string
  startDate: string
  endDate: string | null
}

interface Dispatcher {
  userId: string
  name: string
  email: string
  status: string
  commissionBps: number
  hasProfile: boolean
  assignments: Assignment[]
}

interface Choice {
  id: string
  name: string
  hint: string | null
}

interface Group {
  id: string
  name: string
  description: string | null
  active: boolean
  members: { id: string; type: string; label: string }[]
}

interface Props {
  dispatchers: Dispatcher[]
  groups: Group[]
  resources: Record<string, Choice[]> | null
  types: string[]
  groupTypes: string[]
  can: { manage: boolean; commission: boolean }
  onlyMine: boolean
}

export default function AssignmentsIndex({
  dispatchers,
  groups,
  resources,
  types,
  groupTypes,
  can,
  onlyMine,
}: Props) {
  const { t } = useI18n()

  return (
    <AppLayout
      title={t('assignments.index.title')}
      description={t('assignments.index.subtitle')}
      crumbs={[{ label: t('assignments.index.title') }]}
    >
      <div className="flex flex-col gap-8">
        {/* Se dice qué pasa cuando esta pantalla está vacía, porque el síntoma
            —un despachador que ve listas en blanco— parece una avería. */}
        <p className="rounded border-l-4 border-safety-500 bg-navy-50 p-3 text-sm text-carbon">
          {t('assignments.index.explainer')}
        </p>

        <section>
          <h2 className="uppercase-heading text-xs text-steel-600">
            {onlyMine ? t('assignments.index.mine') : t('assignments.index.dispatchers')}
          </h2>

          {dispatchers.length === 0 ? (
            <p className="mt-3 rounded border border-steel-200 bg-white p-8 text-center text-sm text-steel-600">
              {t('assignments.index.noDispatchers')}
            </p>
          ) : null}

          <div className="mt-3 flex flex-col gap-4">
            {dispatchers.map((d) => (
              <DispatcherCard
                key={d.userId}
                dispatcher={d}
                resources={resources}
                types={types}
                can={can}
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="uppercase-heading text-xs text-steel-600">{t('assignments.groups.title')}</h2>
          <p className="mt-1 text-xs text-steel-600">{t('assignments.groups.hint')}</p>

          {can.manage ? <NewGroup /> : null}

          <div className="mt-3 flex flex-col gap-4">
            {groups.map((g) => (
              <GroupCard key={g.id} group={g} resources={resources} groupTypes={groupTypes} can={can} />
            ))}
          </div>
        </section>
      </div>
    </AppLayout>
  )
}

function DispatcherCard({
  dispatcher: d,
  resources,
  types,
  can,
}: {
  dispatcher: Dispatcher
  resources: Record<string, Choice[]> | null
  types: string[]
  can: Props['can']
}) {
  const { t } = useI18n()
  const [tipo, setTipo] = useState(types[0] ?? 'carrier')

  const comision = useForm({
    dispatcher_user_id: d.userId,
    // Puntos básicos por dentro, porcentaje en pantalla.
    commission_bps: d.commissionBps,
  })

  const asignar = (resourceId: string) => {
    router.post(
      '/assignments',
      { dispatcher_user_id: d.userId, resource_type: tipo, resource_id: resourceId },
      { preserveScroll: true },
    )
  }

  return (
    <div className="rounded border border-steel-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-carbon">{d.name || d.email}</p>
          <p className="text-xs text-steel-600">
            {d.email} · {t(`assignments.memberStatus.${d.status}`)}
          </p>
        </div>

        {can.commission ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              comision.post('/assignments/commission', { preserveScroll: true })
            }}
            className="flex items-end gap-2"
          >
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-steel-700">{t('assignments.commission.label')}</span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.25}
                value={comision.data.commission_bps / 100}
                onChange={(e) =>
                  comision.setData(
                    'commission_bps',
                    e.target.value === '' ? 0 : Math.round(Number(e.target.value) * 100),
                  )
                }
                className="w-24 rounded border border-steel-300 bg-white px-2 py-1 text-sm tabular-nums outline-none focus:border-navy-500"
              />
            </label>
            <button
              type="submit"
              disabled={comision.processing}
              className="rounded border border-steel-300 px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50 disabled:opacity-50"
            >
              {t('assignments.commission.save')}
            </button>
          </form>
        ) : null}
      </div>

      <div className="mt-3 border-t border-steel-100 pt-3">
        {d.assignments.length === 0 ? (
          <p className="text-sm text-steel-600">{t('assignments.index.nothingAssigned')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {d.assignments.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded-full border border-steel-300 bg-steel-50 py-1 pl-3 pr-1.5 text-xs"
              >
                <span className="text-steel-600">{t(`assignments.types.${a.type}`)}</span>
                <span className="font-medium text-carbon">{a.label}</span>
                {a.endDate ? (
                  <span className="text-steel-600">{t('assignments.index.until', { date: a.endDate })}</span>
                ) : null}
                {can.manage ? (
                  <button
                    type="button"
                    aria-label={t('assignments.index.end')}
                    title={t('assignments.index.end')}
                    onClick={() => router.post(`/assignments/${a.id}/end`, {}, { preserveScroll: true })}
                    className="rounded-full px-1.5 text-steel-600 transition hover:bg-danger-50 hover:text-danger-700"
                  >
                    ×
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {can.manage && resources ? (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-steel-700">{t('assignments.index.assignType')}</span>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className="rounded border border-steel-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-navy-500"
              >
                {types.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`assignments.types.${ty}`)}
                  </option>
                ))}
              </select>
            </label>

            <div className="min-w-64 flex-1">
              <SearchableSelect
                label={t('assignments.index.assignWhat')}
                choices={resources[tipo] ?? []}
                onPick={asignar}
                placeholder={t('assignments.index.search')}
                emptyText={t('assignments.index.noneLeft')}
                exclude={d.assignments.filter((a) => a.type === tipo).map((a) => a.resourceId)}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function NewGroup() {
  const { t } = useI18n()
  const form = useForm({ name: '', description: '' })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.post('/assignment-groups', { preserveScroll: true, onSuccess: () => form.reset() })
      }}
      className="mt-3 flex flex-wrap items-end gap-3 rounded border border-steel-200 bg-white p-4"
    >
      <label className="flex min-w-56 flex-1 flex-col gap-1">
        <span className="text-xs font-medium text-steel-700">{t('assignments.groups.name')}</span>
        <input
          type="text"
          maxLength={120}
          value={form.data.name}
          onChange={(e) => form.setData('name', e.target.value)}
          className="rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500"
        />
      </label>
      <label className="flex min-w-56 flex-[2] flex-col gap-1">
        <span className="text-xs font-medium text-steel-700">{t('assignments.groups.description')}</span>
        <input
          type="text"
          maxLength={2000}
          value={form.data.description}
          onChange={(e) => form.setData('description', e.target.value)}
          className="rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none focus:border-navy-500"
        />
      </label>
      <button
        type="submit"
        disabled={form.processing || form.data.name.trim() === ''}
        className="rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
      >
        {t('assignments.groups.create')}
      </button>
      {form.errors.name ? (
        <p role="alert" className="w-full text-sm text-danger-700">
          {form.errors.name}
        </p>
      ) : null}
    </form>
  )
}

function GroupCard({
  group: g,
  resources,
  groupTypes,
  can,
}: {
  group: Group
  resources: Record<string, Choice[]> | null
  groupTypes: string[]
  can: Props['can']
}) {
  const { t } = useI18n()
  const [tipo, setTipo] = useState(groupTypes[0] ?? 'carrier')

  return (
    <div className={`rounded border bg-white p-4 ${g.active ? 'border-steel-200' : 'border-steel-300 opacity-70'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-carbon">{g.name}</p>
          {g.description ? <p className="text-xs text-steel-600">{g.description}</p> : null}
          {! g.active ? (
            // Un grupo apagado deja de conceder a TODOS los despachadores que lo
            // tengan asignado, a la vez. Conviene que se vea.
            <p className="mt-1 text-xs font-medium text-danger-700">{t('assignments.groups.inactive')}</p>
          ) : null}
        </div>

        {can.manage ? (
          <button
            type="button"
            onClick={() => router.post(`/assignment-groups/${g.id}/toggle`, {}, { preserveScroll: true })}
            className="rounded border border-steel-300 px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50"
          >
            {g.active ? t('assignments.groups.deactivate') : t('assignments.groups.activate')}
          </button>
        ) : null}
      </div>

      <div className="mt-3 border-t border-steel-100 pt-3">
        {g.members.length === 0 ? (
          <p className="text-sm text-steel-600">{t('assignments.groups.empty')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {g.members.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-2 rounded-full border border-steel-300 bg-steel-50 py-1 pl-3 pr-1.5 text-xs"
              >
                <span className="text-steel-600">{t(`assignments.types.${m.type}`)}</span>
                <span className="font-medium text-carbon">{m.label}</span>
                {can.manage ? (
                  <button
                    type="button"
                    aria-label={t('assignments.groups.remove')}
                    title={t('assignments.groups.remove')}
                    onClick={() =>
                      router.delete(`/assignment-groups/${g.id}/members/${m.id}`, { preserveScroll: true })
                    }
                    className="rounded-full px-1.5 text-steel-600 transition hover:bg-danger-50 hover:text-danger-700"
                  >
                    ×
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {can.manage && resources ? (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-steel-700">{t('assignments.index.assignType')}</span>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className="rounded border border-steel-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-navy-500"
              >
                {groupTypes.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`assignments.types.${ty}`)}
                  </option>
                ))}
              </select>
            </label>

            <div className="min-w-64 flex-1">
              <SearchableSelect
                label={t('assignments.groups.addMember')}
                choices={resources[tipo] ?? []}
                onPick={(id) =>
                  router.post(
                    `/assignment-groups/${g.id}/members`,
                    { member_type: tipo, member_id: id },
                    { preserveScroll: true },
                  )
                }
                placeholder={t('assignments.index.search')}
                emptyText={t('assignments.index.noneLeft')}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
