import { describe, expect, it } from 'vitest'
import {
  clampPartTransparency,
  MAX_PART_TRANSPARENCY,
  partOpacity,
} from './previewParts'

describe('clampPartTransparency', () => {
  it('keeps values within 0 and the maximum', () => {
    expect(clampPartTransparency(-10)).toBe(0)
    expect(clampPartTransparency(40)).toBe(40)
    expect(clampPartTransparency(100)).toBe(MAX_PART_TRANSPARENCY)
    expect(clampPartTransparency(Number.NaN)).toBe(0)
  })
})

describe('partOpacity', () => {
  it('is opaque at 0% and 15% opaque at the 85% maximum', () => {
    expect(partOpacity(0)).toBe(1)
    expect(partOpacity(85)).toBeCloseTo(0.15, 9)
    expect(partOpacity(500)).toBeCloseTo(0.15, 9)
  })
})
