import type { FmcsaLookupResult } from './types'

export interface FmcsaProvider {
  readonly name: string
  lookupByDot(dot: string): Promise<FmcsaLookupResult>
  lookupByMc(mc: string): Promise<FmcsaLookupResult>
}
