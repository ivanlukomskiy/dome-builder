import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { braceQuadFrame, braceQuadPoints2D, buildBraceSolidMesh, buildBraceSolids, orderBraceQuad, pairBracePoints, type Vec3 } from './braceSolid'
import { bracePlateEndPoints3D, DEFAULT_BRACE_PARAMS, type StrutBraceEnd } from './braces'

function volume(mesh: { positions: Float32Array; indices: Uint32Array }): number {
  let v = 0
  const p = (i: number) => new THREE.Vector3(mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2])
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = p(mesh.indices[t])
    const b = p(mesh.indices[t + 1])
    const c = p(mesh.indices[t + 2])
    v += a.dot(new THREE.Vector3().crossVectors(b, c)) / 6
  }
  return v
}

describe('buildBraceSolidMesh', () => {
  // A 10 x 4 rectangle in the z = 0 plane.
  const a: [Vec3, Vec3] = [[0, 0, 0], [10, 0, 0]]
  const b: [Vec3, Vec3] = [[0, 4, 0], [10, 4, 0]]

  it('extrudes the quad symmetrically: volume = area * thickness, outward winding', () => {
    const mesh = buildBraceSolidMesh(a, b, 2)!
    expect(volume(mesh)).toBeCloseTo(10 * 4 * 2, 5)
    let minZ = Infinity
    let maxZ = -Infinity
    for (let i = 2; i < mesh.positions.length; i += 3) {
      minZ = Math.min(minZ, mesh.positions[i])
      maxZ = Math.max(maxZ, mesh.positions[i])
    }
    expect(minZ).toBeCloseTo(-1)
    expect(maxZ).toBeCloseTo(1)
  })

  it('does not care which way the second strut\'s points are listed', () => {
    const swapped = buildBraceSolidMesh(a, [b[1], b[0]], 2)!
    expect(volume(swapped)).toBeCloseTo(80, 5)
  })

  it('works with a non-axis-aligned plane and a slightly non-planar quad', () => {
    const tilt = (p: Vec3): Vec3 => {
      const v = new THREE.Vector3(...p).applyAxisAngle(new THREE.Vector3(1, 1, 0).normalize(), 0.7)
      return [v.x, v.y, v.z]
    }
    const mesh = buildBraceSolidMesh([tilt(a[0]), tilt(a[1])], [tilt(b[0]), tilt(b[1])], 2)!
    expect(volume(mesh)).toBeCloseTo(80, 4)
  })

  it('rejects non-positive thickness', () => {
    expect(buildBraceSolidMesh(a, b, 0)).toBeNull()
  })
})

describe('orderBraceQuad', () => {
  it('pairs nearer points', () => {
    const v = (x: number, y: number) => new THREE.Vector3(x, y, 0)
    const quad = orderBraceQuad([v(0, 0), v(10, 0)], [v(10, 4), v(0, 4)])
    expect(quad[2].x).toBe(10)
    expect(quad[3].x).toBe(0)
  })
})

describe('buildBraceSolids', () => {
  it('needs exactly two struts per brace', () => {
    const pts = (braceId: number, y: number) => ({ braceId, edgeId: y, thickness: 2, points: [[0, y, 0], [10, y, 0]] as [Vec3, Vec3] })
    expect(buildBraceSolids([pts(1, 0), pts(1, 4), pts(2, 0)]).map((s) => s.braceId)).toEqual([1])
  })
})

describe('bracePlateEndPoints3D', () => {
  const plane = { origin: new THREE.Vector3(0, 0, 0), normal: new THREE.Vector3(0, 0, 1), xDir: new THREE.Vector3(1, 0, 0) }
  const brace = (dir: [number, number, number]): StrutBraceEnd => ({
    braceId: 1,
    params: { ...DEFAULT_BRACE_PARAMS, plateThickness: 5 },
    distanceFromVertex: 10,
    otherEdgeId: 2,
    otherEdgeDirection: dir,
  })

  it('maps 2D to the plane (y = normal x xDir) and offsets by strut/2 + plate thickness', () => {
    const [p, q] = bracePlateEndPoints3D(plane, 4, brace([0, 0, 1]), [[3, 2], [-3, 2]])
    expect(p.toArray()).toEqual([3, 2, 7])
    expect(q.toArray()).toEqual([-3, 2, 7])
  })

  it('offsets toward the other edge', () => {
    const [p] = bracePlateEndPoints3D(plane, 4, brace([0, 0, -1]), [[0, 0], [1, 0]])
    expect(p.z).toBe(-7)
  })
})

describe('braceQuadFrame / pairBracePoints', () => {
  it('gives a counter-clockwise 2D quad with the right area, on the frame\'s plane', () => {
    const frame = braceQuadFrame([[0, 0, 5], [10, 0, 5]], [[10, 4, 5], [0, 4, 5]])!
    const pts = braceQuadPoints2D(frame)
    let area = 0
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = pts[i]
      const [x2, y2] = pts[(i + 1) % 4]
      area += (x1 * y2 - x2 * y1) / 2
    }
    expect(area).toBeCloseTo(40, 5)
    expect(frame.plane.origin.z).toBeCloseTo(5)
  })

  it('pairs a brace\'s two struts and drops the incomplete ones', () => {
    const part = (braceId: number) => ({ braceId, edgeId: braceId * 10, thickness: 3, points: [[0, 0, 0], [1, 0, 0]] as [Vec3, Vec3] })
    const bodies = pairBracePoints([part(1), part(2), part(1)])
    expect(bodies.map((b) => b.braceId)).toEqual([1])
    expect(bodies[0].thickness).toBe(3)
  })
})
