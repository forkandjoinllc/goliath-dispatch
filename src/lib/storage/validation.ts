import { AppError } from '@/lib/errors'
import { bytesToHuman } from '@/lib/utils'

/**
 * File-type and size enforcement.
 *
 * The client-declared `Content-Type` header and the filename extension are
 * both attacker-controlled and are never trusted. Every upload is sniffed by
 * magic bytes; the sniffed type — not the declared one — is what gets checked
 * against the allow-list and what gets persisted on the document version.
 */

export interface SniffedFile {
  mimeType: string
  extension: string
}

export interface UploadPolicy {
  /** Human name for error messages, e.g. "document" or "equipment media". */
  name: string
  maxBytes: number
  allowedMimeTypes: readonly string[]
}

/** PDF, JPG, PNG only, 15 MB — used for onboarding, load and compliance documents. */
export const DOCUMENT_UPLOAD_POLICY: UploadPolicy = {
  name: 'document',
  maxBytes: 15 * 1024 * 1024,
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
}

/** Adds webp/mp4/mov and a much larger cap — used for equipment photos and video. */
export const MEDIA_UPLOAD_POLICY: UploadPolicy = {
  name: 'media',
  maxBytes: 200 * 1024 * 1024,
  allowedMimeTypes: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/quicktime',
  ],
}

function bytesStartWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false
  }
  return true
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return ''
  return Buffer.from(bytes.slice(offset, offset + length)).toString('ascii')
}

/**
 * Identifies a file by its magic bytes only. Returns null for anything not in
 * the small set of formats this product accepts — callers turn that into a
 * rejection, never a best-effort guess.
 */
export function sniffMimeType(bytes: Uint8Array): SniffedFile | null {
  // %PDF
  if (bytesStartWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
    return { mimeType: 'application/pdf', extension: 'pdf' }
  }
  // JPEG SOI marker
  if (bytesStartWith(bytes, [0xff, 0xd8, 0xff])) {
    return { mimeType: 'image/jpeg', extension: 'jpg' }
  }
  // PNG signature
  if (bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mimeType: 'image/png', extension: 'png' }
  }
  // RIFF....WEBP
  if (asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP') {
    return { mimeType: 'image/webp', extension: 'webp' }
  }
  // ISO base media container (mp4/mov): box size (4 bytes) + 'ftyp' + brand.
  if (asciiAt(bytes, 4, 4) === 'ftyp') {
    const brand = asciiAt(bytes, 8, 4).trim().toLowerCase()
    if (brand === 'qt') return { mimeType: 'video/quicktime', extension: 'mov' }
    return { mimeType: 'video/mp4', extension: 'mp4' }
  }
  return null
}

/**
 * Validates size and sniffed type against a policy. Throws `AppError`s whose
 * message keys already exist in `errors.json` so callers do not need to
 * invent copy for the common cases.
 */
export function validateUpload(bytes: Uint8Array, policy: UploadPolicy): SniffedFile {
  if (bytes.byteLength === 0) {
    throw new AppError('validation_failed', 'errors.fileTypeNotAllowed')
  }
  if (bytes.byteLength > policy.maxBytes) {
    throw new AppError('validation_failed', 'errors.fileTooLarge', {
      params: { max: bytesToHuman(policy.maxBytes) },
    })
  }
  const sniffed = sniffMimeType(bytes)
  if (!sniffed || !policy.allowedMimeTypes.includes(sniffed.mimeType)) {
    throw new AppError('validation_failed', 'errors.fileTypeNotAllowed')
  }
  return sniffed
}
