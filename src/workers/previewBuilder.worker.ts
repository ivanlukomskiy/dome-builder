/// <reference lib="webworker" />
import * as THREE from 'three'
import { computeStrutPlane } from '../lib/strutGeometry'
import { computeStrutBoundaryManual } from '../lib/strutGeometryManual'
import { computeFlangeBoundary2D, type FlangeShapeParams } from '../lib/flangeGeometry'
import type { VertexEdgesInfo } from '../lib/edgesInfo'
import type { StrutGeometryEntry } from '../lib/previewBuildInputs'
import { bracePlateEndPoints3D, bracePlatePlane, type StrutBraceEnd } from '../lib/braces'
import type { BracePoints } from '../lib/braceSolid'
import type { Drawing } from 'replicad'

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

// Same magenta the brace lines are drawn in in Edit mode.
const BRACE_PLATE_COLOR: [number, number, number] = [0.878, 0.353, 0.816]

export interface StrutBuildJob extends StrutGeometryEntry {
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
  | { type: 'result'; requestId: number; pieces: PreviewPiece[]; bracePoints: BracePoints[] }
  | { type: 'error'; requestId: number; message: string }

function toVector3(t: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(t[0], t[1], t[2])
}

async function buildPreview(
  req: PreviewBuildRequest,
): Promise<{ pieces: PreviewPiece[]; bracePoints: BracePoints[] }> {
  const { ensureReplicadReady, buildStrutMeshFromDrawing } = await import('../lib/replicadCad')
  await ensureReplicadReady()
  self.postMessage({ type: 'ready', requestId: req.requestId } satisfies PreviewWorkerMessage)

  const center = new THREE.Vector3(0, req.centerY, 0)
  const pieces: PreviewPiece[] = []
  // Each strut's brace plate end points, in 3D - the main thread pairs them up per brace and builds
  // the brace solids (see braceSolid.ts).
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
    } satisfies PreviewWorkerMessage)
    const plane = computeStrutPlane(posA, posB, center)

    if (boundary.main) {
      try {
        const strut = buildStrutMeshFromDrawing(boundary.main, plane, job.beamThickness)
        if (strut) {
          pieces.push({ positions: strut.positions, normals: strut.normals, indices: strut.indices, color: job.color })
        }
      } catch (err) {
        console.error(`Failed to build strut solid for edge ${job.index}`, err)
      }
    }

    // Each brace plate sits against the strut's side face, on the side its brace's other edge is
    // on, and sticks out `plateThickness` from it (see bracePlatePlane).
    const plates: [Drawing | null, StrutBraceEnd | undefined][] = [
      [boundary.bracePlateA, job.braces.a[0]],
      [boundary.bracePlateB, job.braces.b[0]],
    ]
    const plateEnds = [boundary.bracePlateEndsA, boundary.bracePlateEndsB]
    plates.forEach(([, brace], k) => {
      const ends = plateEnds[k]
      if (!brace || !ends) return
      const [p, q] = bracePlateEndPoints3D(plane, job.beamThickness, brace, ends)
      bracePoints.push({
        braceId: brace.braceId,
        edgeId: job.index,
        thickness: brace.params.thickness,
        points: [p.toArray(), q.toArray()],
      })
    })
    for (const [plate, brace] of plates) {
      if (!plate || !brace || brace.params.plateThickness <= 0) continue
      try {
        const mesh = buildStrutMeshFromDrawing(
          plate,
          bracePlatePlane(plane, job.beamThickness, brace),
          brace.params.plateThickness,
        )
        if (mesh) {
          pieces.push({ positions: mesh.positions, normals: mesh.normals, indices: mesh.indices, color: BRACE_PLATE_COLOR })
        }
      } catch (err) {
        console.error(`Failed to build brace plate ${brace.braceId} for edge ${job.index}`, err)
      }
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

  return { pieces, bracePoints }
}

self.onmessage = (event: MessageEvent<PreviewBuildRequest>) => {
  const req = event.data
  buildPreview(req).then(
    ({ pieces, bracePoints }) => {
      const transfer: Transferable[] = []
      for (const p of pieces) transfer.push(p.positions.buffer, p.normals.buffer, p.indices.buffer)
      self.postMessage({ type: 'result', requestId: req.requestId, pieces, bracePoints } satisfies PreviewWorkerMessage, {
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
