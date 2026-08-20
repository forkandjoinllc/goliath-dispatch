import { Head, Link } from '@inertiajs/react'
import { useI18n } from '@/lib/i18n'

export default function SignupDone({ email }: { email: string | null }) {
  const { t } = useI18n()

  return (
    <>
      <Head title={t('auth.signup.successPage.title')} />

      <div className="flex min-h-dvh items-center justify-center bg-navy-50 px-4">
        <div className="w-full max-w-lg rounded border-l-4 border-safety-500 bg-white p-8">
          <img
            src="/brand/logo-primary.png"
            alt="Goliath Dispatch"
            width={168}
            height={40}
            className="h-9 w-auto"
          />
          <h1 className="mt-8 font-display text-2xl font-bold text-navy-700">
            {t('auth.signup.successPage.title')}
          </h1>
          {/* El correo se muestra tal cual lo escribió el usuario: si se
              equivocó de dominio, verlo aquí es lo único que se lo revela. */}
          <p className="mt-3 text-steel-700">
            {t('auth.signup.successPage.body', { email: email ?? '' })}
          </p>
          <Link
            href="/login"
            className="mt-8 inline-flex rounded bg-safety-600 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-safety-700"
          >
            {t('auth.signup.successPage.cta')}
          </Link>
        </div>
      </div>
    </>
  )
}
