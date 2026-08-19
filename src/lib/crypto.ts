import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import { serverEnv } from './env'

/**
 * Field-level cryptography.
 *
 * • Sensitive identifiers (EIN, tax ID, driver licence, integration credentials)
 *   are sealed with AES-256-GCM under ENCRYPTION_KEY.
 * • Blind indexes use HMAC-SHA256 so equality lookups work without decryption.
 * • Opaque tokens (sessions, tracking links, signature links) are stored only as
 *   SHA-256 digests; the raw value exists exactly once, in transit.
 */

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const VERSION = 'v1'

function keyFrom(secret: string): Buffer {
  // Accepts either a 32-byte base64 key or any passphrase, which is stretched.
  const asBase64 = Buffer.from(secret, 'base64')
  if (asBase64.length === 32) return asBase64
  return createHash('sha256').update(secret, 'utf8').digest()
}

function primaryKey(): Buffer {
  return keyFrom(serverEnv().ENCRYPTION_KEY)
}

function previousKey(): Buffer | null {
  const prev = serverEnv().ENCRYPTION_KEY_PREVIOUS
  return prev ? keyFrom(prev) : null
}

/** Returns `v1:<iv>:<tag>:<ciphertext>`, all base64url. */
export function encryptField(plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, primaryKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(
    ':',
  )
}

function tryDecrypt(sealed: string, key: Buffer): string | null {
  const [version, ivB64, tagB64, dataB64] = sealed.split(':')
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) return null
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}

/** Decrypts, transparently accepting values sealed under the previous key. */
export function decryptField(sealed: string): string {
  const withPrimary = tryDecrypt(sealed, primaryKey())
  if (withPrimary !== null) return withPrimary
  const prev = previousKey()
  if (prev) {
    const withPrevious = tryDecrypt(sealed, prev)
    if (withPrevious !== null) return withPrevious
  }
  throw new Error('Unable to decrypt field: wrong key or corrupted ciphertext')
}

export function decryptFieldSafe(sealed: string | null | undefined): string | null {
  if (!sealed) return null
  try {
    return decryptField(sealed)
  } catch {
    return null
  }
}

/** Deterministic blind index for equality search over an encrypted column. */
export function blindIndex(value: string, domain: string): string {
  return createHmac('sha256', keyFrom(serverEnv().ENCRYPTION_KEY))
    .update(`${domain}:${normalizeForIndex(value)}`)
    .digest('hex')
}

export function normalizeForIndex(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

/* ── Tokens ──────────────────────────────────────────────────────────────── */

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function sha256Hex(input: string | Buffer | Uint8Array): string {
  return createHash('sha256')
    .update(input instanceof Uint8Array ? Buffer.from(input) : input)
    .digest('hex')
}

export function hmacHex(input: string, secret: string): string {
  return createHmac('sha256', secret).update(input).digest('hex')
}

/** Constant-time comparison that never throws on length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    // Still perform a comparison to keep the timing profile flat.
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

export const newId = () => randomUUID()

/* ── Masking ─────────────────────────────────────────────────────────────── */

/** `••••1234` — the only representation of a sensitive identifier the UI sees. */
export function maskLast4(last4: string | null | undefined, maskChar = '•', groups = 4): string {
  if (!last4) return maskChar.repeat(groups)
  return `${maskChar.repeat(groups)}${last4}`
}

export function last4Of(value: string): string {
  const digits = value.replace(/[^a-zA-Z0-9]/g, '')
  return digits.slice(-4)
}

/**
 * Seals a sensitive identifier into the triple every table stores:
 * ciphertext, display suffix, and blind index for duplicate detection.
 */
export function sealIdentifier(value: string, domain: string) {
  return {
    encrypted: encryptField(value),
    last4: last4Of(value),
    hash: blindIndex(value, domain),
  }
}
