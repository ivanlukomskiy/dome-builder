import * as THREE from 'three'
import { computeStrutPlane, type computeStrutBoundary } from './strutGeometry'
import { resolveFlangeParams, type computeFlangeBoundary2D, type FlangeSide } from './flangeGeometry'
import type { VertexEdgesInfo } from './edgesInfo'
import type { StrutGeometryEntry } from './previewBuildInputs'
import type { DxfPart, DxfHelperText } from './dxf'
import type { DxfExportRequest } from '../workers/dxfExportWorker'
import { flangeNameKey } from './partNames'
import { braceQuadFrame, projectToFrame2D, type BraceBody, type Vec3 } from './braceSolid'
import type { PartNameMaps } from './partNames'
import type { DxfLabelSettings } from './dxfLabelSettings'

export type PartLabels = Pick<DxfPart, 'name' | 'labelAnchor' | 'labelAngleDeg' | 'helpers'>
type LabelContext = Pick<DxfExportRequest, 'names' | 'halfWidth' | 'grooveDepth' | 'roundStrutBridge' | 'partIdLabelSize' | 'connectedPartIdLabelSize' | 'flangeParams'>

const TEXT_WIDTH_FACTOR = 0.8

interface LabelAvoidArea {
  center: [number, number]
  radius: number
}

function axisAngleDeg(axis: [number, number]): number {
  return (Math.atan2(axis[1], axis[0]) * 180) / Math.PI
}

function polar2(angleDeg: number, radius: number): [number, number] {
  const angle = (angleDeg * Math.PI) / 180
  return [Math.cos(angle) * radius, Math.sin(angle) * radius]
}

function add2(a: [number, number], b: [number, number]): [number, number] {
  return [a[0] + b[0], a[1] + b[1]]
}

function scale2(v: [number, number], s: number): [number, number] {
  return [v[0] * s, v[1] * s]
}

function rightOf(axis: [number, number]): [number, number] {
  return [axis[1], -axis[0]]
}

function labelBeside(center: [number, number], angleDeg: number, distance: number): [number, number] {
  const offset = polar2(angleDeg + 90, distance)
  return add2(center, offset)
}

export function arcPoint2(a: [number, number], b: [number, number], center: [number, number], fraction: number): [number, number] {
  const radius = (Math.hypot(a[0] - center[0], a[1] - center[1]) + Math.hypot(b[0] - center[0], b[1] - center[1])) / 2
  const angleA = Math.atan2(a[1] - center[1], a[0] - center[0])
  const angleB = Math.atan2(b[1] - center[1], b[0] - center[0])
  let delta = angleB - angleA
  while (delta > Math.PI) delta -= 2 * Math.PI
  while (delta < -Math.PI) delta += 2 * Math.PI
  const angle = angleA + delta * fraction
  return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius]
}

function linePoint2(a: [number, number], b: [number, number], fraction: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction]
}

function toVector3(t: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(t[0], t[1], t[2])
}

export function projectToPlane2D(
  p: THREE.Vector3,
  plane: { origin: THREE.Vector3; normal: THREE.Vector3; xDir: THREE.Vector3 },
): [number, number] {
  const yDir = plane.normal.clone().cross(plane.xDir).normalize()
  const rel = p.clone().sub(plane.origin)
  return [rel.dot(plane.xDir), rel.dot(yDir)]
}

export function angleDegOf(a: [number, number], b: [number, number]): number {
  return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI
}

export function pointTuple(p: { x: number; y: number } | [number, number]): [number, number] {
  return Array.isArray(p) ? p : [p.x, p.y]
}

function distance2(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy
}

function labelAvoidArea(ends: [{ x: number; y: number } | [number, number], { x: number; y: number } | [number, number]], label: string, labelHeight: number): LabelAvoidArea {
  const a = pointTuple(ends[0])
  const b = pointTuple(ends[1])
  const center: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const plateHalfLength = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2
  const labelHalfLength = (label.length * labelHeight * TEXT_WIDTH_FACTOR) / 2
  return { center, radius: plateHalfLength + labelHalfLength + labelHeight * 0.5 }
}

function strutLabel(
  posA: THREE.Vector3,
  posB: THREE.Vector3,
  center: THREE.Vector3,
  avoidAreas: LabelAvoidArea[],
  roundBridge: boolean,
): { anchor: { x: number; y: number }; angleDeg: number } {
  const plane = computeStrutPlane(posA, posB, center)
  const a = projectToPlane2D(posA, plane)
  const b = projectToPlane2D(posB, plane)
  const c = projectToPlane2D(center, plane)
  const pointAt = (fraction: number) => roundBridge ? arcPoint2(a, b, c, fraction) : linePoint2(a, b, fraction)
  const [x, y] =
    avoidAreas.length === 0
      ? pointAt(0.5)
      : Array.from({ length: 17 }, (_, i) => 0.18 + (i * 0.64) / 16)
        .sort((left, right) => Math.abs(left - 0.5) - Math.abs(right - 0.5))
        .map((fraction) => {
          const point = pointAt(fraction)
          const clear = avoidAreas.every((avoid) => distance2(point, avoid.center) >= avoid.radius * avoid.radius)
          const clearance = Math.min(...avoidAreas.map((avoid) => distance2(point, avoid.center) - avoid.radius * avoid.radius))
          return { point, clear, clearance }
        }).reduce((best, candidate) => {
          if (best.clear) return best
          if (candidate.clear) return candidate
          return candidate.clearance > best.clearance ? candidate : best
        }).point
  return { anchor: { x, y }, angleDeg: angleDegOf(a, b) }
}

export function strutPartLabels(req: LabelContext, job: StrutGeometryEntry, boundary: ReturnType<typeof computeStrutBoundary>): PartLabels {
  const posA = toVector3(job.posA)
  const posB = toVector3(job.posB)
  const center = new THREE.Vector3()
  // Connection info in green: the vertex at each end, and the brace (if any) at its center.
  const helpers: DxfHelperText[] = []
  for (const mark of boundary.endMarks) {
    const vertexId = mark.end === 'A' ? job.vertexA : job.vertexB
    const tabOffset = Math.max(req.halfWidth - req.grooveDepth / 2, req.connectedPartIdLabelSize)
    const side = scale2(rightOf(mark.axis), mark.end === 'A' ? 1 : -1)
    const outer = add2(mark.point, scale2(side, tabOffset))
    const inner = add2(mark.point, scale2(side, -tabOffset))
    const angleDeg = axisAngleDeg(mark.axis)
    helpers.push({
      text: req.names.flanges[flangeNameKey(vertexId, 'outer')],
      x: outer[0],
      y: outer[1],
      angleDeg,
      height: req.connectedPartIdLabelSize,
    })
    helpers.push({
      text: req.names.flanges[flangeNameKey(vertexId, 'inner')],
      x: inner[0],
      y: inner[1],
      angleDeg,
      height: req.connectedPartIdLabelSize,
    })
  }
  for (const mark of boundary.braceMarks) {
    helpers.push({
      text: req.names.braces[mark.braceId],
      x: mark.point[0],
      y: mark.point[1],
      angleDeg: axisAngleDeg(mark.axis),
      height: req.connectedPartIdLabelSize,
    })
  }
  const partName = req.names.struts[job.index]
  const avoidAreas = [boundary.bracePlateEndsA, boundary.bracePlateEndsB].flatMap((ends) =>
    ends ? [labelAvoidArea(ends, partName, req.partIdLabelSize)] : [],
  )
  const label = strutLabel(posA, posB, center, avoidAreas, req.roundStrutBridge)
  return { name: partName, labelAnchor: label.anchor, labelAngleDeg: label.angleDeg, helpers }
}

export function flangePartLabels(req: LabelContext, vertex: VertexEdgesInfo, side: FlangeSide, boundary: ReturnType<typeof computeFlangeBoundary2D>): PartLabels {
  // Which strut goes into each rectangular hole, in green along the hole.
  const helpers: DxfHelperText[] = boundary.edgeMarks.map((mark) => {
    const [dx, dy] = polar2(mark.angleDeg, req.connectedPartIdLabelSize * 0.9)
    const [x, y] = add2(mark.farSideCenter, [dx, dy])
    return {
      text: req.names.struts[mark.edgeId],
      x,
      y,
      angleDeg: mark.angleDeg + 90,
      height: Math.min(req.connectedPartIdLabelSize, mark.holeWidth * 0.7),
    }
  })
  if (vertex.foot) {
    const [x, y] = polar2(vertex.foot.projectedAngleDeg, vertex.foot.holeOffset + vertex.foot.thickness / 2)
    const [labelX, labelY] = labelBeside([x, y], vertex.foot.projectedAngleDeg, vertex.foot.grooveLength / 2 + req.connectedPartIdLabelSize * 0.9)
    helpers.push({
      text: req.names.feet[vertex.vertexId],
      x: labelX,
      y: labelY,
      angleDeg: vertex.foot.projectedAngleDeg,
      height: Math.min(req.connectedPartIdLabelSize, vertex.foot.grooveLength * 0.7),
    })
  }
  return {
    name: req.names.flanges[flangeNameKey(vertex.vertexId, side)],
    labelAnchor: { x: 0, y: resolveFlangeParams(req.flangeParams, vertex.flangeOverrides).centerHoleDiameter / 2 + req.partIdLabelSize },
    helpers,
  }
}

export function bracePartLabels(body: BraceBody, names: PartNameMaps, labelSettings: DxfLabelSettings): PartLabels {
  const frame = braceQuadFrame(body.a, body.b)
  if (!frame) throw new Error(`Cannot construct brace ${body.braceId}.`)
  // Green: the strut each end of the brace goes into, written along the brace just inside
  // the end (the middle of that strut's two plate end points).
  const height = labelSettings.connectedPartIdLabelSize
  const mid = (pts: [Vec3, Vec3]): [number, number] => {
    const [p, q] = pts.map((pt) => projectToFrame2D(frame, pt))
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
  }
  const ends: [string, [number, number]][] = [
    [names.struts[body.edgeIdA], mid(body.a)],
    [names.struts[body.edgeIdB], mid(body.b)],
  ]
  const dir: [number, number] = [ends[1][1][0] - ends[0][1][0], ends[1][1][1] - ends[0][1][1]]
  const len = Math.hypot(dir[0], dir[1]) || 1
  const unit: [number, number] = [dir[0] / len, dir[1] / len]
  const helpers: DxfHelperText[] = ends.map(([text, at], i) => {
    // Moved inward, along the brace, by half the text's length plus a little.
    const inset = (text.length * height * 0.8) / 2 + 2
    const sign = i === 0 ? 1 : -1
    return {
      text,
      x: at[0] + sign * unit[0] * inset,
      y: at[1] + sign * unit[1] * inset,
      angleDeg: (Math.atan2(unit[1], unit[0]) * 180) / Math.PI,
      height,
    }
  })
  return { name: names.braces[body.braceId], labelAngleDeg: (Math.atan2(unit[1], unit[0]) * 180) / Math.PI, helpers }
}
