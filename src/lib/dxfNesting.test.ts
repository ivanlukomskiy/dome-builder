import { describe, expect, it, vi } from 'vitest'
import { nestDxfParts, packingEnvelope, type NestingEngine, type Point2 } from './dxfNesting'
import { DEFAULT_DXF_SHEET_SETTINGS, validateDxfSheetSettings } from './dxfSheetSettings'
import { layoutDxfParts, writeDxf, type DxfPart } from './dxf'

const settings = { ...DEFAULT_DXF_SHEET_SETTINGS, arrangeOnSheet: true, width: 100, height: 100, margin: 10, spacing: 5 }
const rectangle = (name = '1', width = 20, height = 10): DxfPart => ({ name, kind: 'strut', loops: [{ closed: true,
  vertices: [[0, 0], [width, 0], [width, height], [0, height]].map(([x, y]) => ({ x, y, bulge: 0 })) }] })
const placement = (index = 0, sheet = 0, x = 0, y = 0, angle = 0) => ({ index, sheet, x: x * 1e6, y: y * 1e6, angle })
const engine = (...placements: ReturnType<typeof placement>[]): NestingEngine => ({ pack: vi.fn(() => placements) })

describe('sheet settings', () => {
  it.each([
    { width: 0 }, { height: -1 }, { margin: -1 }, { spacing: -1 }, { margin: 50 }, { width: NaN }, { spacing: Infinity },
  ])('rejects invalid settings %j', (override) => {
    expect(() => validateDxfSheetSettings({ ...settings, ...override })).toThrow()
  })
})

describe('packing envelopes', () => {
  it('encloses circular arcs between vertices rather than cutting across them', () => {
    for (const bulge of [-1, 1]) {
      const hull = packingEnvelope([{ closed: true, vertices: [{ x: -10, y: 0, bulge }, { x: 10, y: 0, bulge }] }], 2)
      const contains = (p: Point2) => hull.every((a, i) => {
        const b = hull[(i + 1) % hull.length]
        return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) <= 1
      })
      for (let i = 0; i < 1000; i++) {
        const angle = i * Math.PI * 2 / 1000
        expect(contains([Math.cos(angle) * 20e6, Math.sin(angle) * 20e6])).toBe(true)
      }
    }
  })

  it('rejects empty, open, and nonfinite outlines', () => {
    expect(() => packingEnvelope([], 1)).toThrow()
    expect(() => packingEnvelope([{ ...rectangle().loops[0], closed: false }], 1)).toThrow(/open/)
    expect(() => packingEnvelope([{ closed: true, vertices: [{ x: NaN, y: 0, bulge: 0 }, { x: 10, y: 10, bulge: 0 }] }], 1)).toThrow(/invalid/)
  })
})

describe('sheet layout', () => {
  it('uses exported millimeters and moves geometry, holes, and annotations together', () => {
    const part = rectangle()
    part.loops.push(rectangle('hole', 2, 2).loops[0])
    part.labelAnchor = { x: 5, y: 3 }
    part.labelAngleDeg = 15
    part.helpers = [{ text: '2', x: 2, y: 1, height: 3, angleDeg: 30 }]
    const result = nestDxfParts([part], { scale: 2, partIdLabelSize: 4 }, settings, engine(placement(0, 0, 20, 0, Math.PI / 2)))
    expect(result.sheets).toEqual([{ x: 0, y: 0, width: 100, height: 100 }])
    expect(result.parts[0].loops[0].vertices[0]).toEqual({ x: 30, y: 10, bulge: 0 })
    expect(result.parts[0].loops[1].vertices[1].y).toBeCloseTo(14)
    expect(result.parts[0].label).toEqual({ x: 24, y: 20, height: 8, angleDeg: 105 })
    expect(result.parts[0].helpers[0]).toEqual({ text: '2', x: 28, y: 14, height: 6, angleDeg: 120 })
  })

  it('preserves arc bulges', () => {
    const part: DxfPart = { name: 'circle', kind: 'flange', loops: [{ closed: true,
      vertices: [{ x: -5, y: 0, bulge: 1 }, { x: 5, y: 0, bulge: 1 }] }] }
    const result = nestDxfParts([part], { scale: 1 }, settings, engine(placement(0, 0, 10, 10, Math.PI / 2)))
    expect(result.parts[0].loops[0].vertices.map((v) => v.bulge)).toEqual([1, 1])
  })

  it('rejects an oversized part before calling the engine, allowing quarter turns', () => {
    const packer = engine(placement())
    expect(() => nestDxfParts([rectangle('too-large', 90, 90)], { scale: 1 }, settings, packer)).toThrow(/too-large.*usable sheet/)
    expect(packer.pack).not.toHaveBeenCalled()
    expect(() => nestDxfParts([rectangle('rotated', 70, 20)], { scale: 1 }, { ...settings, width: 50 }, engine(placement(0, 0, 20, 0, Math.PI / 2)))).not.toThrow()
  })

  it('draws additional sheets side by side on their own DXF layer', () => {
    const result = nestDxfParts([rectangle('1'), rectangle('2')], { scale: 1 }, settings, engine(placement(), placement(1, 1)))
    expect(result.sheets[1]).toEqual({ x: 120, y: 0, width: 100, height: 100 })
    expect(result.parts[1].loops[0].vertices[0].x).toBe(130)
    const dxf = writeDxf(result.parts, result.sheets)
    expect(dxf.match(/0\nPOLYLINE\n8\nSHEETS\n/g)).toHaveLength(2)
    expect(dxf).toContain('2\nSHEETS\n70\n0\n62\n5\n')
    expect(writeDxf(layoutDxfParts([rectangle()], { scale: 1 }))).not.toContain('SHEETS')
  })

  it('rejects overlaps, insufficient spacing, margins, and missing or duplicate parts', () => {
    const parts = [rectangle('1'), rectangle('2')]
    for (const placements of [[placement()], [placement(), placement()], [placement(), placement(1, 0, 19)], [placement(), placement(1, 0, 24)], [placement(), placement(1, 0, 70)]])
      expect(() => nestDxfParts(parts, { scale: 1 }, settings, engine(...placements))).toThrow(/Packing failed/)
    expect(() => nestDxfParts(parts, { scale: 1 }, settings, engine(placement(), placement(1, 0, 25)))).not.toThrow()
  })

  it('rejects containment even when no edges intersect', () => {
    expect(() => nestDxfParts([rectangle('big', 40, 40), rectangle('small', 5, 5)], { scale: 1 }, settings,
      engine(placement(), placement(1, 0, 10, 10)))).toThrow(/overlap/)
  })

  it('offers the engine the multiples of the rotation step, and rejects any other angle', () => {
    const degrees = (rotationStep: 0 | 90 | 60 | 30 | 10) => {
      const packer = engine(placement())
      nestDxfParts([rectangle()], { scale: 1 }, { ...settings, rotationStep }, packer)
      return vi.mocked(packer.pack).mock.calls[0][4].map((angle) => Math.round(angle * 180 / Math.PI))
    }
    expect(degrees(0)).toEqual([0])
    expect(degrees(90)).toEqual([0, 90, 180, 270])
    expect(degrees(60)).toEqual([0, 60, 120, 180, 240, 300])
    expect(degrees(30)).toHaveLength(12)
    expect(degrees(10)).toHaveLength(36)

    const turned = (deg: number) => engine(placement(0, 0, 40, 40, deg * Math.PI / 180))
    expect(() => nestDxfParts([rectangle()], { scale: 1 }, { ...settings, rotationStep: 60 }, turned(120))).not.toThrow()
    expect(() => nestDxfParts([rectangle()], { scale: 1 }, { ...settings, rotationStep: 60 }, turned(90))).toThrow(/not allowed/)
    expect(() => nestDxfParts([rectangle()], { scale: 1 }, { ...settings, rotationStep: 0 }, turned(90))).toThrow(/not allowed/)
  })

  it('accepts a part that only fits the sheet at one of the finer angles', () => {
    // 120 mm long: too long for the 80 mm usable square either way up, but not along its diagonal.
    const long = rectangle('long', 100, 2)
    expect(() => nestDxfParts([long], { scale: 1 }, { ...settings, rotationStep: 90 }, engine(placement()))).toThrow(/usable sheet/)
    expect(() => nestDxfParts([long], { scale: 1 }, { ...settings, rotationStep: 0 }, engine(placement()))).toThrow(/usable sheet/)
    expect(() => nestDxfParts([long], { scale: 1 }, { ...settings, rotationStep: 30 },
      engine(placement(0, 0, 2, 0, Math.PI / 6)))).toThrow(/usable sheet/)
    expect(() => nestDxfParts([long], { scale: 1 }, { ...settings, rotationStep: 10 },
      engine(placement(0, 0, 2, 0, 40 * Math.PI / 180)))).not.toThrow()
  })
})
