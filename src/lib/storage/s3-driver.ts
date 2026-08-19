import 'server-only'
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { notFound } from '@/lib/errors'
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
 * AWS SDK v3 driver against S3 or an S3-compatible endpoint (MinIO, Cloudflare
 * R2, Supabase Storage). `S3_ENDPOINT` + `S3_FORCE_PATH_STYLE` switch it from
 * real S3 to any of those without a code change.
 */
export class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client
  private readonly bucket: string
  private readonly defaultTtlSeconds: number

  constructor() {
    const env = serverEnv()
    this.bucket = env.S3_BUCKET
    this.defaultTtlSeconds = env.SIGNED_URL_TTL_SECONDS
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
          : undefined,
    })
  }

  async put(input: PutObjectInput): Promise<PutObjectResult> {
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        Metadata: input.metadata,
        // Private bucket, encrypted at rest. AES256 works uniformly across
        // AWS and the S3-compatible providers this driver also targets; a
        // tenant that requires customer-managed KMS keys is a future,
        // provider-specific extension of this same driver.
        ServerSideEncryption: 'AES256',
      }),
    )
    return { key: input.key, etag: result.ETag }
  }

  async get(key: string): Promise<GetObjectResult> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
      const body = Buffer.from(await result.Body!.transformToByteArray())
      return { body, contentType: result.ContentType ?? null }
    } catch (error) {
      if (error instanceof NotFound) throw notFound('errors.notFound', { entity: 'document' })
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return true
    } catch (error) {
      if (error instanceof NotFound) return false
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      if (status === 404) return false
      throw error
    }
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: destinationKey,
        CopySource: `${this.bucket}/${sourceKey}`,
        ServerSideEncryption: 'AES256',
      }),
    )
  }

  async head(key: string): Promise<StorageObjectHead | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return {
        key,
        contentType: result.ContentType ?? null,
        contentLength: result.ContentLength ?? 0,
        etag: result.ETag,
        lastModified: result.LastModified ?? null,
      }
    } catch (error) {
      if (error instanceof NotFound) return null
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      if (status === 404) return null
      throw error
    }
  }

  async signedDownloadUrl(key: string, options?: SignedUrlOptions): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: options?.responseContentDisposition,
        ResponseContentType: options?.responseContentType,
      }),
      { expiresIn: options?.expiresInSeconds ?? this.defaultTtlSeconds },
    )
  }

  async signedUploadUrl(key: string, options?: SignedUploadUrlOptions): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: options?.contentType,
        ServerSideEncryption: 'AES256',
      }),
      { expiresIn: options?.expiresInSeconds ?? this.defaultTtlSeconds },
    )
  }
}
