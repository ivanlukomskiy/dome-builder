import * as THREE from 'three'
import type { VertexEdgesInfo } from './edgesInfo'

function toVector3(t: [number, number, number]): THREE.Vector3 { return new THREE.Vector3(...t) }

// Shared by preview and STEP assembly so the foot seats in both flange slots.
export function footPartPlane(vertex: VertexEdgesInfo) {
  const foot = vertex.foot
  if (!foot) return null

  const origin = toVector3(vertex.position)
  const normal = toVector3(vertex.tangentPlane.normal).normalize()
  const e1 = toVector3(vertex.tangentPlane.e1).normalize()
  const e2 = toVector3(vertex.tangentPlane.e2).normalize()
  const angle = (foot.projectedAngleDeg * Math.PI) / 180
  const axis = e1.multiplyScalar(Math.cos(angle)).add(e2.multiplyScalar(Math.sin(angle))).normalize()
  if (axis.lengthSq() < 1e-12) return null

  let xDir = normal.clone().cross(axis)
  if (xDir.lengthSq() < 1e-12) xDir = toVector3(vertex.tangentPlane.e1)
  xDir.normalize()

  return {
    origin: origin.addScaledVector(axis, foot.holeOffset + foot.thickness / 2),
    normal: axis,
    xDir,
  }
}
