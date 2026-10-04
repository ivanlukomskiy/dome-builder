/// <reference types="node" />
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { drawRectangle, loadFont, measureVolume, setOC, type Shape3D } from 'replicad'
import initOpenCascade from 'replicad-opencascadejs'
import { buildFlatStepPart, ENGRAVING_FONT } from './stepPartSolid'

beforeAll(async () => {
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm'))
  setOC(await initOpenCascade({ wasmBinary }))
  const font = readFileSync(new URL('../assets/fonts/LiberationSans-Bold.ttf', import.meta.url))
  await loadFont(font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength), ENGRAVING_FONT)
}, 30_000)

function bounds(shape: Shape3D) {
  const box = shape.boundingBox
  try { return box.bounds } finally { box.delete() }
}

const labels = { name: '808', labelAnchor: { x: 100, y: -50 }, labelAngleDeg: 25 }
const drawing = () => drawRectangle(100, 60).translate(100, -50)

describe('STEP parts solids', () => {
  it('centers local outlines on XY with their bottom at Z = 0', () => {
    const solid = buildFlatStepPart(drawing(), 5, 2)
    try {
      const [min, max] = bounds(solid)
      expect(min[0]).toBeCloseTo(-100)
      expect(max[0]).toBeCloseTo(100)
      expect(min[1]).toBeCloseTo(-60)
      expect(max[1]).toBeCloseTo(60)
      expect(min[2]).toBeCloseTo(0)
      expect(max[2]).toBeCloseTo(10)
      expect(measureVolume(solid)).toBeCloseTo(240000)
    } finally { solid.delete() }
  })

  it('cuts bold glyphs with counters into the top face at the requested depth', async () => {
    const solid = buildFlatStepPart(drawing(), 5, 1, { labels, depth: 1, partIdLabelSize: 8 })
    try {
      expect(measureVolume(solid)).toBeLessThan(30000)
      expect(measureVolume(solid)).toBeGreaterThan(29000)
      const vertices = solid.mesh().vertices
      const zs = vertices.filter((_, i) => i % 3 === 2)
      expect(zs.some(z => Math.abs(z - 4) < 1e-6)).toBe(true)
      expect(Math.min(...zs)).toBeCloseTo(0)
      expect(Math.max(...zs)).toBeCloseTo(5)
      expect(await solid.blobSTEP().text()).toContain('MANIFOLD_SOLID_BREP')
    } finally { solid.delete() }
  })

  it('keeps depth in exported mm while scaling glyphs with the part', () => {
    const cuts = [1, 2].map(scale => {
      const solid = buildFlatStepPart(drawing(), 5, scale, { labels, depth: 1, partIdLabelSize: 8 })
      try { return 30000 * scale ** 3 - measureVolume(solid) } finally { solid.delete() }
    })
    expect(cuts[1] / cuts[0]).toBeCloseTo(4, 3)
  })

  it('engraves connection IDs as well as the part ID', () => {
    const main = buildFlatStepPart(drawing(), 5, 1, { labels, depth: 1, partIdLabelSize: 8 })
    const connected = buildFlatStepPart(drawing(), 5, 1, {
      labels: { ...labels, helpers: [{ text: '123', x: 70, y: -50, angleDeg: 90, height: 5 }] },
      depth: 1, partIdLabelSize: 8,
    })
    try { expect(measureVolume(connected)).toBeLessThan(measureVolume(main)) }
    finally { main.delete(); connected.delete() }
  })

  it.each([0, -1, NaN, Infinity, 2.5, 3])('rejects invalid or through-cut depth %s before building', depth => {
    expect(() => buildFlatStepPart(drawing(), 5, 0.5, { labels, depth, partIdLabelSize: 8 })).toThrow(/depth/i)
  })
})
