import bcrypt from 'bcryptjs'
import { z } from 'zod'

/**
 * Password policy: length over composition theatre, plus a rejection list for
 * the handful of patterns that show up in real credential-stuffing attempts.
 */

const COMMON = new Set([
  'password',
  'password1',
  'password123',
  'qwerty123',
  '12345678',
  '123456789',
  'letmein1',
  'welcome1',
  'iloveyou',
  'admin123',
  'dispatch1',
  'trucking1',
])

export const MIN_PASSWORD_LENGTH = 12
export const MAX_PASSWORD_LENGTH = 200
const BCRYPT_ROUNDS = 12

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, 'validation.password.tooShort')
  .max(MAX_PASSWORD_LENGTH, 'validation.password.tooLong')
  .refine((v) => /[a-z]/.test(v), 'validation.password.needsLowercase')
  .refine((v) => /[A-Z]/.test(v), 'validation.password.needsUppercase')
  .refine((v) => /[0-9]/.test(v), 'validation.password.needsDigit')
  .refine((v) => !COMMON.has(v.toLowerCase()), 'validation.password.tooCommon')
  .refine((v) => !/^(.)\1+$/.test(v), 'validation.password.tooRepetitive')

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

/**
 * A syntactically valid bcrypt hash (correct 60-character `$2a$12$<22-char
 * salt><31-char digest>` shape) that no real password will ever match. It
 * exists purely so a missing hash still pays bcrypt's full comparison cost —
 * a malformed placeholder (wrong length or alphabet) makes bcryptjs reject it
 * before doing any hashing work at all, which would make the "no such user"
 * path measurably faster than a real wrong-password check and reopen the
 * exact timing side-channel this is meant to close.
 */
const DUMMY_HASH_FOR_TIMING_SAFETY = '$2a$12$CwaJqTm0lxbNvxjTQ8vGKeF7q1lzUxbEQfSbW51qDIe9U1U4bB.Vu'

export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  if (!hash) {
    // Burn comparable time so a missing hash is not distinguishable by timing.
    await bcrypt.compare(plain, DUMMY_HASH_FOR_TIMING_SAFETY)
    return false
  }
  return bcrypt.compare(plain, hash)
}

export function passwordStrengthIssues(plain: string): string[] {
  const result = passwordSchema.safeParse(plain)
  return result.success ? [] : result.error.issues.map((i) => i.message)
}
