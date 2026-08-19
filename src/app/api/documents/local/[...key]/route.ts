import { NextResponse, type NextRequest } from 'next/server'
import { serverEnv } from '@/lib/env'
import { LocalStorageDriver, verifyLocalUrl } from '@/lib/storage/local-driver'

/**
 * Serves objects for the local filesystem storage driver.
 *
 * Only reachable in development/test (`STORAGE_DRIVER=local`); production
 * always runs the S3 driver, whose signed URLs point straight at the bucket.
 * A bad or expired signature returns 404, matching a missing key exactly —
 * there is no response difference an attacker could use to enumerate valid
 * keys.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  if (serverEnv().STORAGE_DRIVER !== 'local') {
    return new NextResponse(null, { status: 404 })
  }

  const { key: segments } = await params
  const key = segments.join('/')

  const expiresAtSeconds = Number(request.nextUrl.searchParams.get('exp'))
  const signature = request.nextUrl.searchParams.get('sig') ?? ''

  if (!verifyLocalUrl({ key, action: 'download', expiresAtSeconds, signature })) {
    return new NextResponse(null, { status: 404 })
  }

  try {
    const driver = new LocalStorageDriver()
    const { body, contentType } = await driver.get(key)

    const disposition = request.nextUrl.searchParams.get('disposition')
    const headers: Record<string, string> = {
      'Content-Type': contentType ?? 'application/octet-stream',
      'Content-Length': String(body.byteLength),
      // Every one of these bytes is a private, tenant-owned document — never
      // let a shared cache or the browser's disk cache retain a copy.
      'Cache-Control': 'private, max-age=0, no-store',
    }
    if (disposition) headers['Content-Disposition'] = disposition

    return new NextResponse(body, { status: 200, headers })
  } catch {
    // Includes AppError('forbidden') from a path-traversal attempt and
    // AppError('not_found') for a missing object — both collapse to 404.
    return new NextResponse(null, { status: 404 })
  }
}
