/// <reference types="node" />
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { beforeAll, expect, it } from 'vitest'
import { importSTEP, makeBox, measureVolume, setOC, type AnyShape } from 'replicad'
import initOpenCascade from 'replicad-opencascadejs'
import { buildStepAssembly, deserializeStepAssemblyParts } from './replicadCad'

beforeAll(async () => {
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm'))
  setOC(await initOpenCascade({ wasmBinary }))
}, 30_000)

function bounds(shape: AnyShape) {
  const box = shape.boundingBox
  try { return box.bounds } finally { box.delete() }
}

it('writes Y-up assembly solids as Z-up without changing the source solids', async () => {
  const shapes = [
    { name: 'lower', color: '#00ff00', shape: makeBox([10, 100, 30], [20, 120, 40]) },
    { name: 'upper', color: '#0000ff', shape: makeBox([30, 200, 60], [50, 210, 80]) },
  ]
  const originalBounds = shapes.map(({ shape }) => bounds(shape))
  try {
    // Repeated exports must apply the rotation exactly once each time.
    for (let i = 0; i < 2; i++) {
      // BREP serialization itself has no color: the worker message carries it.
      const restored = deserializeStepAssemblyParts(shapes.map(({ name, shape, color }) => ({
        name, color, brep: shape.serialize(),
      })))
      let blob: Blob
      try {
        expect(restored.map(part => part.color)).toEqual(['#00ff00', '#0000ff'])
        blob = buildStepAssembly(restored)
      } finally { restored.forEach(({ shape }) => shape.delete()) }
      const text = await blob.text()
      expect(text).toContain('lower')
      expect(text).toContain('upper')
      // OpenCascade emits named STEP colors for exact primaries.
      expect(text).toContain("DRAUGHTING_PRE_DEFINED_COLOUR('green')")
      expect(text).toContain("DRAUGHTING_PRE_DEFINED_COLOUR('blue')")
      const imported = (await importSTEP(blob)).asShape3D()
      try {
        const [min, max] = bounds(imported)
        const expectedMin = [10, -80, 100], expectedMax = [50, -30, 210]
        min.forEach((value, axis) => expect(value).toBeCloseTo(expectedMin[axis], 5))
        max.forEach((value, axis) => expect(value).toBeCloseTo(expectedMax[axis], 5))
        expect(measureVolume(imported)).toBeCloseTo(6000)
      } finally { imported.delete() }
      expect(shapes.map(({ shape }) => bounds(shape))).toEqual(originalBounds)
    }
  } finally { shapes.forEach(({ shape }) => shape.delete()) }
})
