export function PageHero({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="border-b border-steel-200 bg-navy-800 py-14 text-white sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">{title}</h1>
        {subtitle ? <p className="mt-4 max-w-2xl text-lg text-navy-100">{subtitle}</p> : null}
      </div>
    </div>
  )
}
