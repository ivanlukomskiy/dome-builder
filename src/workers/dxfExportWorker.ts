/// <reference lib="webworker" />
import * as THREE from 'three'
import { strutPartLabels, flangePartLabels, footPartLabels, arcPoint2, projectToPlane2D, angleDegOf, pointTuple } from '../lib/partLabels'
import { computeStrutBoundary, computeStrutPlane } from '../lib/strutGeometry'
import { computeFlangeBoundary2D, resolveFlangeParams, type FlangeShapeParams, type FlangeSide } from '../lib/flangeGeometry'
import { computeFootPartBoundary2D } from '../lib/footGeometry'
import type { VertexEdgesInfo } from '../lib/edgesInfo'
import type { StrutGeometryEntry } from '../lib/previewBuildInputs'
import { bracePlateEndPoints3D } from '../lib/braces'
import type { BracePoints } from '../lib/braceSolid'
import { drawingToPolylines } from '../lib/dxfExport'
import { createExportStageProfiler, type ExportWorkerProfile } from '../lib/exportProfile'
import type { DxfPart } from '../lib/dxf'
import { bracePlateNameKey, type PartNameMaps } from '../lib/partNames'

// The DXF-export counterpart to stepExportWorker.ts: builds the same 2D drawings (strut outlines,
// flange plates, brace plates) but, instead of extruding them, reads their outlines back as
// polygons (drawingToPolylines) for the DXF sheet. Brace bodies have no drawing of their own - their
// flat quad comes from the plates' end points, see dxfExportRunner.ts - so this only reports those
// points.

declare const self: DedicatedWorkerGlobalScope

export interface DxfExportRequest {
  strict?: boolean
  partIdLabelSize: number
  connectedPartIdLabelSize: number
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

function toVector3(t: [number, number, number]): THREE.Vector3 { return new THREE.Vector3(...t) }


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
      if (req.strict && !boundary.main) throw new Error(`Cannot construct strut ${req.names.struts[job.index]}.`)
      if (boundary.main) {
        const labels = strutPartLabels(req, job, boundary)
        const strutPlane = computeStrutPlane(posA, posB, center)
        const endA = projectToPlane2D(posA, strutPlane)
        const endB = projectToPlane2D(posB, strutPlane)
        const domeCenter = projectToPlane2D(center, strutPlane)
        parts.push({
          ...labels,
          kind: 'strut',
          loops: timed('outlineToPolylines', () => drawingToPolylines(boundary.main!)),
          strutPath: { endA, endB, middle: arcPoint2(endA, endB, domeCenter, 0.5) },
        })
      }
    } catch (err) {
      if (req.strict) throw new Error(`Cannot export strut ${req.names.struts[job.index]}: ${String(err)}`)
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
          name: req.names.bracePlates[bracePlateNameKey(brace.braceId, job.index, end)],
          kind: 'brace-plate',
          loops: timed('outlineToPolylines', () => drawingToPolylines(plate)),
          labelAngleDeg: ends ? angleDegOf(pointTuple(ends[0]), pointTuple(ends[1])) + 90 : undefined,
        })
      } catch (err) {
        if (req.strict) throw new Error(`Cannot export brace plate ${brace.braceId} for edge ${job.index}: ${String(err)}`)
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
      if (!boundary.main) {
        if (req.strict) throw new Error(`Cannot construct ${side} flange for vertex ${vertex.vertexId}.`)
        continue
      }
      try {
        parts.push({
          ...flangePartLabels(req, vertex, side, boundary),
          kind: 'flange',
          loops: timed('outlineToPolylines', () => drawingToPolylines(boundary.main!)),
        })
      } catch (err) {
        if (req.strict) throw new Error(`Cannot export ${side} flange for vertex ${vertex.vertexId}: ${String(err)}`)
        console.error(`Failed to read ${side} flange outline for vertex ${vertex.vertexId}`, err)
      }
    }

    const foot = vertex.foot
    if (foot) {
      try {
        const boundary = timed('footBoundary2D', () => computeFootPartBoundary2D(foot, req.halfWidth * 2, req.grooveDepth))
        if (req.strict && !boundary.main) throw new Error('Cannot construct foot outline.')
        if (boundary.main) {
          parts.push({
            ...footPartLabels(req, vertex.vertexId),
            kind: 'foot',
            loops: timed('outlineToPolylines', () => drawingToPolylines(boundary.main!)),
          })
        }
      } catch (err) {
        if (req.strict) throw new Error(`Cannot export foot for vertex ${vertex.vertexId}: ${String(err)}`)
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
