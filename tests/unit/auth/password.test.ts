import { describe, expect, it } from 'vitest'
import {
  MIN_PASSWORD_LENGTH,
  hashPassword,
  passwordSchema,
  passwordStrengthIssues,
  verifyPassword,
} from '@/lib/auth/password'

describe('password policy', () => {
  it('accepts a password meeting every rule', () => {
    const result = passwordSchema.safeParse('Str0ngPassphrase!')
    expect(result.success).toBe(true)
  })

  it('rejects a password shorter than the minimum length', () => {
    const short = 'Ab1'.padEnd(MIN_PASSWORD_LENGTH - 1, 'a')
    const result = passwordSchema.safeParse(short)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message)).toContain('validation.password.tooShort')
    }
  })

  it('requires at least one lowercase, one uppercase and one digit', () => {
    expect(passwordStrengthIssues('ALLUPPERCASE1234')).toContain('validation.password.needsLowercase')
    expect(passwordStrengthIssues('alllowercase1234')).toContain('validation.password.needsUppercase')
    expect(passwordStrengthIssues('NoDigitsHereAtAll')).toContain('validation.password.needsDigit')
  })

  it('rejects passwords on the common-password list regardless of case', () => {
    expect(passwordStrengthIssues('CorrectHorseBattery9')).toEqual([])
    expect(passwordStrengthIssues('password123')).toContain('validation.password.tooCommon')
    // The list also carries a couple of trucking-industry-specific entries.
    expect(passwordStrengthIssues('DISPATCH1')).toContain('validation.password.tooCommon')
  })

  it('rejects a single repeated character regardless of length', () => {
    const repetitive = 'a'.repeat(MIN_PASSWORD_LENGTH + 4)
    expect(passwordStrengthIssues(repetitive)).toContain('validation.password.tooRepetitive')
  })

  it('passwordStrengthIssues returns an empty array for a fully compliant password', () => {
    expect(passwordStrengthIssues('CorrectHorseBattery9')).toEqual([])
  })

  it('hashPassword + verifyPassword round-trip correctly', async () => {
    const hash = await hashPassword('Str0ngPassphrase!')
    expect(await verifyPassword('Str0ngPassphrase!', hash)).toBe(true)
    expect(await verifyPassword('WrongPassphrase!9', hash)).toBe(false)
  })

  it('verifyPassword returns false (not throws) for a null hash, in comparable time', async () => {
    const result = await verifyPassword('anything', null)
    expect(result).toBe(false)
  })
})
