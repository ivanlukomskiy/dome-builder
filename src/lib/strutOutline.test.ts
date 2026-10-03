/// <reference types="node" />
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Drawing, measureArea, setOC, type Face } from 'replicad'
import initOpenCascade from 'replicad-opencascadejs'
import { computeStrutBoundary2D } from './strutGeometry'
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
    const braces: StrutBraces = {
      a: [{ braceId: 1, params: { ...DEFAULT_BRACE_PARAMS, shift: 0.4 } }],
      b: [{ braceId: 2, params: { ...DEFAULT_BRACE_PARAMS, shift: 0.4 } }],
    }
    const withHoles = build(round, cases[0], braces)
    expect(withHoles.bracePlateA).not.toBeNull()
    expect(withHoles.bracePlateB).not.toBeNull()
    expect(withHoles.braceMarks).toHaveLength(2)
    const removed = area(build(round).main!) - area(withHoles.main!)
    expect(removed).toBeCloseTo(8 * Math.PI * (DEFAULT_BRACE_PARAMS.plateHoleDiameter / 2) ** 2, 5)
  })
})
