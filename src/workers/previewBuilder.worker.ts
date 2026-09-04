/// <reference lib="webworker" />
import * as THREE from 'three'
import { computeStrutPlane } from '../lib/strutGeometry'
import { computeStrutBoundaryManual } from '../lib/strutGeometryManual'
import { computeFlangeBoundary2D, type FlangeShapeParams } from '../lib/flangeGeometry'
import type { VertexEdgesInfo } from '../lib/edgesInfo'

// Owns every heavy, WASM-backed step of building the Preview solids: the 2D shoulder-tenon and
// flange-plate drawings (computeStrutBoundaryManual/computeFlangeBoundary2D - both build their
// outline via replicad's own draw()/.fuse()/.cut() primitives, which are backed by opencascade's
// 2D boolean ops, not plain JS math) and the extrude+mesh step that turns each into a solid
// (buildStrutMeshFromDrawing). All of that needs `ensureReplicadReady()`'s WASM module loaded
// first, and running it here - off the main thread - keeps the tab responsive while it works and
// lets us reclaim its (substantial) opencascade heap by simply terminating this worker once a
// build finishes, rather than trying to track down every individual .delete() call.
//
// Everything cheap and DOM/WASM-free (which edges/vertices are visible, their offsets, the
// tangent-plane angle math in edgesInfo.ts) stays on the main thread (see DomeMesh.tsx) and is
// handed in here as plain, already-resolved data - this file only does the parts that actually
// need opencascade.

declare const self: DedicatedWorkerGlobalScope

export interface StrutBuildJob {
  index: number
  posA: [number, number, number]
  posB: [number, number, number]
  offsetA: number
  offsetB: number
  beamThickness: number
  color: [number, number, number]
}

export interface PreviewBuildRequest {
  requestId: number
  centerY: number
  strutJobs: StrutBuildJob[]
  cornerLength: number
  halfWidth: number
  endGrooveLengthPercent: number
  midGrooveLengthPercent: number
  grooveDepth: number
  millingDiameter: number
  chamferLength: number
  vertices: VertexEdgesInfo[]
  flangeParams: FlangeShapeParams
  flangeColor: [number, number, number]
}

export interface PreviewPiece {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  color: [number, number, number]
}

export type PreviewBuildPhase = 'struts' | 'flanges'

export type PreviewWorkerMessage =
  | { type: 'ready'; requestId: number }
  | { type: 'progress'; requestId: number; phase: PreviewBuildPhase; done: number; total: number }
  | { type: 'result'; requestId: number; pieces: PreviewPiece[] }
  | { type: 'error'; requestId: number; message: string }

function toVector3(t: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(t[0], t[1], t[2])
}

async function buildPreview(req: PreviewBuildRequest): Promise<PreviewPiece[]> {
  const { ensureReplicadReady, buildStrutMeshFromDrawing } = await import('../lib/replicadCad')
  await ensureReplicadReady()
  self.postMessage({ type: 'ready', requestId: req.requestId } satisfies PreviewWorkerMessage)

  const center = new THREE.Vector3(0, req.centerY, 0)
  const pieces: PreviewPiece[] = []

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
    } satisfies PreviewWorkerMessage)
    if (!boundary.main) return

    try {
      const plane = computeStrutPlane(posA, posB, center)
      const strut = buildStrutMeshFromDrawing(boundary.main, plane, job.beamThickness)
      if (!strut) return
      pieces.push({ positions: strut.positions, normals: strut.normals, indices: strut.indices, color: job.color })
    } catch (err) {
      console.error(`Failed to build strut solid for edge ${job.index}`, err)
    }
  })

  // Each flange plate is `grooveDepth` thick and seated flush in the shoulder notch cut into the
  // struts' own ends - one plate's outer face level with the struts' own outer surface
  // (halfWidth from the vertex), the other's inner face level with their inner surface, both
  // parallel to the vertex's own tangent plane. `buildStrutMeshFromDrawing` centers its extrusion
  // on the plane it's given, so each plane sits at the midpoint of its plate's span -
  // `halfWidth - grooveDepth / 2` out from the vertex, one on either side. See DomeMesh.tsx.
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
    } satisfies PreviewWorkerMessage)
    if (!boundary.main) return

    const vertexPos = toVector3(vertex.position)
    const normal = toVector3(vertex.tangentPlane.normal)
    const xDir = toVector3(vertex.tangentPlane.e1)

    try {
      for (const sign of [1, -1] as const) {
        const plane = {
          origin: vertexPos.clone().addScaledVector(normal, sign * flangeSpan),
          normal,
          xDir,
        }
        const flange = buildStrutMeshFromDrawing(boundary.main, plane, req.grooveDepth)
        if (!flange) continue
        pieces.push({
          positions: flange.positions,
          normals: flange.normals,
          indices: flange.indices,
          color: req.flangeColor,
        })
      }
    } catch (err) {
      console.error(`Failed to build flange solid for vertex ${vertex.vertexId}`, err)
    }
  })

  return pieces
}

self.onmessage = (event: MessageEvent<PreviewBuildRequest>) => {
  const req = event.data
  buildPreview(req).then(
    (pieces) => {
      const transfer: Transferable[] = []
      for (const p of pieces) transfer.push(p.positions.buffer, p.normals.buffer, p.indices.buffer)
      self.postMessage({ type: 'result', requestId: req.requestId, pieces } satisfies PreviewWorkerMessage, {
        transfer,
      })
    },
    (err: unknown) => {
      self.postMessage({
        type: 'error',
        requestId: req.requestId,
        message: err instanceof Error ? err.message : String(err),
      } satisfies PreviewWorkerMessage)
    },
  )
}
