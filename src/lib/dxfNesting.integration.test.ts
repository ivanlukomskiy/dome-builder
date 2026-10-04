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

const rectangle = (name: string, width: number, height: number): DxfPart => ({ name, kind: 'strut', thickness: 10, loops: [{ closed: true,
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

  it('never shares a sheet between thicknesses, even when the parts would fit together', () => {
    const parts = [3, 6, 3, 6].map((thickness, i) => ({ ...rectangle(String(i), 20, 20), thickness }))
    const result = nestDxfParts(parts, { scale: 1 }, settings, engine)
    expect(result.sheets.map((sheet) => sheet.thickness)).toEqual([3, 6])
    const sheetOf = (i: number) => result.sheets.findIndex((sheet) => result.parts[i].loops[0].vertices[0].x < sheet.x + sheet.width)
    expect([0, 1, 2, 3].map(sheetOf)).toEqual([0, 1, 0, 1])
  })

  it('rotates a part that can only fit after a quarter turn', () => {
    const result = nestDxfParts([rectangle('rotated', 80, 30)], { scale: 1 }, { ...settings, width: 50 }, engine)
    const vertices = result.parts[0].loops[0].vertices
    expect(Math.max(...vertices.map((p) => p.x)) - Math.min(...vertices.map((p) => p.x))).toBeCloseTo(30)
    expect(result.sheets).toHaveLength(1)
  })

  it('leaves every part unturned when rotation is off', () => {
    const still = { ...settings, rotationStep: 0 as const }
    // The quarter turn that would make this one fit is no longer on offer.
    expect(() => nestDxfParts([rectangle('long', 80, 30)], { scale: 1 }, { ...still, width: 50 }, engine)).toThrow(/long.*usable sheet/)
    const result = nestDxfParts([rectangle('a', 60, 20), rectangle('b', 60, 20), rectangle('c', 20, 60)], { scale: 1 }, still, engine)
    for (const [i, [w, h]] of [[60, 20], [60, 20], [20, 60]].entries()) {
      const vertices = result.parts[i].loops[0].vertices
      expect(Math.max(...vertices.map((p) => p.x)) - Math.min(...vertices.map((p) => p.x))).toBeCloseTo(w)
      expect(Math.max(...vertices.map((p) => p.y)) - Math.min(...vertices.map((p) => p.y))).toBeCloseTo(h)
    }
  })

  it.each([60, 30, 10] as const)('packs with a %i degree step, turning parts only by its multiples', (rotationStep) => {
    const triangle = (name: string): DxfPart => ({ name, kind: 'flange', thickness: 10, loops: [{ closed: true,
      vertices: [[0, 0], [45, 0], [0, 30]].map(([x, y]) => ({ x, y, bulge: 0 })) }] })
    const parts = [...Array.from({ length: 4 }, (_, i) => triangle(`t${i}`)), rectangle('r1', 50, 12), rectangle('r2', 50, 12)]
    // nestDxfParts itself rejects overlaps, spacing violations and angles off the step.
    const result = nestDxfParts(parts, { scale: 1 }, { ...settings, rotationStep }, engine)
    expect(result.parts).toHaveLength(parts.length)
    for (const [i, placed] of result.parts.entries()) {
      const [a, b] = placed.loops[0].vertices, [a0, b0] = parts[i].loops[0].vertices
      const turn = (Math.atan2(b.y - a.y, b.x - a.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x)) * 180 / Math.PI
      expect(Math.abs(turn / rotationStep - Math.round(turn / rotationStep))).toBeLessThan(1e-6)
    }
  })

  it('accepts an exact-fit rectangle even with nonzero spacing', () => {
    const result = nestDxfParts([rectangle('exact', 90, 90)], { scale: 1 }, settings, engine)
    expect(result.parts[0].loops[0].vertices[0].x).toBeCloseTo(10)
    expect(result.parts[0].loops[0].vertices[0].y).toBeCloseTo(10)
  })

  it('packs curved and concave parts using conservative envelopes', () => {
    const circle: DxfPart = { name: 'circle', kind: 'flange', thickness: 10, loops: [{ closed: true,
      vertices: [{ x: -10, y: 0, bulge: 1 }, { x: 10, y: 0, bulge: 1 }] }] }
    const concave: DxfPart = { name: 'concave', kind: 'strut', thickness: 10, loops: [{ closed: true,
      vertices: [[0, 0], [40, 0], [40, 5], [10, 5], [10, 15], [40, 15], [40, 20], [0, 20]].map(([x, y]) => ({ x, y, bulge: 0 })) }] }
    const result = nestDxfParts([circle, concave, rectangle('rect', 20, 30)], { scale: 1 }, settings, engine)
    expect(result.parts).toHaveLength(3)
    expect(result.sheets).toHaveLength(1)
    expect(result.parts[0].loops[0].vertices[0].bulge).toBe(1)
  })
})
