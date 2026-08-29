import { Link, useForm } from '@inertiajs/react'
import { TextField } from '@/components/Form/Field'
import { AuthLayout } from '@/layouts/AuthLayout'
import { useI18n } from '@/lib/i18n'

interface Invitation {
  email: string
  company: string
  role: string
  firstName: string
  lastName: string
  /** Falso para quien ya tenía cuenta en otra empresa: conserva su contraseña. */
  needsPassword: boolean
}

interface AcceptData {
  first_name: string
  last_name: string
  password: string
  password_confirmation: string
  [key: string]: string
}

export default function AcceptInvitation({ invitation }: { invitation: Invitation | null }) {
  const { t } = useI18n()

  // Un vale caducado, uno ya usado y uno inventado llegan aquí exactamente
  // igual: `invitation` en null. La página no distingue porque el servidor
  // tampoco lo cuenta.
  if (invitation === null) {
    return (
      <AuthLayout title={t('users.accept.invalidTitle')} subtitle={t('users.accept.invalid')}>
        <Link
          href="/login"
          className="inline-block rounded bg-safety-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-safety-700"
        >
          {t('users.accept.goToLogin')}
        </Link>
      </AuthLayout>
    )
  }

  return <AcceptForm invitation={invitation} />
}

function AcceptForm({ invitation }: { invitation: Invitation }) {
  const { t } = useI18n()

  const form = useForm<AcceptData>({
    first_name: invitation.firstName,
    last_name: invitation.lastName,
    password: '',
    password_confirmation: '',
  })

  return (
    <AuthLayout
      title={t('users.accept.title', { company: invitation.company })}
      subtitle={t('users.accept.subtitle', {
        role: t(`users.roles.${invitation.role}`),
        company: invitation.company,
      })}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          form.post(window.location.pathname, {
            onFinish: () => form.reset('password', 'password_confirmation'),
          })
        }}
        className="flex flex-col gap-5"
      >
        {/* El correo se enseña y no se edita: es el que recibió el vale, y
            cambiarlo aquí convertiría una invitación a una persona en una
            invitación a otra. */}
        <div className="rounded border border-steel-200 bg-steel-50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-steel-600">{t('users.accept.email')}</p>
          <p className="text-sm font-medium text-carbon">{invitation.email}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('users.fields.firstName')}
            required
            maxLength={100}
            value={form.data.first_name}
            onChange={(e) => form.setData('first_name', e.target.value)}
            error={form.errors.first_name}
          />
          <TextField
            label={t('users.fields.lastName')}
            required
            maxLength={100}
            value={form.data.last_name}
            onChange={(e) => form.setData('last_name', e.target.value)}
            error={form.errors.last_name}
          />
        </div>

        {invitation.needsPassword ? (
          <>
            <TextField
              label={t('users.accept.password')}
              type="password"
              required
              autoComplete="new-password"
              value={form.data.password}
              onChange={(e) => form.setData('password', e.target.value)}
              error={form.errors.password}
            />
            <TextField
              label={t('users.accept.passwordConfirm')}
              type="password"
              required
              autoComplete="new-password"
              value={form.data.password_confirmation}
              onChange={(e) => form.setData('password_confirmation', e.target.value)}
            />
          </>
        ) : (
          // Ya tiene cuenta: entra con la contraseña que ya usa en otra empresa.
          <p className="rounded border-l-4 border-safety-500 bg-navy-50 p-3 text-sm text-carbon">
            {t('users.accept.existingAccount')}
          </p>
        )}

        <button
          type="submit"
          disabled={form.processing}
          className="rounded bg-safety-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {form.processing ? t('common.states.saving') : t('users.accept.submit')}
        </button>
      </form>
    </AuthLayout>
  )
}
