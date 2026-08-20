import { Link, useForm } from '@inertiajs/react'
import { AuthLayout } from '@/layouts/AuthLayout'
import { CheckboxField, TextField } from '@/components/Form/Field'
import { useI18n } from '@/lib/i18n'

interface LoginData {
  email: string
  password: string
  remember: boolean
  [key: string]: string | boolean
}

export default function Login({ status }: { status?: string }) {
  const { t, locale } = useI18n()

  const form = useForm<LoginData>({ email: '', password: '', remember: false })

  return (
    <AuthLayout
      title={t('auth.login.title')}
      subtitle={t('auth.login.subtitle')}
      footer={
        <>
          {t('auth.login.noAccount')}{' '}
          <Link href="/signup" className="font-medium text-navy-700 underline">
            {t('auth.login.signupLink')}
          </Link>
        </>
      }
    >
      {status ? (
        <div role="status" className="mb-6 rounded border-l-4 border-safety-500 bg-navy-50 p-3 text-sm text-carbon">
          {status}
        </div>
      ) : null}

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          // onFinish y no onSuccess: un login correcto REDIRIGE, así que
          // onSuccess no llega a correr y la contraseña se quedaría en memoria.
          form.post('/login', { onFinish: () => form.reset('password') })
        }}
        className="flex flex-col gap-5"
      >
        <TextField
          label={t('auth.login.email')}
          type="email"
          required
          autoComplete="username"
          autoFocus
          value={form.data.email}
          onChange={(e) => form.setData('email', e.target.value)}
          error={form.errors.email}
        />

        <TextField
          label={t('auth.login.password')}
          type="password"
          required
          autoComplete="current-password"
          value={form.data.password}
          onChange={(e) => form.setData('password', e.target.value)}
          error={form.errors.password}
        />

        <div className="flex items-center justify-between">
          <CheckboxField
            label={t('auth.login.remember')}
            checked={form.data.remember}
            onChange={(e) => form.setData('remember', e.target.checked)}
          />

          <Link href="/forgot-password" className="text-sm font-medium text-navy-700 underline">
            {t('auth.login.forgot')}
          </Link>
        </div>

        <button
          type="submit"
          disabled={form.processing}
          className="rounded bg-safety-600 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {form.processing ? t('common.states.loading') : t('auth.login.submit')}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-steel-600">
        <Link href={`/${locale}/privacy`} className="underline">
          {t('nav.public.privacy')}
        </Link>
        {' · '}
        <Link href={`/${locale}/terms`} className="underline">
          {t('nav.public.terms')}
        </Link>
      </p>
    </AuthLayout>
  )
}
