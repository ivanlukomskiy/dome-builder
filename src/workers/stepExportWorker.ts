/// <reference lib="webworker" />
import * as THREE from 'three'
import { computeStrutPlane } from '../lib/strutGeometry'
import { computeStrutBoundaryManual } from '../lib/strutGeometryManual'
import { computeFlangeBoundary2D, type FlangeShapeParams } from '../lib/flangeGeometry'
import type { VertexEdgesInfo } from '../lib/edgesInfo'
import type { StrutGeometryEntry } from '../lib/previewBuildInputs'

// The STEP-export counterpart to previewBuilder.worker.ts: same per-edge/per-vertex 2D drawing
// and solid-building steps, but each solid is exported as a STEP file Blob (buildStrutStepFromDrawing)
// instead of tessellated for rendering - see App.tsx's "Download STEP Archive", which zips
// everything this returns into one file. Kept as its own worker (rather than a mode flag on
// previewBuilder.worker.ts) so the live Preview path stays untouched by this one.

declare const self: DedicatedWorkerGlobalScope

export interface StepExportRequest {
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
  // Uniform scale factor (1 = no change) applied to every exported solid - see
  // buildStrutStepFromDrawing in replicadCad.ts.
  scale: number
}

export interface StepExportPiece {
  name: string
  blob: Blob
}

export type StepExportPhase = 'struts' | 'flanges'

export type StepExportWorkerMessage =
  | { type: 'progress'; requestId: number; phase: StepExportPhase; done: number; total: number }
  | { type: 'result'; requestId: number; pieces: StepExportPiece[] }
  | { type: 'error'; requestId: number; message: string }

function toVector3(t: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(t[0], t[1], t[2])
}

async function buildStepExports(req: StepExportRequest): Promise<StepExportPiece[]> {
  const { ensureReplicadReady, buildStrutStepFromDrawing } = await import('../lib/replicadCad')
  await ensureReplicadReady()

  const center = new THREE.Vector3(0, req.centerY, 0)
  const pieces: StepExportPiece[] = []

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
    )
    self.postMessage({
      type: 'progress',
      requestId: req.requestId,
      phase: 'struts',
      done: i + 1,
      total: req.strutJobs.length,
    } satisfies StepExportWorkerMessage)
    if (!boundary.main) return

    try {
      const plane = computeStrutPlane(posA, posB, center)
      const blob = buildStrutStepFromDrawing(boundary.main, plane, job.beamThickness, req.scale)
      if (!blob) return
      pieces.push({ name: `strut-${job.index}.step`, blob })
    } catch (err) {
      console.error(`Failed to export strut solid for edge ${job.index}`, err)
    }
  })

  // Same plate placement as previewBuilder.worker.ts - see its own comment for the geometry.
  const flangeSpan = req.halfWidth - req.grooveDepth / 2

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
    } satisfies StepExportWorkerMessage)
    if (!boundary.main) return

    const vertexPos = toVector3(vertex.position)
    const normal = toVector3(vertex.tangentPlane.normal)
    const xDir = toVector3(vertex.tangentPlane.e1)

    try {
      const sides: { sign: 1 | -1; label: string }[] = [
        { sign: 1, label: 'outer' },
        { sign: -1, label: 'inner' },
      ]
      for (const { sign, label } of sides) {
        const plane = {
          origin: vertexPos.clone().addScaledVector(normal, sign * flangeSpan),
          normal,
          xDir,
        }
        const blob = buildStrutStepFromDrawing(boundary.main, plane, req.grooveDepth, req.scale)
        if (!blob) continue
        pieces.push({ name: `flange-${vertex.vertexId}-${label}.step`, blob })
      }
    } catch (err) {
      console.error(`Failed to export flange solid for vertex ${vertex.vertexId}`, err)
    }
  })

  return pieces
}

self.onmessage = (event: MessageEvent<StepExportRequest>) => {
  const req = event.data
  buildStepExports(req).then(
    (pieces) => {
      self.postMessage({ type: 'result', requestId: req.requestId, pieces } satisfies StepExportWorkerMessage)
    },
    (err: unknown) => {
      self.postMessage({
        type: 'error',
        requestId: req.requestId,
        message: err instanceof Error ? err.message : String(err),
      } satisfies StepExportWorkerMessage)
    },
  )
}
