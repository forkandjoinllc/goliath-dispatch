/**
 * Storage driver contract.
 *
 * Every object is addressed by a tenant-scoped key (see `keys.ts`). Drivers
 * never see application concepts (documents, versions) — they move bytes
 * around and mint signed URLs. Callers are responsible for calling
 * `assertKeyBelongsToTenant` before ever handing a key to a driver method.
 */

export interface PutObjectInput {
  key: string
  body: Buffer | Uint8Array
  contentType: string
  /** Small, non-sensitive tags — never a secret, never PII. */
  metadata?: Record<string, string>
}

export interface PutObjectResult {
  key: string
  etag?: string
}

export interface GetObjectResult {
  body: Buffer
  contentType: string | null
}

export interface SignedUrlOptions {
  /** Overrides the driver default (`SIGNED_URL_TTL_SECONDS`). */
  expiresInSeconds?: number
  /** Forces a filename/inline-vs-attachment behavior on download. */
  responseContentDisposition?: string
  responseContentType?: string
}

export interface SignedUploadUrlOptions extends SignedUrlOptions {
  contentType?: string
}

export interface StorageObjectHead {
  key: string
  contentType: string | null
  contentLength: number
  etag?: string | null
  lastModified?: Date | null
}

export interface StorageDriver {
  put(input: PutObjectInput): Promise<PutObjectResult>
  get(key: string): Promise<GetObjectResult>
  delete(key: string): Promise<void>
  /** Short-lived URL good for a GET of the object. */
  signedDownloadUrl(key: string, options?: SignedUrlOptions): Promise<string>
  /** Short-lived URL good for a PUT of the object (browser direct-upload flows). */
  signedUploadUrl(key: string, options?: SignedUploadUrlOptions): Promise<string>
  exists(key: string): Promise<boolean>
  copy(sourceKey: string, destinationKey: string): Promise<void>
  head(key: string): Promise<StorageObjectHead | null>
}
