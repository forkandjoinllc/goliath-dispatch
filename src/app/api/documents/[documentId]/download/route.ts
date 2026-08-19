import { NextResponse, type NextRequest } from 'next/server'
import { tenantDb } from '@/db/tenant-db'
import { tenantBranding } from '@/db/schema'
import { getDictionary } from '@/i18n/dictionary'
import { createTranslator } from '@/i18n/translate'
import { recordAudit } from '@/lib/audit'
import { AppError, forbidden, isAppError } from '@/lib/errors'
import { authorize } from '@/lib/permissions'
import { getStorage } from '@/lib/storage'
import { getRequestMeta, getTenant, getTenantPolicy, requireActor } from '@/server/context'
import { getDownloadUrl } from '@/server/documents/service'
import { resolveDocumentResourceContext } from '@/server/documents/queries'

/**
 * `GET /api/documents/{documentId}/download`
 *
 * A plain route handler (rather than a server action) so a link can be
 * shared, opened in a new tab, or hit from an `<a href>` — none of which can
 * carry a server-action payload. It re-derives the resource facts from the
 * document itself before authorizing, exactly like the action layer does, and
 * never returns the storage key: the only thing the client ever sees is a
 * 302 to a short-lived signed URL.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await params
  const request = await getRequestMeta()

  try {
    const actor = await requireActor()
    if (!actor.tenantId) throw forbidden()

    const db = tenantDb(actor.tenantId)
    const resource = await resolveDocumentResourceContext(db, documentId)
    const policy = await getTenantPolicy(actor.tenantId)
    authorize(actor, 'document:download', resource, policy)

    const tenant = await getTenant(actor.tenantId)
    const branding = await db.findFirst(tenantBranding)

    let logoPngBytes: Uint8Array | undefined
    if (branding?.logoStorageKey) {
      try {
        const stored = await getStorage().get(branding.logoStorageKey)
        if (stored.contentType === 'image/png') logoPngBytes = stored.body
      } catch {
        // Branding is decorative; never block a download over a missing logo.
      }
    }

    const dictionary = await getDictionary(actor.locale)
    const t = createTranslator(dictionary, actor.locale)

    const result = await getDownloadUrl(
      db,
      actor,
      request,
      { documentId, watermark: _request.nextUrl.searchParams.get('watermark') === 'true' },
      {
        tenantName: tenant?.displayName ?? 'Goliath Dispatch',
        timezone: tenant?.defaultTimezone ?? 'America/New_York',
        logoPngBytes,
      },
      t,
      actor.locale,
    )

    await recordAudit(actor, request, {
      action: 'document.downloaded',
      entityType: 'document',
      entityId: documentId,
      metadata: { watermarked: result.watermarked },
    })

    return NextResponse.redirect(result.url, { status: 302 })
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json({ error: error.toClient() }, { status: error.httpStatus })
    }
    const internal = new AppError('internal', 'errors.internal')
    return NextResponse.json({ error: internal.toClient() }, { status: internal.httpStatus })
  }
}
