import type { ReactNode } from 'react'

export function PageHero({
  title,
  subtitle,
  eyebrow,
  children,
}: {
  title: string
  subtitle?: string
  eyebrow?: string
  children?: ReactNode
}) {
  return (
    <section className="relative overflow-hidden bg-navy-700">
      <div className="hazard-stripe absolute inset-x-0 top-0 h-1.5" aria-hidden="true" />
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="max-w-3xl">
          {eyebrow ? <p className="uppercase-heading text-xs text-safety-500">{eyebrow}</p> : null}
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
            {title}
          </h1>
          {subtitle ? <p className="mt-5 text-lg text-steel-100">{subtitle}</p> : null}
          {children}
        </div>
      </div>
    </section>
  )
}
