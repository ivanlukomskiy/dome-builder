/// <reference types="node" />
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { measureArea, setOC, type Face } from 'replicad'
import initOpenCascade from 'replicad-opencascadejs'
import * as THREE from 'three'
import { computeStrutBoundary, type StrutBoundaryInput } from './strutGeometry'
import { DEFAULT_BRACE_PARAMS, type StrutBraces } from './braces'
import { drawingToPolylines } from './dxfExport'
import { resolveBracePlacements, type BracePlacementParams } from './bracePlacement'
import type { StrutGeometryEntry } from './previewBuildInputs'
import { bracePlateEndPoints3D } from './braces'
import { braceQuadFrame } from './braceSolid'
import { computeStrutPlane } from './strutGeometry'
import { tagHoleLoops } from './dxf'

beforeAll(async () => {
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm'))
  setOC(await initOpenCascade({ wasmBinary }))
}, 30_000)

// Exact failure dump from a flat-bridge strut. Its bridge and end A share a cap edge,
// which used to make the 2D fuse throw "Failed to split the curve".
const FAILURE_INPUT: StrutBoundaryInput = {
  a: [5.649666679324799e-13, 2236.067977499789, 1118.0339887498947],
  b: [-1443.375672974064, 1443.3756729740646, 1443.3756729740642],
  center: [0, 0, 0],
  offsetA: 23.139880657654352,
  offsetB: 25.980762113533167,
  cornerLengthA: 200,
  cornerLengthB: 200,
  halfWidth: 62.5,
  endGrooveLengthPercent: 15,
  midGrooveLengthPercent: 15,
  grooveDepth: 30,
  millingDiameter: 5,
  chamferLength: 6,
  braces: { a: [], b: [] },
  roundBridge: false,
}

function boundary(roundBridge: boolean, braces: StrutBraces = FAILURE_INPUT.braces) {
  const input = { ...FAILURE_INPUT, braces }
  return computeStrutBoundary(
    new THREE.Vector3(...input.a), new THREE.Vector3(...input.b), new THREE.Vector3(...input.center),
    input.offsetA, input.offsetB, input.cornerLengthA, input.cornerLengthB,
    input.halfWidth, input.endGrooveLengthPercent, input.midGrooveLengthPercent,
    input.grooveDepth, input.millingDiameter, input.chamferLength, input.braces, roundBridge,
  )
}

function areaOfMain(roundBridge: boolean): number {
  const main = boundary(roundBridge).main
  expect(main).not.toBeNull()
  const sketched = main!.sketchOnPlane()
  const shape = 'face' in sketched ? sketched.face() : sketched.faces()
  const area = measureArea(shape as Face)
  shape.delete()
  return area
}

describe('computeStrutBoundary', () => {
  it.each([false, true])('builds a valid %s bridge for the reported strut', (roundBridge) => {
    expect(areaOfMain(roundBridge)).toBeGreaterThan(0)
  })

  it.each([false, true])('tells the brace bolt holes of a %s bridge strut and its plate apart by kind', (roundBridge) => {
    const result = boundary(roundBridge, {
      a: [{ braceId: 1, params: { ...DEFAULT_BRACE_PARAMS, shift: 0.4 }, distanceFromVertex: 0, otherEdgeId: 2, otherEdgeDirection: [1, 0, 0] }],
      b: [],
    })
    const kinds = (loops: ReturnType<typeof tagHoleLoops>) => loops.map((loop) => loop.hole ?? 'outline').sort()

    // The plate's four corner holes go through the strut too; its two center holes do not.
    expect(kinds(tagHoleLoops(drawingToPolylines(result.main!), result.holes)))
      .toEqual(['outline', 'strut-brace', 'strut-brace', 'strut-brace', 'strut-brace'])
    expect(kinds(tagHoleLoops(drawingToPolylines(result.bracePlateA!), result.bracePlateHolesA))).toEqual([
      'brace-plate-center', 'brace-plate-center',
      'brace-plate-corner', 'brace-plate-corner', 'brace-plate-corner', 'brace-plate-corner',
      'outline',
    ])
    expect(result.bracePlateB).toBeNull()
    expect(result.bracePlateHolesB).toEqual([])
  })
})


describe('flange-parallel brace placement', () => {
  function fixture(roundStrutBridge: boolean, reverse: boolean) {
    const params: BracePlacementParams = {
      endGrooveLengthPercent: 15, midGrooveLengthPercent: 15,
      chamferLength: 6, millingDiameter: 5, grooveDepth: 30,
      extrudeDistance: 125, roundStrutBridge,
    }
    const rotate = (p: [number, number, number]) => new THREE.Vector3(...p)
      .applyAxisAngle(new THREE.Vector3(1, 2, 3).normalize(), 0.7).toArray()
    const hub = rotate([0, 0, 2500])
    const neighbors: [number, number, number][] = [
      rotate([2500 * Math.sin(0.5), 0, 2500 * Math.cos(0.5)]),
      rotate([0, 2530 * Math.sin(0.75), 2530 * Math.cos(0.75)]),
    ]
    const entries: StrutGeometryEntry[] = neighbors.map((neighbor, index) => {
      const flipped = reverse && index === 1
      const brace = {
        braceId: 1, params: { ...DEFAULT_BRACE_PARAMS, shift: 0.4 },
        distanceFromVertex: 0, otherEdgeId: 1 - index,
        otherEdgeDirection: new THREE.Vector3(...neighbors[1 - index]).sub(new THREE.Vector3(...hub)).normalize().toArray(),
      }
      return {
        index, vertexA: flipped ? index + 1 : 0, vertexB: flipped ? 0 : index + 1,
        posA: flipped ? neighbor : hub, posB: flipped ? hub : neighbor,
        offsetA: 25, offsetB: 30, cornerLengthA: flipped ? 260 : 200,
        cornerLengthB: flipped ? 200 : 260, beamThickness: 18 + index * 5,
        thicknessOverride: undefined, braces: flipped ? { a: [], b: [brace] } : { a: [brace], b: [] },
      }
    })
    return { params, entries }
  }

  it.each([false, true].flatMap((round) => [false, true].map((reverse) => [round, reverse])))
  ('aligns the brace and plate edges with the flange (rounded=%s, reversed=%s)', (round, reverse) => {
    const { params, entries } = fixture(round, reverse)
    resolveBracePlacements(entries, params)
    const normal = new THREE.Vector3(...entries[0].posA).normalize()
    const ends = entries.map((entry) => {
      const isA = entry.vertexA === 0
      const brace = (isA ? entry.braces.a : entry.braces.b)[0]
      expect(brace.placement).toBeTruthy()
      const a = new THREE.Vector3(...entry.posA), b = new THREE.Vector3(...entry.posB)
      const result = computeStrutBoundary(a, b, new THREE.Vector3(), entry.offsetA, entry.offsetB,
        entry.cornerLengthA, entry.cornerLengthB, params.extrudeDistance / 2,
        params.endGrooveLengthPercent, params.midGrooveLengthPercent, params.grooveDepth,
        params.millingDiameter, params.chamferLength, entry.braces, round)
      const localEnds = (isA ? result.bracePlateEndsA : result.bracePlateEndsB)!
      const plane = computeStrutPlane(a, b, new THREE.Vector3())
      const points = bracePlateEndPoints3D(plane, entry.beamThickness, brace, localEnds)
      expect(Math.abs(points[1].clone().sub(points[0]).normalize().dot(normal))).toBeLessThan(1e-10)
      const holes = isA ? result.bracePlateHolesA : result.bracePlateHolesB
      const corners = holes.filter((hole) => hole.kind === 'brace-plate-corner')
      expect(corners).toHaveLength(4)
      for (const hole of corners) expect(result.holes.some((h) =>
        h.kind === 'strut-brace' && Math.hypot(h.center[0] - hole.center[0], h.center[1] - hole.center[1]) < 1e-8)).toBe(true)
      const across = bracePlateEndPoints3D(plane, entry.beamThickness, brace, [corners[1].center, corners[2].center])
      expect(Math.abs(across[1].clone().sub(across[0]).normalize().dot(normal))).toBeCloseTo(1, 10)
      return points.map((p) => p.toArray()) as [[number, number, number], [number, number, number]]
    })
    const heights = ends.flat().map((p) => new THREE.Vector3(...p).dot(normal))
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1e-7)
    expect(Math.abs(braceQuadFrame(ends[0], ends[1])!.plane.normal.dot(normal))).toBeCloseTo(1, 10)
  })

  it('marks both ends unbuildable when no common plate placement fits', () => {
    const { params, entries } = fixture(true, false)
    entries[0].braces.a[0].params.width = 10000
    resolveBracePlacements(entries, params)
    expect(entries[0].braces.a[0].placement).toBeNull()
    expect(entries[1].braces.a[0].placement).toBeNull()
  })
})
