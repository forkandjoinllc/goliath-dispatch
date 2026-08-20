import { Link } from '@inertiajs/react'
import type { ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-safety-600 text-white hover:bg-safety-700',
  secondary: 'bg-navy-700 text-white hover:bg-navy-800',
  ghost: 'border border-steel-300 bg-white text-navy-700 hover:bg-navy-50',
}

export function Cta({
  href,
  children,
  variant = 'primary',
  className = '',
}: {
  href: string
  children: ReactNode
  variant?: Variant
  className?: string
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center rounded px-6 py-3 text-sm font-bold uppercase tracking-wide transition ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </Link>
  )
}

export function CtaBand({
  title,
  body,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
}: {
  title: string
  body: string
  primaryHref: string
  primaryLabel: string
  secondaryHref?: string
  secondaryLabel?: string
}) {
  return (
    <section className="bg-navy-800">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:flex lg:items-center lg:justify-between lg:px-8">
        <div className="max-w-2xl">
          <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h2>
          <p className="mt-3 text-steel-100">{body}</p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3 lg:mt-0 lg:shrink-0">
          <Cta href={primaryHref}>{primaryLabel}</Cta>
          {secondaryHref && secondaryLabel ? (
            <Link
              href={secondaryHref}
              className="inline-flex items-center justify-center rounded border border-steel-400 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-navy-700"
            >
              {secondaryLabel}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  )
}
