import { authenticator } from 'otplib'
import QRCode from 'qrcode'
import { createHash, randomBytes } from 'node:crypto'
import { encryptField, decryptField, safeEqual } from '../crypto'

/**
 * TOTP-based MFA. Mandatory for Admin and Accounting; available to any role.
 * Secrets are stored encrypted, recovery codes only as SHA-256 digests.
 */

authenticator.options = { window: 1, step: 30 }

export interface MfaEnrollment {
  secretEncrypted: string
  otpauthUrl: string
  qrDataUrl: string
  recoveryCodes: string[]
  recoveryCodeHashes: string[]
}

export async function createMfaEnrollment(
  accountLabel: string,
  issuer = 'Goliath Dispatch',
): Promise<MfaEnrollment> {
  const secret = authenticator.generateSecret(20)
  const otpauthUrl = authenticator.keyuri(accountLabel, issuer, secret)
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 })
  const recoveryCodes = Array.from({ length: 10 }, () => formatRecoveryCode())
  return {
    secretEncrypted: encryptField(secret),
    otpauthUrl,
    qrDataUrl,
    recoveryCodes,
    recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
  }
}

export function verifyTotp(secretEncrypted: string, token: string): boolean {
  const cleaned = token.replace(/\s/g, '')
  if (!/^\d{6}$/.test(cleaned)) return false
  try {
    return authenticator.check(cleaned, decryptField(secretEncrypted))
  } catch {
    return false
  }
}

function formatRecoveryCode(): string {
  const raw = randomBytes(5).toString('hex').toUpperCase()
  return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.replace(/[^A-Z0-9]/gi, '').toUpperCase()).digest('hex')
}

/**
 * Consumes a recovery code, returning the remaining hashes. Single-use: the
 * matched hash is removed so a code cannot be replayed.
 */
export function consumeRecoveryCode(
  submitted: string,
  storedHashes: string[],
): { ok: boolean; remaining: string[] } {
  const candidate = hashRecoveryCode(submitted)
  const index = storedHashes.findIndex((h) => safeEqual(h, candidate))
  if (index === -1) return { ok: false, remaining: storedHashes }
  const remaining = [...storedHashes.slice(0, index), ...storedHashes.slice(index + 1)]
  return { ok: true, remaining }
}
