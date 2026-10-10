import * as THREE from 'three'
import type { PreviewBuildInputParams, StrutGeometryEntry } from './previewBuildInputs'
import { precalculateStrutEnd } from './strutGeometry'
import { computeShellEdgeOffsets } from './shellGeometry'

// Select one uniformly scaled shell, then derive both shoulders of every strut
// from its target shell line. No sequential end adjustments or iterative solve.
export function prepareShellStruts(entries: StrutGeometryEntry[], params: PreviewBuildInputParams) {
  const shellVertices = new Map<number, THREE.Vector3>()
  if (!params.shellEnabled || params.roundStrutBridge || !entries.length) return { scale: 1, shellVertices }
  const offsets = new Map(computeShellEdgeOffsets(params.data, params.transformedVertices,
    id => params.edgeThickness.get(id) ?? params.thickness).map(m => [m.edgeId, m]))
  let scale = 0
  const prepared = entries.map(entry => {
    const measurement = offsets.get(entry.index)!
    if (measurement.offset === null) {
      throw new Error(`Shell edge ${entry.index}: ${measurement.triangles.filter(t => t.error).map(t => `triangle ${t.faceId}: ${t.error}`).join('; ')}`)
    }
    const a = new THREE.Vector3(...entry.posA), b = new THREE.Vector3(...entry.posB)
    const chord = b.clone().sub(a)
    if (chord.length() < 1e-9) throw new Error(`Shell edge ${entry.index}: zero-length edge`)
    chord.normalize()
    const normal = a.clone().addScaledVector(chord, -a.dot(chord))
    if (normal.length() < 1e-9) throw new Error(`Shell edge ${entry.index}: edge line passes through the sphere center`)
    normal.normalize()
    const level = normal.dot(a)
    const shoulders = ([['A', a, b, entry.offsetA, entry.cornerLengthA],
      ['B', b, a, entry.offsetB, entry.cornerLengthB]] as const).map(([end, vertex, other, offset, corner]) => {
      const radial = vertex.clone().normalize()
      const tangent = other.clone().sub(vertex)
      tangent.addScaledVector(radial, -tangent.dot(radial)).normalize()
      const endParams = precalculateStrutEnd(offset, corner, params.endGrooveLengthPercent,
        params.midGrooveLengthPercent, params.chamferLength, params.millingDiameter,
        params.grooveDepth, params.extrudeDistance / 2)
      const base = vertex.clone().addScaledVector(tangent, endParams.effectiveCornerLength)
        .addScaledVector(radial, endParams.halfWidth)
      const projection = normal.dot(radial)
      if (projection < 1e-9 || tangent.lengthSq() < 0.5) throw new Error(`Shell edge ${entry.index}, end ${end}: undefined shoulder intersection`)
      // n·(base + added * radial) + edgeOffset = scale * n·vertex.
      // Each shoulder imposes one lower bound on the shared scale (added >= 0).
      const minimumScale = (normal.dot(base) + measurement.offset!) / level
      if (!Number.isFinite(minimumScale)) throw new Error(`Shell edge ${entry.index}, end ${end}: non-finite shell scale`)
      scale = Math.max(scale, minimumScale)
      return { base, radial, projection }
    })
    return { entry, normal, level, shoulders, offset: measurement.offset }
  })
  for (const { entry, normal, level, shoulders, offset } of prepared) {
    const thicknesses = shoulders.map(({ base, projection }) =>
      Math.max(0, (scale * level - offset - normal.dot(base)) / projection))
    if (!thicknesses.every(Number.isFinite)) throw new Error(`Shell edge ${entry.index}: non-finite added thickness`)
    const targets = [new THREE.Vector3(...entry.posA).multiplyScalar(scale), new THREE.Vector3(...entry.posB).multiplyScalar(scale)]
    const ends = shoulders.map(({ base, radial }, i) => base.clone().addScaledVector(radial, thicknesses[i]))
    // Verify the shifted, actually constructed bridge passes through both targets.
    const direction = ends[1].clone().sub(ends[0])
    if (direction.length() < 1e-9) throw new Error(`Shell edge ${entry.index}: collapsed outer bridge`)
    direction.normalize()
    const actualNormal = normal.clone().addScaledVector(direction, -normal.dot(direction)).normalize()
    if (targets.some(target => Math.abs(actualNormal.dot(target.clone().sub(ends[0])) - offset) > 1e-5)) {
      throw new Error(`Shell edge ${entry.index}: shell vertex alignment failed`)
    }
    entry.addedThicknessA = thicknesses[0]
    entry.addedThicknessB = thicknesses[1]
    entry.shellEdgeOffset = offset
    shellVertices.set(entry.vertexA, targets[0])
    shellVertices.set(entry.vertexB, targets[1])
  }
  return { scale, shellVertices }
}
