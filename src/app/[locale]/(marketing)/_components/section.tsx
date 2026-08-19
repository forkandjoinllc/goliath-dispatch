import { cn } from '@/lib/utils'

export function Section({
  className,
  tone = 'default',
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & { tone?: 'default' | 'subtle' | 'navy' }) {
  return (
    <section
      className={cn(
        'py-16 sm:py-20',
        tone === 'subtle' && 'bg-steel-50',
        tone === 'navy' && 'bg-navy-800 text-white',
        className,
      )}
      {...props}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">{children}</div>
    </section>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  as: Comp = 'h2',
  className,
  align = 'left',
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  as?: 'h1' | 'h2'
  className?: string
  align?: 'left' | 'center'
}) {
  return (
    <div className={cn('max-w-3xl', align === 'center' && 'mx-auto text-center', className)}>
      {eyebrow ? (
        <p className="text-sm font-bold uppercase tracking-wide text-safety-600">{eyebrow}</p>
      ) : null}
      <Comp className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{title}</Comp>
      {subtitle ? <p className="mt-4 text-lg text-steel-600">{subtitle}</p> : null}
    </div>
  )
}
