import { authenticator } from 'otplib'
import { describe, expect, it } from 'vitest'
import { encryptField } from '@/lib/crypto'
import { consumeRecoveryCode, createMfaEnrollment, hashRecoveryCode, verifyTotp } from '@/lib/auth/mfa'

describe('MFA primitives', () => {
  it('createMfaEnrollment produces a QR code, an otpauth URL and ten recovery codes', async () => {
    const enrollment = await createMfaEnrollment('user@example.com')

    expect(enrollment.otpauthUrl).toMatch(/^otpauth:\/\/totp\//)
    expect(enrollment.qrDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(enrollment.recoveryCodes).toHaveLength(10)
    expect(enrollment.recoveryCodeHashes).toHaveLength(10)
    // Recovery codes are never stored in plaintext — only their hashes are
    // persisted by the caller — so the two arrays must never be equal.
    expect(enrollment.recoveryCodes).not.toEqual(enrollment.recoveryCodeHashes)
    // Every code is unique.
    expect(new Set(enrollment.recoveryCodes).size).toBe(10)
  })

  it('verifyTotp accepts the current code for the enrolled secret', () => {
    const secret = authenticator.generateSecret(20)
    const code = authenticator.generate(secret)
    const secretEncrypted = encryptField(secret)

    expect(verifyTotp(secretEncrypted, code)).toBe(true)
  })

  it('verifyTotp rejects an incorrect code', () => {
    const secret = authenticator.generateSecret(20)
    const secretEncrypted = encryptField(secret)
    const wrongCode = authenticator.generate(secret) === '000000' ? '111111' : '000000'

    expect(verifyTotp(secretEncrypted, wrongCode)).toBe(false)
  })

  it('verifyTotp rejects malformed input without throwing', () => {
    const secret = authenticator.generateSecret(20)
    const secretEncrypted = encryptField(secret)

    expect(verifyTotp(secretEncrypted, 'not-a-code')).toBe(false)
    expect(verifyTotp(secretEncrypted, '12345')).toBe(false)
    expect(verifyTotp(secretEncrypted, '')).toBe(false)
  })

  it('verifyTotp tolerates surrounding whitespace', () => {
    const secret = authenticator.generateSecret(20)
    const code = authenticator.generate(secret)
    const secretEncrypted = encryptField(secret)

    expect(verifyTotp(secretEncrypted, ` ${code} `)).toBe(true)
  })

  describe('recovery codes', () => {
    it('consumes a matching code exactly once', () => {
      const codes = ['ABCDE-12345', 'FGHIJ-67890', 'KLMNO-13579']
      const hashes = codes.map(hashRecoveryCode)

      const first = consumeRecoveryCode('ABCDE-12345', hashes)
      expect(first.ok).toBe(true)
      expect(first.remaining).toHaveLength(2)
      expect(first.remaining).not.toContain(hashRecoveryCode('ABCDE-12345'))

      // Replaying the same code against the reduced set fails — it is no
      // longer present.
      const replay = consumeRecoveryCode('ABCDE-12345', first.remaining)
      expect(replay.ok).toBe(false)
      expect(replay.remaining).toEqual(first.remaining)
    })

    it('rejects a code that was never issued', () => {
      const hashes = ['ABCDE-12345', 'FGHIJ-67890'].map(hashRecoveryCode)
      const result = consumeRecoveryCode('ZZZZZ-00000', hashes)
      expect(result.ok).toBe(false)
      expect(result.remaining).toEqual(hashes)
    })

    it('is case-insensitive and ignores separators, matching how a user would type it', () => {
      const hashes = [hashRecoveryCode('ABCDE-12345')]
      const result = consumeRecoveryCode('abcde12345', hashes)
      expect(result.ok).toBe(true)
    })
  })
})
