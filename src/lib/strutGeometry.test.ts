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
