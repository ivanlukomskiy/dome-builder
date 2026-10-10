import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { computeShellEdgeOffsets } from './shellGeometry'

function fixture(faces: number[][] = [[0, 1, 2]]) {
  return {
    data: { edges: new Map<number, [number, number]>([[9, [0, 1]]]), faces: new Map(faces.map((face, i) => [i, face])) },
    positions: new Map([
      [0, new THREE.Vector3(2, 0, -1)], [1, new THREE.Vector3(2, 0, 1)],
      [2, new THREE.Vector3(1, 1, 0)], [3, new THREE.Vector3(0, -1, 0)],
    ]),
  }
}

describe('shell edge offsets', () => {
  it('uses the inward AB-line direction and the third triangle vertex', () => {
    const { data, positions } = fixture()
    const [result] = computeShellEdgeOffsets(data, positions, () => 30)
    expect(result.offset).toBeCloseTo(15)
    expect(result.triangles[0]).toMatchObject({ faceId: 0, outsideVertexId: 2, outsidePoint: [1, 1, 0], edgePoint: [2, 0, 0] })
    expect(result.triangles[0].angleDegrees).toBeCloseTo(45)
  })

  it('averages two unequal triangle offsets using the edge thickness', () => {
    const { data, positions } = fixture([[0, 1, 2], [1, 0, 3]])
    const [result] = computeShellEdgeOffsets(data, positions, id => id === 9 ? 40 : 30)
    expect(result.triangles.map(t => t.offset)).toEqual([20, 40])
    expect(result.offset).toBeCloseTo(30)
  })

  it('returns zero without triangular faces, ignoring polygons', () => {
    const { data, positions } = fixture([[0, 1, 2, 3]])
    expect(computeShellEdgeOffsets(data, positions, () => 30)[0]).toMatchObject({ triangles: [], offset: 0 })
  })

  it('clamps negative offsets to zero for obtuse angles', () => {
    const { data, positions } = fixture()
    positions.set(2, new THREE.Vector3(3, 1, 0))
    const [result] = computeShellEdgeOffsets(data, positions, () => 30)
    expect(result.offset).toBe(0)
    expect(result.triangles[0].offset).toBe(0)
    expect(result.triangles[0].angleDegrees).toBeCloseTo(135)
  })

  it('clamps each triangle offset before averaging', () => {
    const { data, positions } = fixture([[0, 1, 2], [1, 0, 3]])
    positions.set(2, new THREE.Vector3(3, 1, 0))
    const [result] = computeShellEdgeOffsets(data, positions, () => 30)
    expect(result.triangles.map(t => t.offset)).toEqual([0, 30])
    expect(result.offset).toBe(15)
  })

  it('is invariant under edge reversal and rigid transforms', () => {
    const { data, positions } = fixture([[0, 1, 2], [1, 0, 3]])
    data.edges.set(9, [1, 0])
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 2, 3).normalize(), 1.2)
    const center = new THREE.Vector3(10, -20, 5)
    for (const p of positions.values()) p.applyQuaternion(rotation).add(center)
    expect(computeShellEdgeOffsets(data, positions, () => 30, center)[0].offset).toBeCloseTo(22.5)
  })

  it.each(['zero edge', 'undefined plane', 'collinear triangle', 'infinite cotangent'])('reports %s without averaging a partial result', kind => {
    const { data, positions } = fixture([[0, 1, 2], [1, 0, 3]])
    if (kind === 'zero edge') positions.set(1, positions.get(0)!.clone())
    if (kind === 'undefined plane') {
      positions.set(0, new THREE.Vector3(0, 0, -1))
      positions.set(1, new THREE.Vector3(0, 0, 1))
    }
    if (kind === 'collinear triangle') positions.set(2, new THREE.Vector3(2, 0, 0))
    if (kind === 'infinite cotangent') positions.set(2, new THREE.Vector3(1, 0, 0))
    const [result] = computeShellEdgeOffsets(data, positions, () => 30)
    expect(result.offset).toBeNull()
    expect(result.triangles[0].error).toBeTruthy()
  })
})
