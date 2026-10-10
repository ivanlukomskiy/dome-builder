import * as THREE from 'three'
import type { Face } from './polyhedra'

// The solved shell vertices form the inner surface. Positive thickness grows
// outward along each triangle's own normal, independently of its stored winding.
export function buildShellGeometry(
  faces: ReadonlyMap<number, Face>,
  vertices: ReadonlyMap<number, THREE.Vector3>,
  thickness: number,
): THREE.BufferGeometry | null {
  if (!Number.isFinite(thickness) || thickness < 0) throw new Error('Shell thickness must be a finite nonnegative number')
  const positions: number[] = []
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => positions.push(...a.toArray(), ...b.toArray(), ...c.toArray())
  for (const [faceId, face] of faces) {
    if (face.length !== 3) continue
    const points = face.map(id => vertices.get(id))
    if (points.some(p => !p)) continue
    let [a, b, c] = points as THREE.Vector3[]
    const normal = b.clone().sub(a).cross(c.clone().sub(a))
    if (normal.length() < 1e-9) throw new Error(`Shell face ${faceId}: degenerate triangle`)
    if (normal.dot(a.clone().add(b).add(c)) < 0) {
      ;[b, c] = [c, b]
      normal.negate()
    }
    normal.normalize()
    if (thickness === 0) {
      triangle(a, b, c)
      continue
    }
    const shift = normal.multiplyScalar(thickness)
    const top = [a, b, c].map(p => p.clone().add(shift))
    triangle(a, c, b)
    triangle(top[0], top[1], top[2])
    const bottom = [a, b, c]
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3
      triangle(bottom[i], bottom[j], top[j])
      triangle(bottom[i], top[j], top[i])
    }
  }
  if (!positions.length) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}
