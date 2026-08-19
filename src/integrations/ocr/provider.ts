import type { ExtractionResult } from './types'

export interface OcrProvider {
  readonly name: string
  extractFromDocument(bytes: Uint8Array, contentType: string): Promise<ExtractionResult>
}
