/// <reference types="node" />
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Drawing, measureArea, setOC, type Face } from 'replicad'
import initOpenCascade from 'replicad-opencascadejs'
import { arcEndpoints, computeStrutBoundary2D, precalculateStrutEnd } from './strutGeometry'
import { DEFAULT_BRACE_PARAMS, NO_STRUT_BRACES, type StrutBraces } from './braces'

beforeAll(async () => {
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm'))
  setOC(await initOpenCascade({ wasmBinary }))
}, 30_000)

function area(drawing: Drawing): number {
  const sketch = drawing.sketchOnPlane()
  const face = 'face' in sketch ? sketch.face() : sketch.faces()
  try { return measureArea(face as Face) } finally { face.delete() }
}

// Areas measured from the previous boolean construction, with unequal end lengths/offsets.
const cases = [
  { name: 'chamfers and milling', groove: 20, milling: 5, chamfer: 6, areas: [86086.2306539343, 95857.5420748395] },
  { name: 'chamfers only', groove: 20, milling: 0, chamfer: 6, areas: [86129.04037844393, 95900.35179934911] },
  { name: 'milling only', groove: 20, milling: 5, chamfer: 0, areas: [86302.23065393433, 96073.5420748395] },
  { name: 'square shoulders', groove: 20, milling: 0, chamfer: 0, areas: [85932.54037844388, 96069.2917562012] },
]

function build(round: boolean, c = cases[0], braces: StrutBraces = NO_STRUT_BRACES) {
  return computeStrutBoundary2D([1000, 0], [500, Math.sqrt(3) * 500], [0, 0],
    20, 30, 150, 180, 50, 15, 20, c.groove, c.milling, c.chamfer, braces, round)
}

describe('single strut outline', () => {
  it.each([0, 10.5, -7.25])('offsets shell vertices perpendicularly by %s mm', offset => {
    const a: [number, number] = [1000, 0]
    const b: [number, number] = [500, Math.sqrt(3) * 500]
    const result = computeStrutBoundary2D(a, b, [0, 0],
      20, 30, 150, 180, 50, 15, 20, 20, 5, 6, NO_STRUT_BRACES, false, undefined, 12.5, 3.25, offset)
    const endA = precalculateStrutEnd(20, 150, 15, 20, 6, 5, 20, 50, 12.5)
    const endB = precalculateStrutEnd(30, 180, 15, 20, 6, 5, 20, 50, 3.25)
    const ends = arcEndpoints(a, b, [0, 0], endA, endB)
    const dx = ends.extB[0] - ends.extA[0]
    const dy = ends.extB[1] - ends.extA[1]
    const length = Math.hypot(dx, dy)
    // For this fixture the outward unit normal is (dy, -dx) / length.
    for (const [end, radius] of [['A', a], ['B', b]] as const) {
      for (const [name, expectedDistance] of [[`shell vertex w/o offset ${end}`, 0], [`shell vertex ${end}`, offset]] as const) {
        const point = result.helpers.find(h => h.name === name)!.drawing.boundingBox.center
        expect(point[0] * radius[1] - point[1] * radius[0]).toBeCloseTo(0, 5)
        expect(((point[0] - ends.extA[0]) * dy - (point[1] - ends.extA[1]) * dx) / length)
          .toBeCloseTo(expectedDistance, 5)
      }
    }
    expect(area(result.main!)).toBeCloseTo(area(computeStrutBoundary2D(a, b, [0, 0],
      20, 30, 150, 180, 50, 15, 20, 20, 5, 6, NO_STRUT_BRACES, false, undefined, 12.5, 3.25).main!), 5)
  })

  it('extends only the outer bridge endpoints by independent fractional thicknesses', () => {
    const end = (added = 0) => precalculateStrutEnd(20, 150, 15, 20, 6, 5, 20, 50, added)
    const a: [number, number] = [1000, 0]
    const b: [number, number] = [500, Math.sqrt(3) * 500]
    const base = arcEndpoints(a, b, [0, 0], end(), end())
    const extended = arcEndpoints(a, b, [0, 0], end(12.5), end(3.25))
    expect(extended.innA).toEqual(base.innA)
    expect(extended.innB).toEqual(base.innB)
    expect(extended.extA[0] - base.extA[0]).toBeCloseTo(12.5)
    expect(extended.extA[1]).toBeCloseTo(base.extA[1])
    expect(extended.extB[0] - base.extB[0]).toBeCloseTo(3.25 * 0.5)
    expect(extended.extB[1] - base.extB[1]).toBeCloseTo(3.25 * Math.sqrt(3) / 2)
  })

  it.each([false, true])('builds thicker outer shoulders with roundBridge=%s', round => {
    const result = computeStrutBoundary2D([1000, 0], [500, Math.sqrt(3) * 500], [0, 0],
      20, 30, 150, 180, 50, 15, 20, 20, 5, 6, NO_STRUT_BRACES, round, undefined, 12.5, 3.25)
    expect(area(result.main!)).toBeGreaterThan(area(build(round).main!))
    const solid = result.main!.sketchOnPlane().extrude(10)
    try { expect(solid.mesh().triangles.length).toBeGreaterThan(0) } finally { solid.delete() }
  })

  it.each([-1, NaN, Infinity])('rejects invalid added thickness %s', added => {
    expect(() => precalculateStrutEnd(20, 150, 15, 20, 6, 5, 20, 50, added)).toThrow('nonnegative')
  })

  it('reports milling cut failures without dropping the strut', () => {
    const onCutError = vi.fn()
    vi.spyOn(Drawing.prototype, 'cut').mockImplementation(() => { throw new Error('cut broke') })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const result = computeStrutBoundary2D(
        [1000, 0], [500, Math.sqrt(3) * 500], [0, 0],
        20, 30, 150, 180, 50, 15, 20, 20, 5, 6,
        NO_STRUT_BRACES, true, onCutError,
      )
      expect(onCutError).toHaveBeenCalledTimes(12)
      expect(onCutError).toHaveBeenCalledWith('A mp1', expect.objectContaining({ message: 'cut broke' }))
      expect(area(result.main!)).toBeGreaterThan(0)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it.each([false, true])('preserves shape areas with roundBridge=%s', round => {
    for (const c of cases) {
      expect(area(build(round, c).main!), c.name).toBeCloseTo(c.areas[Number(round)], 5)
    }
  })

  it.each([false, true])('builds without fuses and still cuts milling relief with roundBridge=%s', round => {
    const fuse = vi.spyOn(Drawing.prototype, 'fuse').mockImplementation(() => {
      throw new Error('Positive strut construction must not fuse shapes')
    })
    const cut = vi.spyOn(Drawing.prototype, 'cut')
    const error = vi.spyOn(console, 'error')
    try {
      expect(area(build(round).main!)).toBeGreaterThan(0)
      expect(fuse).not.toHaveBeenCalled()
      expect(cut).toHaveBeenCalledTimes(12)
      expect(error).not.toHaveBeenCalled()
    } finally {
      vi.restoreAllMocks()
    }
  })

  it.each([false, true])('handles disabled grooves with roundBridge=%s', round => {
    const plain = build(round, { ...cases[3], groove: 0 }).main!
    expect(area(plain)).toBeGreaterThan(area(build(round, cases[3]).main!))
    const solid = plain.sketchOnPlane().extrude(10)
    try {
      expect(solid.mesh().triangles.length).toBeGreaterThan(0)
    } finally {
      solid.delete()
    }
  })

  it.each([false, true])('cuts brace corner holes with roundBridge=%s', round => {
    const attachment = { distanceFromVertex: 400, otherEdgeId: 3, otherEdgeDirection: [0, 0, 1] as [number, number, number] }
    const braces: StrutBraces = {
      a: [{ ...attachment, braceId: 1, params: { ...DEFAULT_BRACE_PARAMS, shift: 0.4 } }],
      b: [{ ...attachment, braceId: 2, params: { ...DEFAULT_BRACE_PARAMS, shift: 0.4 } }],
    }
    const withHoles = build(round, cases[0], braces)
    expect(withHoles.bracePlateA).not.toBeNull()
    expect(withHoles.bracePlateB).not.toBeNull()
    expect(withHoles.braceMarks).toHaveLength(2)
    const removed = area(build(round).main!) - area(withHoles.main!)
    expect(removed).toBeCloseTo(8 * Math.PI * (DEFAULT_BRACE_PARAMS.plateHoleDiameter / 2) ** 2, 5)
  })
})
