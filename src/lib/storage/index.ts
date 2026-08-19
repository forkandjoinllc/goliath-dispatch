import 'server-only'
import { serverEnv } from '@/lib/env'
import { LocalStorageDriver } from './local-driver'
import { S3StorageDriver } from './s3-driver'
import type { StorageDriver } from './types'

export * from './types'
export * from './keys'
export * from './validation'
export * from './malware'

let cachedDriver: StorageDriver | null = null

/** Memoized driver selected by `STORAGE_DRIVER`. */
export function getStorage(): StorageDriver {
  if (cachedDriver) return cachedDriver
  cachedDriver = serverEnv().STORAGE_DRIVER === 's3' ? new S3StorageDriver() : new LocalStorageDriver()
  return cachedDriver
}

/** Test-only: forces the next `getStorage()` call to construct a fresh driver. */
export function __resetStorageForTests(): void {
  cachedDriver = null
}
