import { describe, expect, it } from 'vitest'
import type { EdgeInfo, VertexEdgesInfo } from './edgesInfo'
import {
  computeFlangeSignature,
  flangeFrame,
  flangeMeshCache,
  groupFlanges,
  placeMesh,
  type MeshData,
} from './flangeInstances'

const STRUT_END = {
  offset: 20,
  cornerLength: 200,
  tenonStart: 30,
  tenonEnd: 120,
  chamferLength: 5,
  millingDiameter: 6,
  effectiveCornerLength: 210,
  halfWidth: 62.5,
  grooveDepth: 3,
  connectionHalfWidth: 40,
}

function edge(id: number, thicknessMm: number, projectedAngleDeg: number, angleToNextEdgeDeg: number): EdgeInfo {
  return {
    edgeId: id,
    neighborId: 100 + id,
    neighborPosition: [id, 0, 0],
    thicknessMm,
    offsetMm: 20,
    strutEnd: { ...STRUT_END },
    projectedAngleDeg,
    angleToNextEdgeDeg,
    hasFaceToNextEdge: true,
    faceIdToNextEdge: id,
  }
}

function vertex(id: number, edges: EdgeInfo[]): VertexEdgesInfo {
  return {
    vertexId: id,
    position: [0, 0, 0],
    tangentPlane: { origin: [0, 0, 0], normal: [0, 0, 1], e1: [1, 0, 0], e2: [0, 1, 0] },
    edges,
  }
}

// Three struts (thicknesses 5, 6, 7) at 10/130/250 degrees.
const base = vertex(1, [edge(1, 5, 10, 120), edge(2, 6, 130, 120), edge(3, 7, 250, 120)])

describe('computeFlangeSignature', () => {
  it('is the same for a hub turned about its normal, whatever edge the list starts at', () => {
    // Same hub, turned by 40 degrees, list starting at the second edge, other ids.
    const turned = vertex(9, [edge(12, 6, 170, 120), edge(13, 7, 290, 120), edge(11, 5, 50, 120)])
    const a = computeFlangeSignature(base, 'ctx')
    const b = computeFlangeSignature(turned, 'ctx')
    expect(b.key).toBe(a.key)
    // The canonical start is the same physical strut in both: 10 deg in one, 50 in the other.
    expect(b.startAngleDeg - a.startAngleDeg).toBeCloseTo(40, 9)
  })

  it('differs when a strut differs', () => {
    const thicker = vertex(2, [edge(1, 5, 10, 120), edge(2, 6, 130, 120), edge(3, 8, 250, 120)])
    expect(computeFlangeSignature(thicker, 'ctx').key).not.toBe(computeFlangeSignature(base, 'ctx').key)
  })

  it('differs when the angles differ, or the shared context does', () => {
    const skewed = vertex(3, [edge(1, 5, 10, 130), edge(2, 6, 140, 110), edge(3, 7, 250, 120)])
    expect(computeFlangeSignature(skewed, 'ctx').key).not.toBe(computeFlangeSignature(base, 'ctx').key)
    expect(computeFlangeSignature(base, 'other').key).not.toBe(computeFlangeSignature(base, 'ctx').key)
  })

  it('includes the foot: same when turned with the hub, different when it points elsewhere or is shaped differently', () => {
    const foot = {
      length: 50,
      thickness: 10,
      grooveLength: 20,
      holeOffset: 20,
      tipOffset: 20,
      holeDiameter: 8,
      straightLength: 40,
      chamferLength: 4,
    }
    const withFoot = (v: VertexEdgesInfo, projectedAngleDeg: number, shape = foot): VertexEdgesInfo => ({
      ...v,
      foot: { ...shape, projectedAngleDeg },
    })
    const turned = vertex(9, [edge(12, 6, 170, 120), edge(13, 7, 290, 120), edge(11, 5, 50, 120)])

    const a = computeFlangeSignature(withFoot(base, 70), 'ctx')
    const b = computeFlangeSignature(withFoot(turned, 110), 'ctx')
    expect(b.key).toBe(a.key)
    expect(b.startAngleDeg - a.startAngleDeg).toBeCloseTo(40, 9)

    expect(computeFlangeSignature(withFoot(base, 71), 'ctx').key).not.toBe(a.key)
    expect(computeFlangeSignature(withFoot(base, 70, { ...foot, tipOffset: 21 }), 'ctx').key).not.toBe(a.key)
    expect(computeFlangeSignature(base, 'ctx').key).not.toBe(a.key)
  })

  it('differs for a mirrored hub', () => {
    // Same thicknesses in the opposite winding order.
    const mirrored = vertex(4, [edge(1, 7, 10, 120), edge(2, 6, 130, 120), edge(3, 5, 250, 120)])
    expect(computeFlangeSignature(mirrored, 'ctx').key).not.toBe(computeFlangeSignature(base, 'ctx').key)
  })
})

describe('groupFlanges', () => {
  it('puts rotated copies in one group, with the first vertex as representative', () => {
    const turned = vertex(9, [edge(12, 6, 170, 120), edge(13, 7, 290, 120), edge(11, 5, 50, 120)])
    const other = vertex(5, [edge(1, 5, 10, 130), edge(2, 6, 140, 110), edge(3, 7, 250, 120)])
    const groups = groupFlanges([base, turned, other], 'ctx')
    expect(groups).toHaveLength(2)
    expect(groups[0].representative.vertex.vertexId).toBe(1)
    expect(groups[0].members.map((m) => m.vertex.vertexId)).toEqual([1, 9])
    expect(groups[1].members.map((m) => m.vertex.vertexId)).toEqual([5])
  })
})

describe('placing a local flange mesh', () => {
  const mesh: MeshData = {
    positions: new Float32Array([1, 0, 0, 0, 2, 0, 0, 0, 3]),
    normals: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
  }

  it('leaves it alone for the identity frame', () => {
    const placed = placeMesh(mesh, flangeFrame(base, 0, 0))
    expect(Array.from(placed.positions)).toEqual([1, 0, 0, 0, 2, 0, 0, 0, 3])
    expect(Array.from(placed.normals)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
  })

  it('turns counter-clockwise about the normal and pushes along it', () => {
    const placed = placeMesh(mesh, flangeFrame(base, 90, 5))
    const expected = [0, 1, 5, -2, 0, 5, 0, 0, 8]
    placed.positions.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 5))
    const expectedNormals = [0, 1, 0, -1, 0, 0, 0, 0, 1]
    placed.normals.forEach((v, i) => expect(v).toBeCloseTo(expectedNormals[i], 5))
  })

  it('follows the vertex tangent frame, and copies the buffers', () => {
    // A vertex on the +x axis: normal +x, e1 = +y (so normal x e1 = +z).
    const v: VertexEdgesInfo = {
      ...base,
      tangentPlane: { origin: [10, 0, 0], normal: [1, 0, 0], e1: [0, 1, 0], e2: [0, 0, 1] },
    }
    const placed = placeMesh(mesh, flangeFrame(v, 0, 2))
    // local x -> +y, local y -> +z, local z -> +x, origin (12, 0, 0)
    const expected = [12, 1, 0, 12, 0, 2, 15, 0, 0]
    placed.positions.forEach((val, i) => expect(val).toBeCloseTo(expected[i], 5))
    expect(placed.indices).not.toBe(mesh.indices)
    expect(Array.from(placed.indices)).toEqual([0, 1, 2])
  })
})

describe('flangeMeshCache', () => {
  it('returns what was stored, and evicts the least recently used entries', () => {
    flangeMeshCache.clear()
    const entry = { mesh: { positions: new Float32Array(3), normals: new Float32Array(3), indices: new Uint32Array(3) }, startAngleDeg: 12 }
    flangeMeshCache.set('first', entry)
    expect(flangeMeshCache.get('first')).toBe(entry)
    for (let i = 0; i < 64; i++) flangeMeshCache.set(`k${i}`, entry)
    expect(flangeMeshCache.get('first')).toBeUndefined()
    expect(flangeMeshCache.get('k63')).toBe(entry)
    flangeMeshCache.clear()
  })
})
