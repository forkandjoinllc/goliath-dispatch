import type { ReactNode } from 'react'

type Tone = 'white' | 'tint' | 'navy'

const TONES: Record<Tone, string> = {
  white: 'bg-white text-carbon',
  tint: 'bg-navy-50 text-carbon',
  navy: 'bg-navy-700 text-white',
}

export function Section({
  children,
  tone = 'white',
  id,
  className = '',
}: {
  children: ReactNode
  tone?: Tone
  id?: string
  className?: string
}) {
  return (
    <section id={id} className={`${TONES[tone]} ${className}`}>
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">{children}</div>
    </section>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  tone = 'white',
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  tone?: Tone
}) {
  const onNavy = tone === 'navy'

  return (
    <div className="max-w-3xl">
      {eyebrow ? (
        // safety-600 sobre blanco, no safety-500: el naranja de marca mide 3,1:1
        // y eso vale para bordes e iconos, no para texto. Sobre azul marino el
        // 500 sí llega. Ver docs/brand.md.
        <p className={`uppercase-heading text-xs ${onNavy ? 'text-safety-500' : 'text-safety-600'}`}>
          {eyebrow}
        </p>
      ) : null}

      <h2
        className={`mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl ${
          onNavy ? 'text-white' : 'text-navy-700'
        }`}
      >
        {title}
      </h2>

      {subtitle ? (
        <p className={`mt-4 text-lg ${onNavy ? 'text-steel-100' : 'text-steel-700'}`}>{subtitle}</p>
      ) : null}
    </div>
  )
}
