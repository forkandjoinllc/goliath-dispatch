import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalStorageDriver, verifyLocalUrl } from '@/lib/storage/local-driver'

let root: string
let driver: LocalStorageDriver

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'goliath-local-storage-'))
  driver = new LocalStorageDriver(root)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const KEY = 'tenants/t1/carriers/c1/documents/d1/v1/coi.pdf'

describe('LocalStorageDriver', () => {
  it('round-trips a file through put/get', async () => {
    const body = Buffer.from('%PDF-1.4 fake contents')
    await driver.put({ key: KEY, body, contentType: 'application/pdf' })

    const result = await driver.get(KEY)
    expect(result.body.equals(body)).toBe(true)
    expect(result.contentType).toBe('application/pdf')
  })

  it('reports existence correctly before and after a write', async () => {
    expect(await driver.exists(KEY)).toBe(false)
    await driver.put({ key: KEY, body: Buffer.from('hi'), contentType: 'text/plain' })
    expect(await driver.exists(KEY)).toBe(true)
  })

  it('deletes an object and its metadata', async () => {
    await driver.put({ key: KEY, body: Buffer.from('hi'), contentType: 'text/plain' })
    await driver.delete(KEY)
    expect(await driver.exists(KEY)).toBe(false)
    expect(await driver.head(KEY)).toBeNull()
  })

  it('copies an object, preserving content type', async () => {
    await driver.put({ key: KEY, body: Buffer.from('hi'), contentType: 'text/plain' })
    const destination = 'tenants/t1/carriers/c1/documents/d1/v2/coi.pdf'
    await driver.copy(KEY, destination)

    const head = await driver.head(destination)
    expect(head?.contentType).toBe('text/plain')
    expect((await driver.get(destination)).body.toString()).toBe('hi')
  })

  it('refuses to resolve a key that escapes the storage root', async () => {
    await expect(driver.get('../../etc/passwd')).rejects.toThrow()
  })

  describe('signed URLs', () => {
    it('produces a URL a matching signature verifies', async () => {
      const url = await driver.signedDownloadUrl(KEY, { expiresInSeconds: 60 })
      expect(url.startsWith('/api/documents/local/')).toBe(true)

      const parsed = new URL(url, 'http://localhost')
      const exp = Number(parsed.searchParams.get('exp'))
      const sig = parsed.searchParams.get('sig')!
      expect(verifyLocalUrl({ key: KEY, action: 'download', expiresAtSeconds: exp, signature: sig })).toBe(true)
    })

    it('rejects a tampered signature', async () => {
      const url = await driver.signedDownloadUrl(KEY, { expiresInSeconds: 60 })
      const parsed = new URL(url, 'http://localhost')
      const exp = Number(parsed.searchParams.get('exp'))
      const tamperedSig = `${parsed.searchParams.get('sig')!.slice(0, -2)}00`

      expect(verifyLocalUrl({ key: KEY, action: 'download', expiresAtSeconds: exp, signature: tamperedSig })).toBe(
        false,
      )
    })

    it('rejects a signature computed for a different key', async () => {
      const url = await driver.signedDownloadUrl(KEY, { expiresInSeconds: 60 })
      const parsed = new URL(url, 'http://localhost')
      const exp = Number(parsed.searchParams.get('exp'))
      const sig = parsed.searchParams.get('sig')!

      expect(
        verifyLocalUrl({ key: `${KEY}.other`, action: 'download', expiresAtSeconds: exp, signature: sig }),
      ).toBe(false)
    })

    it('rejects a signature that has expired even though it was valid when minted', async () => {
      const url = await driver.signedDownloadUrl(KEY, { expiresInSeconds: -1 })
      const parsed = new URL(url, 'http://localhost')
      const exp = Number(parsed.searchParams.get('exp'))
      const sig = parsed.searchParams.get('sig')!

      expect(verifyLocalUrl({ key: KEY, action: 'download', expiresAtSeconds: exp, signature: sig })).toBe(false)
    })

    it('rejects a signature minted for the upload action when used for download', async () => {
      const url = await driver.signedUploadUrl(KEY, { expiresInSeconds: 60 })
      const parsed = new URL(url, 'http://localhost')
      const exp = Number(parsed.searchParams.get('exp'))
      const sig = parsed.searchParams.get('sig')!

      expect(verifyLocalUrl({ key: KEY, action: 'download', expiresAtSeconds: exp, signature: sig })).toBe(false)
      expect(verifyLocalUrl({ key: KEY, action: 'upload', expiresAtSeconds: exp, signature: sig })).toBe(true)
    })
  })
})
