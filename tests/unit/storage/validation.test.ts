import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_UPLOAD_POLICY,
  MEDIA_UPLOAD_POLICY,
  sniffMimeType,
  validateUpload,
} from '@/lib/storage/validation'
import { isAppError } from '@/lib/errors'

const PDF_HEADER = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]) // "%PDF-1.4"
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]) // "PK\x03\x04"

function padded(header: Buffer, totalLength = 64): Buffer {
  const buf = Buffer.alloc(totalLength)
  header.copy(buf)
  return buf
}

describe('sniffMimeType', () => {
  it('identifies a real PDF by its magic bytes', () => {
    expect(sniffMimeType(padded(PDF_HEADER))).toEqual({ mimeType: 'application/pdf', extension: 'pdf' })
  })

  it('identifies a PNG', () => {
    expect(sniffMimeType(padded(PNG_HEADER))).toEqual({ mimeType: 'image/png', extension: 'png' })
  })

  it('identifies a JPEG', () => {
    expect(sniffMimeType(padded(JPEG_HEADER))).toEqual({ mimeType: 'image/jpeg', extension: 'jpg' })
  })

  it('returns null for a ZIP disguised with a .pdf extension', () => {
    expect(sniffMimeType(padded(ZIP_HEADER))).toBeNull()
  })

  it('returns null for an empty buffer', () => {
    expect(sniffMimeType(Buffer.alloc(0))).toBeNull()
  })
})

describe('validateUpload', () => {
  it('accepts a real PDF under the document policy', () => {
    const result = validateUpload(padded(PDF_HEADER), DOCUMENT_UPLOAD_POLICY)
    expect(result.mimeType).toBe('application/pdf')
  })

  it('rejects a ZIP renamed to look like a PDF, regardless of the declared type', () => {
    try {
      validateUpload(padded(ZIP_HEADER), DOCUMENT_UPLOAD_POLICY)
      expect.unreachable('expected validateUpload to throw')
    } catch (error) {
      expect(isAppError(error)).toBe(true)
      if (isAppError(error)) {
        expect(error.code).toBe('validation_failed')
        expect(error.messageKey).toBe('errors.fileTypeNotAllowed')
      }
    }
  })

  it('enforces the document policy size cap', () => {
    const oversized = Buffer.concat([PDF_HEADER, Buffer.alloc(DOCUMENT_UPLOAD_POLICY.maxBytes)])
    try {
      validateUpload(oversized, DOCUMENT_UPLOAD_POLICY)
      expect.unreachable('expected validateUpload to throw')
    } catch (error) {
      expect(isAppError(error)).toBe(true)
      if (isAppError(error)) expect(error.messageKey).toBe('errors.fileTooLarge')
    }
  })

  it('rejects a video under the document policy even though it is allowed under the media policy', () => {
    const mp4 = Buffer.alloc(32)
    mp4.write('ftyp', 4, 'ascii')
    mp4.write('isom', 8, 'ascii')

    expect(() => validateUpload(mp4, DOCUMENT_UPLOAD_POLICY)).toThrow()
    const result = validateUpload(mp4, MEDIA_UPLOAD_POLICY)
    expect(result.mimeType).toBe('video/mp4')
  })

  it('accepts webp only under the media policy', () => {
    const webp = Buffer.alloc(16)
    webp.write('RIFF', 0, 'ascii')
    webp.write('WEBP', 8, 'ascii')

    expect(() => validateUpload(webp, DOCUMENT_UPLOAD_POLICY)).toThrow()
    expect(validateUpload(webp, MEDIA_UPLOAD_POLICY).mimeType).toBe('image/webp')
  })
})
