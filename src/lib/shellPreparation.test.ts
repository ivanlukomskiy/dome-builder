/// <reference types="node" />
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { setOC } from 'replicad'
import initOpenCascade from 'replicad-opencascadejs'
import * as THREE from 'three'
import { applyVertexTransforms, computePolyhedron, pruneToLayerCount } from './polyhedra'
import { computePreviewBuildInputs, type PreviewBuildInputParams } from './previewBuildInputs'
import { prepareShellStruts } from './shellPreparation'
import { computeStrutBoundary, computeStrutPlane } from './strutGeometry'
import { DEFAULT_FOOT_PARAMS } from './flangeGeometry'

beforeAll(async () => {
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm'))
  setOC(await initOpenCascade({ wasmBinary }))
}, 30_000)

function fixture(): PreviewBuildInputParams {
  const data = pruneToLayerCount(computePolyhedron('octahedron', 'vertex', 2, 5000), 3)
  const positions = new Map(applyVertexTransforms(data.vertices, new Map()))
  const first = data.edges.values().next().value!
  positions.get(first[0])!.multiplyScalar(1.025)
  return {
    data, transformedVertices: positions, edgeThickness: new Map([[data.edges.keys().next().value!, 45]]),
    thickness: 30, extrudeDistance: 125, cornerLength: 200, vertexCornerLength: new Map([[first[0], 240]]),
    vertexFlangeParams: new Map(), footVertices: new Set(), footParams: DEFAULT_FOOT_PARAMS,
    offsetModifier: 0, endGrooveLengthPercent: 15, midGrooveLengthPercent: 15,
    grooveDepth: 30, millingDiameter: 5, chamferLength: 6, roundStrutBridge: false, shellEnabled: true,
  }
}

describe('uniform shell preparation', () => {
  it.each([false, true])('constructs shell vertices from actual strut ends (flexible=%s)', shellFlexible => {
    const params = { ...fixture(), shellFlexible }
    const { strutEntries } = computePreviewBuildInputs(params)
    const { scale, shellVertices } = prepareShellStruts(strutEntries, params)
    expect(scale).toBeGreaterThan(0)
    expect(Math.min(...strutEntries.flatMap(e => [e.addedThicknessA!, e.addedThicknessB!]))).toBeCloseTo(0, 7)
    const observed = new Map<number, THREE.Vector3[]>()
    for (const entry of strutEntries) {
      expect(entry.addedThicknessA).toBeGreaterThanOrEqual(0)
      expect(entry.addedThicknessB).toBeGreaterThanOrEqual(0)
      const a = new THREE.Vector3(...entry.posA), b = new THREE.Vector3(...entry.posB)
      const result = computeStrutBoundary(a, b, new THREE.Vector3(), entry.offsetA, entry.offsetB,
        entry.cornerLengthA, entry.cornerLengthB, params.extrudeDistance / 2,
        params.endGrooveLengthPercent, params.midGrooveLengthPercent, params.grooveDepth,
        params.millingDiameter, params.chamferLength, entry.braces, false, undefined,
        entry.addedThicknessA, entry.addedThicknessB, entry.shellEdgeOffset)
      const solid = result.main!.sketchOnPlane().extrude(entry.beamThickness)
      try { expect(solid.mesh().triangles.length).toBeGreaterThan(0) } finally { solid.delete() }
      const plane = computeStrutPlane(a, b, new THREE.Vector3())
      const y = plane.normal.clone().cross(plane.xDir).normalize()
      for (const [end, id] of [['A', entry.vertexA], ['B', entry.vertexB]] as const) {
        const local = result.helpers.find(h => h.name === `shell vertex ${end}`)!.drawing.boundingBox.center
        const point = plane.origin.clone().addScaledVector(plane.xDir, local[0]).addScaledVector(y, local[1])
        if (!shellFlexible) expect(point.distanceTo(shellVertices.get(id)!)).toBeLessThan(1e-5)
        observed.set(id, [...(observed.get(id) ?? []), point])
      }
    }
    for (const [id, points] of observed) {
      const mean = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(points.length)
      expect(mean.distanceTo(shellVertices.get(id)!)).toBeLessThan(1e-5)
    }
    if (shellFlexible) expect(strutEntries.every(e => e.addedThicknessA === 0 && e.addedThicknessB === 0)).toBe(true)
  })

  it('creates flexible shell vertices with round strut bridges and zero added thickness', () => {
    const params = { ...fixture(), shellFlexible: true }
    const straight = computePreviewBuildInputs(params)
    const round = computePreviewBuildInputs({ ...params, roundStrutBridge: true })
    expect(round.shellVertices.size).toBeGreaterThan(0)
    for (const [id, point] of round.shellVertices) {
      expect(point.distanceTo(straight.shellVertices.get(id)!)).toBeLessThan(1e-5)
    }
    expect(round.strutEntries.every(e => e.addedThicknessA === 0 && e.addedThicknessB === 0)).toBe(true)
  })

  it.each([{ shellEnabled: false, roundStrutBridge: false }, { shellEnabled: true, roundStrutBridge: true }])
  ('leaves struts unchanged when shell generation is inactive: %j', flags => {
    const params = { ...fixture(), ...flags }
    for (const entry of computePreviewBuildInputs(params).strutEntries) {
      expect(entry.addedThicknessA).toBeUndefined()
      expect(entry.addedThicknessB).toBeUndefined()
      expect(entry.shellEdgeOffset).toBeUndefined()
    }
  })

  it('preserves the solution when strut endpoint order is reversed', () => {
    const params = fixture()
    const { strutEntries } = computePreviewBuildInputs(params)
    const reversed = strutEntries.map(e => ({ ...e,
      vertexA: e.vertexB, vertexB: e.vertexA, posA: e.posB, posB: e.posA,
      offsetA: e.offsetB, offsetB: e.offsetA, cornerLengthA: e.cornerLengthB, cornerLengthB: e.cornerLengthA,
    }))
    prepareShellStruts(reversed, params)
    reversed.forEach((entry, i) => {
      expect(entry.addedThicknessA).toBeCloseTo(strutEntries[i].addedThicknessB!, 7)
      expect(entry.addedThicknessB).toBeCloseTo(strutEntries[i].addedThicknessA!, 7)
      expect(entry.shellEdgeOffset).toBeCloseTo(strutEntries[i].shellEdgeOffset!, 7)
    })
  })

  it('reports degenerate edges before constructing struts', () => {
    const params = fixture()
    const [a, b] = params.data.edges.values().next().value!
    const positions = new Map(params.transformedVertices)
    positions.set(b, positions.get(a)!.clone())
    expect(() => computePreviewBuildInputs({ ...params, transformedVertices: positions })).toThrow('Shell edge')
  })
})
