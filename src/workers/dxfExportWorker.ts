/// <reference lib="webworker" />
import * as THREE from 'three'
import { computeStrutBoundary, computeStrutPlane } from '../lib/strutGeometry'
import { computeFlangeBoundary2D, resolveFlangeParams, type FlangeShapeParams, type FlangeSide } from '../lib/flangeGeometry'
import { computeFootPartBoundary2D } from '../lib/footGeometry'
import type { VertexEdgesInfo } from '../lib/edgesInfo'
import type { StrutGeometryEntry } from '../lib/previewBuildInputs'
import { bracePlateEndPoints3D } from '../lib/braces'
import type { BracePoints } from '../lib/braceSolid'
import { drawingToPolylines } from '../lib/dxfExport'
import { createExportStageProfiler, type ExportWorkerProfile } from '../lib/exportProfile'
import type { DxfHelperText, DxfPart } from '../lib/dxf'
import { bracePlateNameKey, flangeNameKey, type PartNameMaps } from '../lib/partNames'

// The DXF-export counterpart to stepExportWorker.ts: builds the same 2D drawings (strut outlines,
// flange plates, brace plates) but, instead of extruding them, reads their outlines back as
// polygons (drawingToPolylines) for the DXF sheet. Brace bodies have no drawing of their own - their
// flat quad comes from the plates' end points, see dxfExportRunner.ts - so this only reports those
// points.

declare const self: DedicatedWorkerGlobalScope

export interface DxfExportRequest {
  requestId: number
  profile?: boolean
  strutJobs: StrutGeometryEntry[]
  halfWidth: number
  endGrooveLengthPercent: number
  midGrooveLengthPercent: number
  grooveDepth: number
  millingDiameter: number
  chamferLength: number
  roundStrutBridge: boolean
  vertices: VertexEdgesInfo[]
  flangeParams: FlangeShapeParams
  names: PartNameMaps
}

export type DxfExportPhase = 'struts' | 'flanges'

export type DxfExportWorkerMessage =
  | { type: 'ready'; requestId: number }
  | { type: 'progress'; requestId: number; phase: DxfExportPhase; done: number; total: number }
  | { type: 'result'; requestId: number; parts: DxfPart[]; bracePoints: BracePoints[]; profile?: ExportWorkerProfile }
  | { type: 'error'; requestId: number; message: string }

// Height (mm at scale 1) of the green connection labels.
const HELPER_HEIGHT = 5
const RED_LABEL_HEIGHT = 8
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

function arcPoint2(a: [number, number], b: [number, number], center: [number, number], fraction: number): [number, number] {
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

function projectToPlane2D(
  p: THREE.Vector3,
  plane: { origin: THREE.Vector3; normal: THREE.Vector3; xDir: THREE.Vector3 },
): [number, number] {
  const yDir = plane.normal.clone().cross(plane.xDir).normalize()
  const rel = p.clone().sub(plane.origin)
  return [rel.dot(plane.xDir), rel.dot(yDir)]
}

function angleDegOf(a: [number, number], b: [number, number]): number {
  return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI
}

function pointTuple(p: { x: number; y: number } | [number, number]): [number, number] {
  return Array.isArray(p) ? p : [p.x, p.y]
}

function distance2(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy
}

function labelAvoidArea(ends: [{ x: number; y: number } | [number, number], { x: number; y: number } | [number, number]], label: string): LabelAvoidArea {
  const a = pointTuple(ends[0])
  const b = pointTuple(ends[1])
  const center: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const plateHalfLength = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2
  const labelHalfLength = (label.length * RED_LABEL_HEIGHT * TEXT_WIDTH_FACTOR) / 2
  return { center, radius: plateHalfLength + labelHalfLength + RED_LABEL_HEIGHT * 0.5 }
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

function footTabOffset(strutWidth: number, flangeThickness: number): number {
  const bodyHeight = Math.max(strutWidth - 2 * flangeThickness, 0)
  return bodyHeight / 2 + flangeThickness / 2
}

async function buildDxfParts(req: DxfExportRequest): Promise<{ parts: DxfPart[]; bracePoints: BracePoints[]; profile?: ExportWorkerProfile }> {
  const profiler = req.profile ? createExportStageProfiler() : null
  const timed = <T>(stage: string, fn: () => T): T => profiler ? profiler.time(stage, fn) : fn()
  const initStart = performance.now()
  const { ensureReplicadReady } = await import('../lib/replicadCad')
  await ensureReplicadReady()
  const initMs = performance.now() - initStart
  const buildStart = performance.now()
  self.postMessage({ type: 'ready', requestId: req.requestId } satisfies DxfExportWorkerMessage)

  const center = new THREE.Vector3(0, 0, 0)
  const parts: DxfPart[] = []
  const bracePoints: BracePoints[] = []

  req.strutJobs.forEach((job, i) => {
    const posA = toVector3(job.posA)
    const posB = toVector3(job.posB)
    const boundary = timed('strutBoundary2D', () => computeStrutBoundary(
      posA,
      posB,
      center,
      job.offsetA,
      job.offsetB,
      job.cornerLengthA,
      job.cornerLengthB,
      req.halfWidth,
      req.endGrooveLengthPercent,
      req.midGrooveLengthPercent,
      req.grooveDepth,
      req.millingDiameter,
      req.chamferLength,
      job.braces,
      req.roundStrutBridge,
    ))
    self.postMessage({
      type: 'progress',
      requestId: req.requestId,
      phase: 'struts',
      done: i + 1,
      total: req.strutJobs.length,
    } satisfies DxfExportWorkerMessage)

    try {
      if (boundary.main) {
        // Connection info in green: the vertex at each end, and the brace (if any) at its center.
        const helpers: DxfHelperText[] = []
        for (const mark of boundary.endMarks) {
          const vertexId = mark.end === 'A' ? job.vertexA : job.vertexB
          const tabOffset = Math.max(req.halfWidth - req.grooveDepth / 2, HELPER_HEIGHT)
          const side = scale2(rightOf(mark.axis), mark.end === 'A' ? 1 : -1)
          const outer = add2(mark.point, scale2(side, tabOffset))
          const inner = add2(mark.point, scale2(side, -tabOffset))
          const angleDeg = axisAngleDeg(mark.axis)
          helpers.push({
            text: req.names.flanges[flangeNameKey(vertexId, 'outer')] ?? `FE${vertexId}`,
            x: outer[0],
            y: outer[1],
            angleDeg,
            height: HELPER_HEIGHT,
          })
          helpers.push({
            text: req.names.flanges[flangeNameKey(vertexId, 'inner')] ?? `FI${vertexId}`,
            x: inner[0],
            y: inner[1],
            angleDeg,
            height: HELPER_HEIGHT,
          })
        }
        for (const mark of boundary.braceMarks) {
          helpers.push({
            text: req.names.braces[mark.braceId] ?? `B${mark.braceId}`,
            x: mark.point[0],
            y: mark.point[1],
            angleDeg: axisAngleDeg(mark.axis),
            height: HELPER_HEIGHT,
          })
        }
        const partName = req.names.struts[job.index] ?? `strut-${job.index}`
        const avoidAreas = [boundary.bracePlateEndsA, boundary.bracePlateEndsB].flatMap((ends) =>
          ends ? [labelAvoidArea(ends, partName)] : [],
        )
        const label = strutLabel(posA, posB, center, avoidAreas, req.roundStrutBridge)
        parts.push({
          name: partName,
          kind: 'strut',
          loops: timed('outlineToPolylines', () => drawingToPolylines(boundary.main!)),
          labelAnchor: label.anchor,
          labelAngleDeg: label.angleDeg,
          helpers,
        })
      }
    } catch (err) {
      console.error(`Failed to read strut outline for edge ${job.index}`, err)
    }

    const plane = computeStrutPlane(posA, posB, center)
    const plates = [
      { plate: boundary.bracePlateA, brace: job.braces.a[0], end: 'A', ends: boundary.bracePlateEndsA },
      { plate: boundary.bracePlateB, brace: job.braces.b[0], end: 'B', ends: boundary.bracePlateEndsB },
    ] as const
    for (const { plate, brace, end, ends } of plates) {
      if (!brace) continue
      if (ends) {
        const [p, q] = bracePlateEndPoints3D(plane, job.beamThickness, brace, [ends[0], ends[1]])
        bracePoints.push({ braceId: brace.braceId, edgeId: job.index, thickness: brace.params.thickness, points: [p.toArray(), q.toArray()] })
      }
      if (!plate) continue
      try {
        parts.push({
          name: req.names.bracePlates[bracePlateNameKey(brace.braceId, job.index, end)] ?? `brace-plate-${brace.braceId}-strut-${job.index}-${end}`,
          kind: 'brace-plate',
          loops: timed('outlineToPolylines', () => drawingToPolylines(plate)),
          labelAngleDeg: ends ? angleDegOf(pointTuple(ends[0]), pointTuple(ends[1])) + 90 : undefined,
        })
      } catch (err) {
        console.error(`Failed to read brace plate ${brace.braceId} outline for edge ${job.index}`, err)
      }
    }
  })

  req.vertices.forEach((vertex, i) => {
    const flangeParams = resolveFlangeParams(req.flangeParams, vertex.flangeOverrides)
    self.postMessage({
      type: 'progress',
      requestId: req.requestId,
      phase: 'flanges',
      done: i + 1,
      total: req.vertices.length,
    } satisfies DxfExportWorkerMessage)

    for (const side of ['outer', 'inner'] as const satisfies readonly FlangeSide[]) {
      const boundary = timed('flangeBoundary2D', () => computeFlangeBoundary2D(
        { vertexId: vertex.vertexId, edges: vertex.edges, foot: vertex.foot },
        flangeParams,
        side,
      ))
      if (!boundary.main) continue
      try {
        // Which strut goes into each rectangular hole, in green along the hole.
        const helpers: DxfHelperText[] = boundary.edgeMarks.map((mark) => {
          const [dx, dy] = polar2(mark.angleDeg, HELPER_HEIGHT * 0.9)
          const [x, y] = add2(mark.farSideCenter, [dx, dy])
          return {
            text: req.names.struts[mark.edgeId] ?? `S${mark.edgeId}`,
            x,
            y,
            angleDeg: mark.angleDeg + 90,
            height: Math.min(HELPER_HEIGHT, mark.holeWidth * 0.7),
          }
        })
        if (vertex.foot) {
          const [x, y] = polar2(vertex.foot.projectedAngleDeg, vertex.foot.holeOffset + vertex.foot.thickness / 2)
          const [labelX, labelY] = labelBeside([x, y], vertex.foot.projectedAngleDeg, vertex.foot.grooveLength / 2 + HELPER_HEIGHT * 0.9)
          helpers.push({
            text: req.names.feet[vertex.vertexId] ?? `F${vertex.vertexId}`,
            x: labelX,
            y: labelY,
            angleDeg: vertex.foot.projectedAngleDeg,
            height: Math.min(HELPER_HEIGHT, vertex.foot.grooveLength * 0.7),
          })
        }
        parts.push({
          name: req.names.flanges[flangeNameKey(vertex.vertexId, side)] ?? `flange-${vertex.vertexId}-${side}`,
          kind: 'flange',
          loops: timed('outlineToPolylines', () => drawingToPolylines(boundary.main!)),
          labelAnchor: { x: 0, y: req.flangeParams.centerHoleDiameter / 2 + 8 },
          helpers,
        })
      } catch (err) {
        console.error(`Failed to read ${side} flange outline for vertex ${vertex.vertexId}`, err)
      }
    }

    const foot = vertex.foot
    if (foot) {
      try {
        const boundary = timed('footBoundary2D', () => computeFootPartBoundary2D(foot, req.halfWidth * 2, req.grooveDepth))
        if (boundary.main) {
          const tabOffset = footTabOffset(req.halfWidth * 2, req.grooveDepth)
          parts.push({
            name: req.names.feet[vertex.vertexId] ?? `foot-${vertex.vertexId}`,
            kind: 'foot',
            loops: timed('outlineToPolylines', () => drawingToPolylines(boundary.main!)),
            helpers: [
              {
                text: req.names.flanges[flangeNameKey(vertex.vertexId, 'outer')] ?? `FE${vertex.vertexId}`,
                x: 0,
                y: tabOffset,
                angleDeg: 0,
                height: HELPER_HEIGHT,
              },
              {
                text: req.names.flanges[flangeNameKey(vertex.vertexId, 'inner')] ?? `FI${vertex.vertexId}`,
                x: 0,
                y: -tabOffset,
                angleDeg: 0,
                height: HELPER_HEIGHT,
              },
            ],
          })
        }
      } catch (err) {
        console.error(`Failed to read foot outline for vertex ${vertex.vertexId}`, err)
      }
    }
  })

  return { parts, bracePoints, profile: profiler?.snapshot(initMs, performance.now() - buildStart) }
}

self.onmessage = (event: MessageEvent<DxfExportRequest>) => {
  const req = event.data
  buildDxfParts(req).then(
    ({ parts, bracePoints, profile }) => {
      self.postMessage({ type: 'result', requestId: req.requestId, parts, bracePoints, profile } satisfies DxfExportWorkerMessage)
    },
    (err: unknown) => {
      self.postMessage({
        type: 'error',
        requestId: req.requestId,
        message: err instanceof Error ? err.message : String(err),
      } satisfies DxfExportWorkerMessage)
    },
  )
}
