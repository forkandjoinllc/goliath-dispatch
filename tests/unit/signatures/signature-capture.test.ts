import { describe, expect, it } from 'vitest'
import { assertRealSignatureCapture } from '@/server/signatures/service'

describe('assertRealSignatureCapture', () => {
  it('rejects a drawn signature with no strokes', () => {
    expect(() =>
      assertRealSignatureCapture({
        method: 'drawn',
        hasDrawnStrokes: false,
        typedName: null,
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }),
    ).toThrow()
  })

  it('rejects a whitespace-only typed name', () => {
    expect(() =>
      assertRealSignatureCapture({
        method: 'typed',
        hasDrawnStrokes: false,
        typedName: '   ',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }),
    ).toThrow()
  })

  it('rejects a null typed name', () => {
    expect(() =>
      assertRealSignatureCapture({
        method: 'typed',
        hasDrawnStrokes: false,
        typedName: null,
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }),
    ).toThrow()
  })

  it('rejects a missing data URL even when the client claims strokes exist', () => {
    expect(() =>
      assertRealSignatureCapture({
        method: 'drawn',
        hasDrawnStrokes: true,
        typedName: null,
        dataUrl: null,
      }),
    ).toThrow()
  })

  it('accepts a drawn signature with strokes and a data URL', () => {
    expect(() =>
      assertRealSignatureCapture({
        method: 'drawn',
        hasDrawnStrokes: true,
        typedName: null,
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }),
    ).not.toThrow()
  })

  it('accepts a typed signature with a real name and a data URL', () => {
    expect(() =>
      assertRealSignatureCapture({
        method: 'typed',
        hasDrawnStrokes: false,
        typedName: 'Jordan Rivera',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }),
    ).not.toThrow()
  })
})
