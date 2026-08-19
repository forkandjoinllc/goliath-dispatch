import 'server-only'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { hmacHex, safeEqual, sha256Hex } from '@/lib/crypto'
import { AppError, notFound } from '@/lib/errors'
import { serverEnv } from '@/lib/env'
import type {
  GetObjectResult,
  PutObjectInput,
  PutObjectResult,
  SignedUploadUrlOptions,
  SignedUrlOptions,
  StorageDriver,
  StorageObjectHead,
} from './types'

/**
 * Filesystem-backed driver for development and test.
 *
 * There is no cloud IAM to lean on here, so "signed URL" is implemented for
 * real: an HMAC over the key, the action and an expiry, verified by the route
 * handler in `src/app/api/documents/local/[...key]/route.ts`. A tampered
 * signature or an expired one is indistinguishable from a wrong key to the
 * caller — both produce a 404 — so the endpoint cannot be used to probe for
 * valid keys.
 */

export const LOCAL_URL_PREFIX = '/api/documents/local/'
const SIGNATURE_DOMAIN = 'goliath-local-storage:v1'

interface LocalObjectMeta {
  contentType: string | null
  size: number
  etag: string
  lastModified: string
  metadata?: Record<string, string>
}

export type LocalUrlAction = 'download' | 'upload'

function signingSecret(): string {
  // The local driver only ever runs in development/test, where reusing the
  // session secret for a second, domain-separated purpose is an acceptable
  // trade against introducing a dedicated env var nobody would rotate.
  return serverEnv().AUTH_SECRET
}

export function signLocalUrl(key: string, action: LocalUrlAction, expiresAtSeconds: number): string {
  const payload = `${SIGNATURE_DOMAIN}:${action}:${key}:${expiresAtSeconds}`
  return hmacHex(payload, signingSecret())
}

export interface VerifyLocalUrlInput {
  key: string
  action: LocalUrlAction
  expiresAtSeconds: number
  signature: string
}

/** Returns false for a bad signature AND for an expired one — callers must not distinguish the two. */
export function verifyLocalUrl(input: VerifyLocalUrlInput): boolean {
  if (!Number.isFinite(input.expiresAtSeconds)) return false
  if (Math.floor(Date.now() / 1000) > input.expiresAtSeconds) return false
  const expected = signLocalUrl(input.key, input.action, input.expiresAtSeconds)
  return safeEqual(expected, input.signature)
}

export class LocalStorageDriver implements StorageDriver {
  private readonly root: string

  constructor(root: string = serverEnv().LOCAL_STORAGE_ROOT) {
    this.root = path.resolve(root)
  }

  /** Resolves a key to an absolute path, refusing anything that would escape the root. */
  private resolvePath(key: string): string {
    if (!key || key.includes('..') || key.startsWith('/')) {
      throw new AppError('forbidden', 'errors.crossTenant')
    }
    const full = path.resolve(this.root, key)
    if (full !== this.root && !full.startsWith(`${this.root}${path.sep}`)) {
      throw new AppError('forbidden', 'errors.crossTenant')
    }
    return full
  }

  private metaPath(key: string): string {
    return `${this.resolvePath(key)}.meta.json`
  }

  private async readMeta(key: string): Promise<LocalObjectMeta | null> {
    try {
      const raw = await fs.readFile(this.metaPath(key), 'utf8')
      return JSON.parse(raw) as LocalObjectMeta
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async put(input: PutObjectInput): Promise<PutObjectResult> {
    const filePath = this.resolvePath(input.key)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const buffer = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body)
    await fs.writeFile(filePath, buffer)
    const etag = sha256Hex(buffer)
    const meta: LocalObjectMeta = {
      contentType: input.contentType,
      size: buffer.byteLength,
      etag,
      lastModified: new Date().toISOString(),
      metadata: input.metadata,
    }
    await fs.writeFile(this.metaPath(input.key), JSON.stringify(meta))
    return { key: input.key, etag }
  }

  async get(key: string): Promise<GetObjectResult> {
    const filePath = this.resolvePath(key)
    let body: Buffer
    try {
      body = await fs.readFile(filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw notFound('errors.notFound', { entity: 'document' })
      }
      throw error
    }
    const meta = await this.readMeta(key)
    return { body, contentType: meta?.contentType ?? null }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key)
    await fs.rm(filePath, { force: true })
    await fs.rm(this.metaPath(key), { force: true })
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(key))
      return true
    } catch {
      return false
    }
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    const src = this.resolvePath(sourceKey)
    const dst = this.resolvePath(destinationKey)
    await fs.mkdir(path.dirname(dst), { recursive: true })
    await fs.copyFile(src, dst)
    const meta = await this.readMeta(sourceKey)
    if (meta) await fs.writeFile(this.metaPath(destinationKey), JSON.stringify(meta))
  }

  async head(key: string): Promise<StorageObjectHead | null> {
    const meta = await this.readMeta(key)
    if (!meta) return null
    return {
      key,
      contentType: meta.contentType,
      contentLength: meta.size,
      etag: meta.etag,
      lastModified: meta.lastModified ? new Date(meta.lastModified) : null,
    }
  }

  private buildSignedUrl(key: string, action: LocalUrlAction, options?: SignedUrlOptions): string {
    if (key.includes('..')) throw new AppError('forbidden', 'errors.crossTenant')
    const ttl = options?.expiresInSeconds ?? serverEnv().SIGNED_URL_TTL_SECONDS
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + ttl
    const signature = signLocalUrl(key, action, expiresAtSeconds)

    const encodedKey = key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')

    const query = new URLSearchParams({ exp: String(expiresAtSeconds), sig: signature })
    if (options?.responseContentDisposition) {
      query.set('disposition', options.responseContentDisposition)
    }
    if (options?.responseContentType) {
      query.set('type', options.responseContentType)
    }
    return `${LOCAL_URL_PREFIX}${encodedKey}?${query.toString()}`
  }

  async signedDownloadUrl(key: string, options?: SignedUrlOptions): Promise<string> {
    return this.buildSignedUrl(key, 'download', options)
  }

  /**
   * Local dev has no browser-direct-upload endpoint wired up (uploads always
   * go through `uploadDocument`, which calls `put()` on the server) — this
   * exists so the driver satisfies the shared interface and so the signing
   * primitive is exercised identically to the download path. If a local PUT
   * endpoint is added later, `verifyLocalUrl` already covers it.
   */
  async signedUploadUrl(key: string, options?: SignedUploadUrlOptions): Promise<string> {
    return this.buildSignedUrl(key, 'upload', options)
  }
}
