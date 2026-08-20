import { Link, useForm } from '@inertiajs/react'
import { AuthLayout } from '@/layouts/AuthLayout'
import { useI18n } from '@/lib/i18n'

export default function VerifyEmail({ status, email }: { status?: string; email?: string }) {
  const { t } = useI18n()
  const form = useForm({})

  return (
    <AuthLayout
      title={t('auth.verify.title')}
      subtitle={t('auth.verify.sent', { email: email ?? '' })}
      footer={
        <Link
          href="/logout"
          method="post"
          as="button"
          className="font-medium text-navy-700 underline"
        >
          {t('common.actions.signOut')}
        </Link>
      }
    >
      {status === 'verification-link-sent' ? (
        <div role="status" className="mb-6 rounded border-l-4 border-safety-500 bg-navy-50 p-3 text-sm text-carbon">
          {t('auth.verify.sent', { email: email ?? '' })}
        </div>
      ) : null}

      <button
        type="button"
        disabled={form.processing}
        onClick={() => form.post('/email/verification-notification')}
        className="rounded bg-safety-600 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-safety-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {form.processing ? t('common.states.loading') : t('auth.verify.resend')}
      </button>
    </AuthLayout>
  )
}
