import { useForm } from '@inertiajs/react'
import { AuthLayout } from '@/layouts/AuthLayout'
import { TextField } from '@/components/Form/Field'
import { useI18n } from '@/lib/i18n'

interface ResetData {
  token: string
  email: string
  password: string
  password_confirmation: string
  [key: string]: string
}

export default function ResetPassword({ token, email }: { token: string; email: string }) {
  const { t } = useI18n()

  const form = useForm<ResetData>({ token, email, password: '', password_confirmation: '' })

  return (
    <AuthLayout title={t('auth.reset.title')}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          form.post('/reset-password', {
            onFinish: () => form.reset('password', 'password_confirmation'),
          })
        }}
        className="flex flex-col gap-5"
      >
        <TextField
          label={t('auth.login.email')}
          type="email"
          required
          autoComplete="username"
          value={form.data.email}
          onChange={(e) => form.setData('email', e.target.value)}
          error={form.errors.email}
        />

        <TextField
          label={t('auth.reset.password')}
          type="password"
          required
          autoComplete="new-password"
          autoFocus
          value={form.data.password}
          onChange={(e) => form.setData('password', e.target.value)}
          error={form.errors.password}
        />

        <TextField
          label={t('auth.reset.confirm')}
          type="password"
          required
          autoComplete="new-password"
          value={form.data.password_confirmation}
          onChange={(e) => form.setData('password_confirmation', e.target.value)}
          error={form.errors.password_confirmation}
        />

        <button
          type="submit"
          disabled={form.processing}
          className="rounded bg-safety-600 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {form.processing ? t('common.states.loading') : t('auth.reset.submit')}
        </button>
      </form>
    </AuthLayout>
  )
}
