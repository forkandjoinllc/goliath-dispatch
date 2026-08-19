import Link from 'next/link'
import { Button } from '@/components/ui/button'

export function CtaBand({
  title,
  body,
  primaryCta,
  primaryHref,
  secondaryCta,
  secondaryHref,
}: {
  title: string
  body: string
  primaryCta: string
  primaryHref: string
  secondaryCta?: string
  secondaryHref?: string
}) {
  return (
    <section className="bg-navy-700 py-16 text-white sm:py-20">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-4 text-center sm:px-6 lg:px-8">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
        <p className="max-w-2xl text-lg text-navy-100">{body}</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild variant="accent" size="lg">
            <Link href={primaryHref}>{primaryCta}</Link>
          </Button>
          {secondaryCta && secondaryHref ? (
            <Button asChild variant="secondary" size="lg" className="bg-transparent text-white border-white/40 hover:bg-white/10">
              <Link href={secondaryHref}>{secondaryCta}</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
