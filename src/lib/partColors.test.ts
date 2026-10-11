import { expect, it } from 'vitest'
import { edgeThicknessColor, stepColor, FOOT_COLOR } from './partColors'

it('shares the preview strut heatmap, including explicit overrides and saturation', () => {
  expect(edgeThicknessColor(undefined).getHexString()).toBe('3a5a7a')
  expect(edgeThicknessColor(0).getHexString()).toBe('4fd97e')
  expect(edgeThicknessColor(300).getHexString()).toBe('ff3b3b')
  expect(edgeThicknessColor(600).getHexString()).toBe('ff3b3b')
  const mid = edgeThicknessColor(150)
  const low = edgeThicknessColor(0), high = edgeThicknessColor(300)
  expect(mid.r).toBeCloseTo((low.r + high.r) / 2)
  expect(mid.g).toBeCloseTo((low.g + high.g) / 2)
})

it('encodes preview linear RGB for the CAD color constructor without a gamma conversion', () => {
  const hex = stepColor(FOOT_COLOR).slice(1)
  FOOT_COLOR.forEach((value, i) => {
    expect(parseInt(hex.slice(i * 2, i * 2 + 2), 16) / 255).toBeCloseTo(value, 2)
  })
})
