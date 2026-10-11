/// <reference types="node" />
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { setOC } from 'replicad'
import initOpenCascade from 'replicad-opencascadejs'
import { computeFootPartBoundary2D } from './footGeometry'
import config from './__fixtures__/foot-build-failure.json'

beforeAll(async () => {
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm'))
  setOC(await initOpenCascade({ wasmBinary }))
}, 30_000)

// Preview/export use halfWidth = extrudeDistance / 2, then pass halfWidth * 2.
describe('separate foot from reported config', () => {
  it('builds the reported foot boundary', () => {
    const result = computeFootPartBoundary2D(config.footParams, config.extrudeDistance, config.grooveDepth)
    expect(result.main).not.toBeNull()
    const solid = result.main!.sketchOnPlane('XY').extrude(config.footParams.thickness)
    try { expect(solid.mesh().triangles.length).toBeGreaterThan(0) }
    finally { solid.delete() }
  })

  it('builds with a chamfer below both clamping limits, retaining milling reliefs', () => {
    const result = computeFootPartBoundary2D(
      { ...config.footParams, chamferLength: 1 },
      config.extrudeDistance, config.grooveDepth,
    )
    const solid = result.main!.sketchOnPlane('XY').extrude(config.footParams.thickness)
    try { expect(solid.mesh().triangles.length).toBeGreaterThan(0) }
    finally { solid.delete() }
  })

  it.each([0, 2, 3, 4])('builds without negative shapes with chamfer %s', chamferLength => {
    const result = computeFootPartBoundary2D(
      { ...config.footParams, chamferLength, millingDiameter: 0, holeDiameter: 0 },
      config.extrudeDistance, config.grooveDepth,
    )
    const solid = result.main!.sketchOnPlane('XY').extrude(config.footParams.thickness)
    try { expect(solid.mesh().triangles.length).toBeGreaterThan(0) }
    finally { solid.delete() }
  })
})
