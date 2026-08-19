/**
 * Injects a JSON-LD structured-data script. Server component — the data is
 * always resolved server-side (translated strings, canonical URLs), so there
 * is nothing to hydrate.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
  )
}
