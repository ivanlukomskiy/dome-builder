/// <reference lib="webworker" />
import * as THREE from 'three'
import { computeStrutPlane } from '../lib/strutGeometry'
import { computeStrutBoundaryManual } from '../lib/strutGeometryManual'
import { computeFlangeBoundary2D, type FlangeShapeParams } from '../lib/flangeGeometry'
import type { VertexEdgesInfo } from '../lib/edgesInfo'
import type { StrutGeometryEntry } from '../lib/previewBuildInputs'
import { bracePlateEndPoints3D } from '../lib/braces'
import type { BracePoints } from '../lib/braceSolid'
import { drawingToPolylines } from '../lib/dxfExport'
import type { DxfPart } from '../lib/dxf'

// The DXF-export counterpart to stepExportWorker.ts: builds the same 2D drawings (strut outlines,
// flange plates, brace plates) but, instead of extruding them, reads their outlines back as
// polygons (drawingToPolylines) for the DXF sheet. Brace bodies have no drawing of their own - their
// flat quad comes from the plates' end points, see dxfExportRunner.ts - so this only reports those
// points.

declare const self: DedicatedWorkerGlobalScope

export interface DxfExportRequest {
  requestId: number
  centerY: number
  strutJobs: StrutGeometryEntry[]
  cornerLength: number
  halfWidth: number
  endGrooveLengthPercent: number
  midGrooveLengthPercent: number
  grooveDepth: number
  millingDiameter: number
  chamferLength: number
  vertices: VertexEdgesInfo[]
  flangeParams: FlangeShapeParams
}

export type DxfExportPhase = 'struts' | 'flanges'

export type DxfExportWorkerMessage =
  | { type: 'progress'; requestId: number; phase: DxfExportPhase; done: number; total: number }
  | { type: 'result'; requestId: number; parts: DxfPart[]; bracePoints: BracePoints[] }
  | { type: 'error'; requestId: number; message: string }

function toVector3(t: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(t[0], t[1], t[2])
}

async function buildDxfParts(req: DxfExportRequest): Promise<{ parts: DxfPart[]; bracePoints: BracePoints[] }> {
  const { ensureReplicadReady } = await import('../lib/replicadCad')
  await ensureReplicadReady()

  const center = new THREE.Vector3(0, req.centerY, 0)
  const parts: DxfPart[] = []
  const bracePoints: BracePoints[] = []

  req.strutJobs.forEach((job, i) => {
    const posA = toVector3(job.posA)
    const posB = toVector3(job.posB)
    const boundary = computeStrutBoundaryManual(
      posA,
      posB,
      center,
      job.offsetA,
      job.offsetB,
      req.cornerLength,
      req.halfWidth,
      req.endGrooveLengthPercent,
      req.midGrooveLengthPercent,
      req.grooveDepth,
      req.millingDiameter,
      req.chamferLength,
      job.braces,
    )
    self.postMessage({
      type: 'progress',
      requestId: req.requestId,
      phase: 'struts',
      done: i + 1,
      total: req.strutJobs.length,
    } satisfies DxfExportWorkerMessage)

    try {
      if (boundary.main) parts.push({ name: `strut-${job.index}`, kind: 'strut', loops: drawingToPolylines(boundary.main) })
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
        bracePoints.push({ braceId: brace.braceId, thickness: brace.params.thickness, points: [p.toArray(), q.toArray()] })
      }
      if (!plate) continue
      try {
        parts.push({
          name: `brace-plate-${brace.braceId}-strut-${job.index}-${end}`,
          kind: 'brace-plate',
          loops: drawingToPolylines(plate),
        })
      } catch (err) {
        console.error(`Failed to read brace plate ${brace.braceId} outline for edge ${job.index}`, err)
      }
    }
  })

  req.vertices.forEach((vertex, i) => {
    const boundary = computeFlangeBoundary2D(
      { vertexId: vertex.vertexId, edges: vertex.edges },
      req.flangeParams,
    )
    self.postMessage({
      type: 'progress',
      requestId: req.requestId,
      phase: 'flanges',
      done: i + 1,
      total: req.vertices.length,
    } satisfies DxfExportWorkerMessage)
    if (!boundary.main) return
    try {
      // The outer and inner plate of a vertex share this one shape.
      parts.push({ name: `flange-${vertex.vertexId} (x2)`, kind: 'flange', loops: drawingToPolylines(boundary.main) })
    } catch (err) {
      console.error(`Failed to read flange outline for vertex ${vertex.vertexId}`, err)
    }
  })

  return { parts, bracePoints }
}

self.onmessage = (event: MessageEvent<DxfExportRequest>) => {
  const req = event.data
  buildDxfParts(req).then(
    ({ parts, bracePoints }) => {
      self.postMessage({ type: 'result', requestId: req.requestId, parts, bracePoints } satisfies DxfExportWorkerMessage)
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
