import { beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import createNesting from '../vendor/libnest2d/nesting.js'
import { nestDxfParts, type NestingEngine } from './dxfNesting'
import type { DxfPart } from './dxf'
import { DEFAULT_DXF_SHEET_SETTINGS } from './dxfSheetSettings'

let engine: NestingEngine
beforeAll(async () => {
  engine = await createNesting({ wasmBinary: await readFile(new URL('../vendor/libnest2d/nesting.wasm', import.meta.url)) })
})

const rectangle = (name: string, width: number, height: number): DxfPart => ({ name, kind: 'strut', loops: [{ closed: true,
  vertices: [[0, 0], [width, 0], [width, height], [0, height]].map(([x, y]) => ({ x, y, bulge: 0 })) }] })
const settings = { ...DEFAULT_DXF_SHEET_SETTINGS, arrangeOnSheet: true, width: 110, height: 110, margin: 10, spacing: 5 }

describe('compiled libnest2d', () => {
  it('fills a sheet and opens another, preserving all five parts and clearances', () => {
    const parts = Array.from({ length: 5 }, (_, i) => rectangle(String(i), 40, 40))
    const progress: number[] = []
    const result = nestDxfParts(parts, { scale: 1 }, settings, engine, (done) => progress.push(done))
    expect(result.parts).toHaveLength(5)
    expect(result.sheets).toHaveLength(2)
    expect(progress.at(-1)).toBe(5)
  })

  it('rotates a part that can only fit after a quarter turn', () => {
    const result = nestDxfParts([rectangle('rotated', 80, 30)], { scale: 1 }, { ...settings, width: 50 }, engine)
    const vertices = result.parts[0].loops[0].vertices
    expect(Math.max(...vertices.map((p) => p.x)) - Math.min(...vertices.map((p) => p.x))).toBeCloseTo(30)
    expect(result.sheets).toHaveLength(1)
  })

  it('accepts an exact-fit rectangle even with nonzero spacing', () => {
    const result = nestDxfParts([rectangle('exact', 90, 90)], { scale: 1 }, settings, engine)
    expect(result.parts[0].loops[0].vertices[0].x).toBeCloseTo(10)
    expect(result.parts[0].loops[0].vertices[0].y).toBeCloseTo(10)
  })

  it('packs curved and concave parts using conservative envelopes', () => {
    const circle: DxfPart = { name: 'circle', kind: 'flange', loops: [{ closed: true,
      vertices: [{ x: -10, y: 0, bulge: 1 }, { x: 10, y: 0, bulge: 1 }] }] }
    const concave: DxfPart = { name: 'concave', kind: 'strut', loops: [{ closed: true,
      vertices: [[0, 0], [40, 0], [40, 5], [10, 5], [10, 15], [40, 15], [40, 20], [0, 20]].map(([x, y]) => ({ x, y, bulge: 0 })) }] }
    const result = nestDxfParts([circle, concave, rectangle('rect', 20, 30)], { scale: 1 }, settings, engine)
    expect(result.parts).toHaveLength(3)
    expect(result.sheets).toHaveLength(1)
    expect(result.parts[0].loops[0].vertices[0].bulge).toBe(1)
  })
})
