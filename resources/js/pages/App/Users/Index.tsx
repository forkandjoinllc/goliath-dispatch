import { router, useForm, usePage } from '@inertiajs/react'
import { useState } from 'react'
import { AppLayout } from '@/layouts/AppLayout'
import { useI18n } from '@/lib/i18n'

interface Member {
  id: string
  userId: string
  role: string
  status: string
  carrierId: string | null
  invitedAt: string | null
  acceptedAt: string | null
  isSelf: boolean
  name?: string
  email?: string
  locale?: string
  lastLoginAt?: string | null
}

interface Carrier {
  id: string
  name: string
  hint: string | null
}

interface Props {
  members: Member[]
  roles: string[]
  carriers: Carrier[]
  requiresCarrier: string[]
  can: { invite: boolean; update: boolean; suspend: boolean }
}

interface InviteData {
  email: string
  first_name: string
  last_name: string
  role: string
  carrier_id: string
  locale: string
  [key: string]: string
}

export default function UsersIndex({ members, roles, carriers, requiresCarrier, can }: Props) {
  const { t } = useI18n()
  const [invitando, setInvitando] = useState(false)

  // Los rechazos de cambiar papel o suspender llegan por `errors` compartido,
  // no por el formulario de una tarjeta: esas acciones van por router.post y no
  // tienen formulario propio. Se enseñan arriba, una vez, porque el servidor
  // rechaza UNA acción y no sabemos —ni hace falta— de qué fila salió.
  const errores = usePage().props.errors as Record<string, string> | undefined
  const rechazo = errores?.role ?? errores?.status ?? null

  const pendientes = members.filter((m) => m.status === 'invited')
  const dentro = members.filter((m) => m.status !== 'invited')

  return (
    <AppLayout
      title={t('users.index.title')}
      description={t('users.index.subtitle')}
      crumbs={[{ label: t('users.index.title') }]}
    >
      <div className="flex flex-col gap-6">
        {rechazo ? (
          <p role="alert" className="rounded border-l-4 border-danger-500 bg-danger-50 p-3 text-sm text-carbon">
            {rechazo}
          </p>
        ) : null}

        {can.invite ? (
          <div>
            <button
              type="button"
              onClick={() => setInvitando(!invitando)}
              className="rounded bg-safety-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-safety-700"
            >
              {invitando ? t('users.index.cancelInvite') : t('users.index.invite')}
            </button>
            {invitando ? (
              <InviteForm
                roles={roles}
                carriers={carriers}
                requiresCarrier={requiresCarrier}
                onDone={() => setInvitando(false)}
              />
            ) : null}
          </div>
        ) : null}

        {pendientes.length > 0 ? (
          <section>
            <h2 className="uppercase-heading text-xs text-steel-600">{t('users.index.pending')}</h2>
            {/* Se listan aparte porque son otra cosa: alguien con acceso
                concedido que todavía no ha abierto su correo. */}
            <p className="mt-1 text-xs text-steel-600">{t('users.index.pendingHint')}</p>
            <div className="mt-3 flex flex-col gap-3">
              {pendientes.map((m) => (
                <MemberCard key={m.id} member={m} can={can} />
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <h2 className="uppercase-heading text-xs text-steel-600">{t('users.index.members')}</h2>
          <div className="mt-3 flex flex-col gap-3">
            {dentro.length === 0 ? (
              <p className="rounded border border-steel-200 bg-white p-8 text-center text-sm text-steel-600">
                {t('users.index.empty')}
              </p>
            ) : null}
            {dentro.map((m) => (
              <MemberCard key={m.id} member={m} can={can} roles={roles} />
            ))}
          </div>
        </section>
      </div>
    </AppLayout>
  )
}

function InviteForm({
  roles,
  carriers,
  requiresCarrier,
  onDone,
}: {
  roles: string[]
  carriers: Carrier[]
  requiresCarrier: string[]
  onDone: () => void
}) {
  const { t, locale } = useI18n()

  const form = useForm<InviteData>({
    email: '',
    first_name: '',
    last_name: '',
    role: roles[0] ?? '',
    carrier_id: '',
    // Por defecto el idioma de quien invita, porque es la mejor pista que hay.
    // Se puede cambiar: el correo sale en el idioma de quien lo recibe.
    locale,
  })

  const necesitaCarrier = requiresCarrier.includes(form.data.role)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.post('/users', { preserveScroll: true, onSuccess: () => { form.reset(); onDone() } })
      }}
      className="mt-3 flex flex-col gap-4 rounded border border-steel-200 bg-white p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label={t('users.fields.firstName')} error={form.errors.first_name}>
          <input
            type="text"
            maxLength={100}
            value={form.data.first_name}
            onChange={(e) => form.setData('first_name', e.target.value)}
            className={ENTRADA}
          />
        </Campo>
        <Campo label={t('users.fields.lastName')} error={form.errors.last_name}>
          <input
            type="text"
            maxLength={100}
            value={form.data.last_name}
            onChange={(e) => form.setData('last_name', e.target.value)}
            className={ENTRADA}
          />
        </Campo>
        <Campo label={t('users.fields.email')} error={form.errors.email} hint={t('users.fields.emailHint')}>
          <input
            type="email"
            maxLength={255}
            value={form.data.email}
            onChange={(e) => form.setData('email', e.target.value)}
            className={ENTRADA}
          />
        </Campo>
        <Campo label={t('users.fields.locale')} error={form.errors.locale}>
          <select
            value={form.data.locale}
            onChange={(e) => form.setData('locale', e.target.value)}
            className={ENTRADA}
          >
            <option value="en">{t('users.locales.en')}</option>
            <option value="es">{t('users.locales.es')}</option>
          </select>
        </Campo>
        <Campo label={t('users.fields.role')} error={form.errors.role} hint={t(`users.roleHelp.${form.data.role}`)}>
          <select
            value={form.data.role}
            onChange={(e) => form.setData('role', e.target.value)}
            className={ENTRADA}
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {t(`users.roles.${r}`)}
              </option>
            ))}
          </select>
        </Campo>
        {necesitaCarrier && carriers.length > 0 ? (
          <Campo
            label={t('users.fields.carrier')}
            error={form.errors.carrier_id}
            hint={t('users.fields.carrierHint')}
          >
            <select
              value={form.data.carrier_id}
              onChange={(e) => form.setData('carrier_id', e.target.value)}
              className={ENTRADA}
            >
              <option value="">{t('users.fields.chooseCarrier')}</option>
              {carriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Campo>
        ) : null}
      </div>

      <p className="text-xs text-steel-600">{t('users.index.inviteNote')}</p>

      <div>
        <button
          type="submit"
          disabled={form.processing}
          className="rounded bg-navy-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
        >
          {form.processing ? t('common.states.saving') : t('users.index.sendInvite')}
        </button>
      </div>
    </form>
  )
}

function MemberCard({ member: m, can, roles }: { member: Member; can: Props['can']; roles?: string[] }) {
  const { t } = useI18n()
  const accion = useForm({})

  const pendiente = m.status === 'invited'

  return (
    <div className="rounded border border-steel-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-carbon">
            {m.name || m.email}
            {m.isSelf ? <span className="ml-2 text-xs font-normal text-steel-600">{t('users.index.you')}</span> : null}
          </p>
          <p className="mt-0.5 text-xs text-steel-600">{m.email}</p>
          <p className="mt-1 text-xs text-steel-600">
            {t(`users.roles.${m.role}`)} · {t(`users.status.${m.status}`)}
            {m.lastLoginAt ? ` · ${t('users.index.lastLogin', { date: m.lastLoginAt })}` : ''}
            {pendiente && m.invitedAt ? ` · ${t('users.index.invitedOn', { date: m.invitedAt })}` : ''}
          </p>
        </div>
      </div>

      {/* A uno mismo no se le ofrece ninguna acción: el único administrador que
          se rebaja o se suspende no puede deshacerlo desde ninguna pantalla. */}
      {m.isSelf ? null : (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-steel-100 pt-3">
          {pendiente && can.invite ? (
            <button
              type="button"
              disabled={accion.processing}
              onClick={() => accion.post(`/users/${m.id}/resend`, { preserveScroll: true })}
              className="rounded border border-steel-300 px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50 disabled:opacity-50"
            >
              {t('users.index.resend')}
            </button>
          ) : null}

          {pendiente && can.update ? (
            <button
              type="button"
              disabled={accion.processing}
              onClick={() => accion.delete(`/users/${m.id}`, { preserveScroll: true })}
              className="rounded border border-danger-300 px-3 py-1.5 text-xs font-medium text-danger-700 transition hover:bg-danger-50 disabled:opacity-50"
            >
              {t('users.index.revoke')}
            </button>
          ) : null}

          {! pendiente && can.update && roles ? (
            <label className="flex items-center gap-2 text-xs text-steel-700">
              {t('users.fields.role')}
              {/* router.post y no useForm: `form.transform()` no devuelve el
                  formulario, así que encadenarlo revienta — el mismo fallo que
                  tenía el formulario de factoring. Aquí el valor va directo. */}
              <select
                value={m.role}
                onChange={(e) =>
                  router.post(`/users/${m.id}/role`, { role: e.target.value }, { preserveScroll: true })
                }
                className="rounded border border-steel-300 bg-white px-2 py-1 text-xs outline-none focus:border-navy-500"
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {t(`users.roles.${r}`)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {! pendiente && can.suspend ? (
            <button
              type="button"
              disabled={accion.processing}
              onClick={() => accion.post(`/users/${m.id}/suspend`, { preserveScroll: true })}
              className="rounded border border-steel-300 px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50 disabled:opacity-50"
            >
              {m.status === 'suspended' ? t('users.index.reactivate') : t('users.index.suspend')}
            </button>
          ) : null}
        </div>
      )}

    </div>
  )
}

const ENTRADA =
  'w-full rounded border border-steel-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-navy-500 focus:ring-2 focus:ring-navy-200'

function Campo({
  label,
  error,
  hint,
  children,
}: {
  label: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-carbon">{label}</span>
      {children}
      {hint && ! error ? <span className="text-xs text-steel-600">{hint}</span> : null}
      {error ? (
        <span role="alert" className="text-sm text-danger-700">
          {error}
        </span>
      ) : null}
    </label>
  )
}
