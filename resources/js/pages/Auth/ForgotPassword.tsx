import { Link, useForm } from '@inertiajs/react'
import { AuthLayout } from '@/layouts/AuthLayout'
import { TextField } from '@/components/Form/Field'
import { useI18n } from '@/lib/i18n'

export default function ForgotPassword({ status }: { status?: string }) {
  const { t } = useI18n()
  const form = useForm<{ email: string; [key: string]: string }>({ email: '' })

  return (
    <AuthLayout
      title={t('auth.forgot.title')}
      subtitle={t('auth.forgot.subtitle')}
      footer={
        <Link href="/login" className="font-medium text-navy-700 underline">
          {t('auth.login.title')}
        </Link>
      }
    >
      {/* El mensaje es el mismo exista o no la cuenta: si dijera «no hay
          ninguna cuenta con ese correo», el formulario se convertiría en una
          herramienta para averiguar quién tiene cuenta. */}
      {status || form.wasSuccessful ? (
        <div role="status" className="rounded border-l-4 border-safety-500 bg-navy-50 p-4 text-sm text-carbon">
          {status ?? t('auth.forgot.sent')}
        </div>
      ) : (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            form.post('/forgot-password')
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

          <button
            type="submit"
            disabled={form.processing}
            className="rounded bg-safety-600 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {form.processing ? t('common.states.loading') : t('auth.forgot.submit')}
          </button>
        </form>
      )}
    </AuthLayout>
  )
}
