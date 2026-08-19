export interface ExtractionResult {
  rawText: string
  /** Normalized (uppercased, O/I/Q-folded) 17-character VINs, deduped, in first-seen order. */
  vins: string[]
  /** 0-100. Adapters that cannot produce a meaningful confidence should report 0, never omit it. */
  confidence: number
  provider: string
}
