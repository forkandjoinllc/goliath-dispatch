import { describe, expect, it } from 'vitest'
import { extractVins } from '@/integrations/ocr/vin-extractor'

const VIN_A = '1FUJA6CV12LM3864X' // 17 chars, no I/O/Q
const VIN_B = '5FNRL38409B404567' // 17 chars, no I/O/Q

describe('extractVins', () => {
  it('finds a clean, unsplit 17-character VIN', () => {
    expect(VIN_A).toHaveLength(17)
    const text = `Certificate of Insurance\nVIN: ${VIN_A}\nUnit: 104`
    expect(extractVins(text)).toEqual([VIN_A])
  })

  it('rejects a 16-character string (too short)', () => {
    const sixteen = VIN_A.slice(0, 16)
    expect(extractVins(`VIN: ${sixteen}\n`)).toEqual([])
  })

  it('rejects an 18-character string (too long) rather than truncating it to a fake VIN', () => {
    const eighteen = `${VIN_A}9`
    expect(eighteen).toHaveLength(18)
    expect(extractVins(`VIN: ${eighteen}\n`)).toEqual([])
  })

  it('excludes I, O and Q from matches entirely', () => {
    // Replacing a character with 'I' breaks the contiguous run — no match anywhere in it.
    const withI = `${VIN_A.slice(0, 8)}I${VIN_A.slice(9)}`
    expect(extractVins(`VIN: ${withI}`)).toEqual([])
  })

  it('reunites a VIN split across a line wrap with no hyphen', () => {
    const first = VIN_A.slice(0, 9)
    const second = VIN_A.slice(9)
    const text = `Vehicle Identification Number:\n${first}\n${second}\nPolicy Number: ABC-123`
    expect(extractVins(text)).toEqual([VIN_A])
  })

  it('reunites a VIN split across a hyphenated line wrap', () => {
    const first = VIN_A.slice(0, 9)
    const second = VIN_A.slice(9)
    const text = `VIN: ${first}-\n${second}`
    expect(extractVins(text)).toEqual([VIN_A])
  })

  it('reunites a VIN split by a same-line hyphen', () => {
    const first = VIN_A.slice(0, 9)
    const second = VIN_A.slice(9)
    const text = `VIN: ${first}-${second} (see attached)`
    expect(extractVins(text)).toEqual([VIN_A])
  })

  it('does not stitch two runs across a line wrap whose combined length is 18, not 17', () => {
    // 9 + 9 = 18: each half is individually a legal VIN-charset run, but the
    // total is one character too many to be a real split VIN.
    const firstHalf = VIN_A.slice(0, 9)
    const secondHalf = `${VIN_A.slice(9, 17)}5`
    const text = `VIN: ${firstHalf}\n${secondHalf}\n`
    expect(extractVins(text)).toEqual([])
  })

  it('dedupes repeated mentions of the same VIN, normalizing case', () => {
    const text = `VIN: ${VIN_A}\nAlso shown as ${VIN_A.toLowerCase()} on page 2.`
    expect(extractVins(text)).toEqual([VIN_A])
  })

  it('finds multiple distinct VINs in one document', () => {
    const text = `Truck VIN: ${VIN_A}\nTrailer VIN: ${VIN_B}\n`
    expect(extractVins(text)).toEqual([VIN_A, VIN_B])
  })

  it('returns an empty array for text with no VIN-shaped content', () => {
    expect(extractVins('Certificate of Insurance for Summit Heavy Haul LLC, policy 8842.')).toEqual([])
  })
})
