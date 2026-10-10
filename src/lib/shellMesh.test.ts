import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildShellGeometry } from './shellMesh'

const vertices = new Map([
  [0, new THREE.Vector3(0, 0, 10)], [1, new THREE.Vector3(4, 0, 10)], [2, new THREE.Vector3(0, 3, 10)],
])

describe('shell preview mesh', () => {
  it('renders a single outward-facing surface for zero thickness', () => {
    const geometry = buildShellGeometry(new Map([[1, [0, 2, 1]]]), vertices, 0)!
    try {
      expect(geometry.getAttribute('position').count).toBe(3)
      expect(geometry.getAttribute('normal').getZ(0)).toBeCloseTo(1)
      geometry.computeBoundingBox()
      expect(geometry.boundingBox!.min.z).toBe(10)
      expect(geometry.boundingBox!.max.z).toBe(10)
    } finally { geometry.dispose() }
  })

  it('builds a closed outward-extruded prism with the requested volume', () => {
    const geometry = buildShellGeometry(new Map([[1, [0, 1, 2]]]), vertices, 2.5)!
    try {
      const positions = geometry.getAttribute('position')
      expect(positions.count).toBe(24)
      geometry.computeBoundingBox()
      expect(geometry.boundingBox!.min.z).toBe(10)
      expect(geometry.boundingBox!.max.z).toBe(12.5)
      let volume = 0
      const edges = new Map<string, number>()
      const pointKey = (i: number) => `${positions.getX(i)},${positions.getY(i)},${positions.getZ(i)}`
      for (let i = 0; i < positions.count; i += 3) {
        const [a, b, c] = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(positions, i + j))
        volume += a.dot(b.clone().cross(c)) / 6
        for (let j = 0; j < 3; j++) {
          const key = [pointKey(i + j), pointKey(i + (j + 1) % 3)].sort().join('|')
          edges.set(key, (edges.get(key) ?? 0) + 1)
        }
      }
      expect(volume).toBeCloseTo(6 * 2.5)
      expect([...edges.values()].every(count => count === 2)).toBe(true)
    } finally { geometry.dispose() }
  })

  it('extrudes perpendicular to rotated faces', () => {
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 2, 3).normalize(), 0.7)
    const rotated = new Map([...vertices].map(([id, p]) => [id, p.clone().applyQuaternion(rotation)]))
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation)
    const geometry = buildShellGeometry(new Map([[1, [0, 1, 2]]]), rotated, 2)!
    try {
      const positions = geometry.getAttribute('position')
      const start = new THREE.Vector3().fromBufferAttribute(positions, 0)
      const top = new THREE.Vector3().fromBufferAttribute(positions, 3)
      expect(top.clone().sub(start).distanceTo(normal.multiplyScalar(2))).toBeLessThan(1e-5)
    } finally { geometry.dispose() }
  })

  it('ignores polygons and faces without solved shell vertices', () => {
    expect(buildShellGeometry(new Map([[1, [0, 1, 2, 3]], [2, [0, 1, 3]]]), vertices, 2)).toBeNull()
    expect(buildShellGeometry(new Map([[1, [0, 1, 2]]]), new Map(), 2)).toBeNull()
  })

  it.each([-1, Infinity, NaN])('rejects invalid thickness %s', thickness => {
    expect(() => buildShellGeometry(new Map(), vertices, thickness)).toThrow('nonnegative')
  })
})
