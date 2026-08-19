import Link from 'next/link'
import { Breadcrumb, type BreadcrumbItem } from '@/components/ui/breadcrumb'
import { absoluteUrl, localePath } from '../_lib/site'
import { JsonLd } from './json-ld'

/**
 * Renders the visible breadcrumb trail and its `BreadcrumbList` structured
 * data together, so the two can never drift apart on an inner page.
 */
export function MarketingBreadcrumbs({
  homeLabel,
  locale,
  items,
}: {
  homeLabel: string
  locale: string
  items: BreadcrumbItem[]
}) {
  const trail: BreadcrumbItem[] = [{ label: homeLabel, href: localePath(locale as never, 'home') }, ...items]

  return (
    <div className="border-b border-steel-200 bg-steel-50">
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
        <Breadcrumb items={items} homeLabel={homeLabel} homeHref={localePath(locale as never, 'home')} LinkComponent={Link} />
      </div>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: trail.map((item, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: item.label,
            item: item.href ? absoluteUrl(item.href) : undefined,
          })),
        }}
      />
    </div>
  )
}
