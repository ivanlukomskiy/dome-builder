import * as THREE from 'three'
import type { SceneData } from './polyhedra'

export interface ShellTriangleMeasurement {
  faceId: number
  outsideVertexId: number
  outsidePoint: [number, number, number]
  edgePoint?: [number, number, number]
  angleDegrees?: number
  offset?: number
  error?: string
}

export interface ShellEdgeMeasurement {
  edgeId: number
  vertices: [number, number]
  thickness: number
  triangles: ShellTriangleMeasurement[]
  // Null means an adjacent triangle could not be measured; never average a partial set.
  offset: number | null
}

// Plane A is perpendicular to the edge through the third triangle vertex. Projecting
// that vertex onto the edge locates edgePoint. The projected direction toward the
// sphere center is the inward direction of the intersection of planes A and B.
export function computeShellEdgeOffsets(
  data: Pick<SceneData, 'edges' | 'faces'>,
  positions: ReadonlyMap<number, THREE.Vector3>,
  thicknessOf: (edgeId: number) => number,
  center = new THREE.Vector3(),
): ShellEdgeMeasurement[] {
  const byPair = new Map<string, { faceId: number; outsideVertexId: number }[]>()
  const key = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`
  for (const [faceId, face] of data.faces) {
    if (face.length !== 3) continue
    for (let i = 0; i < 3; i++) {
      const pair = key(face[i], face[(i + 1) % 3])
      const adjacent = byPair.get(pair) ?? []
      adjacent.push({ faceId, outsideVertexId: face[(i + 2) % 3] })
      byPair.set(pair, adjacent)
    }
  }
  return Array.from(data.edges, ([edgeId, [aId, bId]]) => {
    const thickness = thicknessOf(edgeId)
    const triangles = (byPair.get(key(aId, bId)) ?? []).map(({ faceId, outsideVertexId }): ShellTriangleMeasurement => {
      const outside = positions.get(outsideVertexId)
      const measurement: ShellTriangleMeasurement = {
        faceId, outsideVertexId, outsidePoint: outside?.toArray() ?? [NaN, NaN, NaN],
      }
      try {
        const a = positions.get(aId)
        const b = positions.get(bId)
        if (!a || !b || !outside || ![a, b, outside, center].every(p => p.toArray().every(Number.isFinite))) {
          throw new Error('Missing or non-finite vertex coordinates')
        }
        if (!Number.isFinite(thickness) || thickness < 0) throw new Error('Invalid strut thickness')
        const edge = b.clone().sub(a)
        if (edge.length() < 1e-9) throw new Error('Zero-length edge')
        edge.normalize()
        const edgePoint = a.clone().addScaledVector(edge, outside.clone().sub(a).dot(edge))
        measurement.edgePoint = edgePoint.toArray()
        const inward = center.clone().sub(edgePoint)
        inward.addScaledVector(edge, -inward.dot(edge))
        const across = outside.clone().sub(edgePoint)
        if (inward.length() < 1e-9) throw new Error('Sphere center lies on the edge line; plane B is undefined')
        if (across.length() < 1e-9) throw new Error('Third triangle vertex lies on the edge line')
        inward.normalize()
        across.normalize()
        const cosine = inward.dot(across)
        const sine = inward.clone().cross(across).length()
        if (sine < 1e-10) throw new Error('Angle has undefined or infinite cotangent')
        measurement.angleDegrees = Math.atan2(sine, cosine) * 180 / Math.PI
        measurement.offset = thickness / 2 * cosine / sine
        if (!Number.isFinite(measurement.offset)) throw new Error('Non-finite shell edge offset')
        measurement.offset = Math.max(0, measurement.offset)
      } catch (error) {
        measurement.error = error instanceof Error ? error.message : String(error)
        delete measurement.offset
      }
      return measurement
    })
    const offset = triangles.some(t => t.error) ? null
      : triangles.length ? triangles.reduce((sum, t) => sum + t.offset!, 0) / triangles.length : 0
    return { edgeId, vertices: [aId, bId], thickness, triangles, offset }
  })
}
