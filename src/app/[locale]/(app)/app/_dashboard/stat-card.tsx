import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/** A single labelled number, the smallest building block of every role dashboard. */
export function StatCard({
  label,
  value,
  tone,
  href,
}: {
  label: string
  value: number | string
  tone?: 'neutral' | 'warning' | 'danger' | 'success'
  href?: string
}) {
  const content = (
    <CardContent className="space-y-1 py-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-steel-500">{label}</p>
      <p
        className={cn(
          'text-3xl font-bold tabular-nums',
          tone === 'danger' && 'text-danger-700',
          tone === 'warning' && 'text-warning-700',
          tone === 'success' && 'text-success-700',
        )}
      >
        {value}
      </p>
    </CardContent>
  )

  if (href) {
    return (
      <Card className="transition-shadow hover:shadow-[var(--shadow-card)]">
        <a href={href} className="block">
          {content}
        </a>
      </Card>
    )
  }

  return <Card>{content}</Card>
}

export function StatusBadgeForSubscription({ status }: { status: string }) {
  const tone =
    status === 'active' || status === 'trialing'
      ? 'success'
      : status === 'past_due'
        ? 'warning'
        : status === 'suspended' || status === 'cancelled'
          ? 'danger'
          : 'neutral'
  return <Badge tone={tone}>{status}</Badge>
}
