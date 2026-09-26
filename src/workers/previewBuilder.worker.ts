/// <reference lib="webworker" />
import * as THREE from 'three'
import { computeStrutBoundary, computeStrutPlane } from '../lib/strutGeometry'
import { computeFlangeBoundary2D, resolveFlangeParams, type FlangeShapeParams } from '../lib/flangeGeometry'
import { computeFootPartBoundary2D } from '../lib/footGeometry'
import type { VertexEdgesInfo } from '../lib/edgesInfo'
import type { StrutGeometryEntry } from '../lib/previewBuildInputs'
import { bracePlateEndPoints3D, bracePlatePlane, type StrutBraceEnd } from '../lib/braces'
import type { BracePoints } from '../lib/braceSolid'
import type { PreviewPartKind } from '../lib/previewParts'
import type { Drawing } from 'replicad'
import { createWorkerProfiler, type WorkerProfile } from '../lib/previewProfile'
import { installReplicadProfiler, snapshotReplicadStats } from '../lib/replicadProfiler'

// Owns every heavy, WASM-backed step of building the Preview solids: the 2D shoulder-tenon and
// flange-plate drawings (computeStrutBoundary/computeFlangeBoundary2D - both build their
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
const FOOT_COLOR: [number, number, number] = [0.753, 0.518, 0.961]

export interface StrutBuildJob extends StrutGeometryEntry {
  color: [number, number, number]
}

export interface PreviewBuildRequest {
  requestId: number
  strutJobs: StrutBuildJob[]
  halfWidth: number
  endGrooveLengthPercent: number
  midGrooveLengthPercent: number
  grooveDepth: number
  millingDiameter: number
  chamferLength: number
  // Flanges to build, one per group of identical hubs (see flangeInstances.ts) - the main thread
  // places the resulting mesh at every vertex of the group.
  flangeJobs: FlangeBuildJob[]
  // Separate foot parts, one at each foot vertex. These are built directly in world space because
  // their plane depends on the vertex normal and projected foot axis.
  footJobs: FootBuildJob[]
  flangeParams: FlangeShapeParams
  // Opt-in profiling (see previewProfile.ts): the worker times its steps and returns them.
  profile?: boolean
}

export interface FlangeBuildJob {
  // Signature of the group this flange stands for - echoed back so the main thread can match it.
  key: string
  vertex: VertexEdgesInfo
}

export interface FootBuildJob {
  vertex: VertexEdgesInfo
}

// One flange plate, meshed in the canonical local frame (origin at 0, normal +z, xDir +x, extrusion
// centered on z = 0). `mesh` is null when the outline came out empty.
export interface FlangeMeshResult {
  key: string
  mesh: { positions: Float32Array; normals: Float32Array; indices: Uint32Array } | null
}

export interface PreviewPiece {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  color: [number, number, number]
  // Which kind of part this is - each kind is drawn as its own mesh (see previewParts.ts).
  part: PreviewPartKind
}

export type PreviewBuildPhase = 'struts' | 'flanges' | 'foot'

export type PreviewWorkerMessage =
  | { type: 'ready'; requestId: number }
  | { type: 'progress'; requestId: number; phase: PreviewBuildPhase; done: number; total: number }
  | {
      type: 'result'
      requestId: number
      pieces: PreviewPiece[]
      bracePoints: BracePoints[]
      flangeMeshes: FlangeMeshResult[]
      profile?: WorkerProfile
    }
  | { type: 'error'; requestId: number; message: string }

function toVector3(t: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(t[0], t[1], t[2])
}

function footPartPlane(vertex: VertexEdgesInfo) {
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

async function buildPreview(
  req: PreviewBuildRequest,
): Promise<{
  pieces: PreviewPiece[]
  bracePoints: BracePoints[]
  flangeMeshes: FlangeMeshResult[]
  profile?: WorkerProfile
}> {
  const prof = req.profile ? createWorkerProfiler() : null
  // Runs a step, timing it when profiling; returns the same value either way.
  const timed = <T>(label: string, fn: () => T): T => (prof ? prof.time(label, fn) : fn())
  const lastMs = () => prof?.lastMs ?? 0

  const initStart = performance.now()
  const { ensureReplicadReady, buildStrutMeshFromDrawing } = await import('../lib/replicadCad')
  await ensureReplicadReady()
  if (prof) installReplicadProfiler()
  const initMs = performance.now() - initStart
  const buildStart = performance.now()
  self.postMessage({ type: 'ready', requestId: req.requestId } satisfies PreviewWorkerMessage)

  const center = new THREE.Vector3(0, 0, 0)
  const pieces: PreviewPiece[] = []
  // Each strut's brace plate end points, in 3D - the main thread pairs them up per brace and builds
  // the brace solids (see braceSolid.ts).
  const bracePoints: BracePoints[] = []

  req.strutJobs.forEach((job, i) => {
    const posA = toVector3(job.posA)
    const posB = toVector3(job.posB)
    const boundary = timed('strutBoundary2D', () =>
      computeStrutBoundary(
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
      ),
    )
    const strutBoundaryMs = lastMs()
    let strutSolidMs = 0
    self.postMessage({
      type: 'progress',
      requestId: req.requestId,
      phase: 'struts',
      done: i + 1,
      total: req.strutJobs.length,
    } satisfies PreviewWorkerMessage)
    const plane = computeStrutPlane(posA, posB, center)

    const mainDrawing = boundary.main
    if (mainDrawing) {
      try {
        const strut = timed('strutSolid (sketch+extrude+mesh)', () =>
          buildStrutMeshFromDrawing(mainDrawing, plane, job.beamThickness),
        )
        strutSolidMs += lastMs()
        if (strut) {
          pieces.push({ positions: strut.positions, normals: strut.normals, indices: strut.indices, color: job.color, part: 'struts' })
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
        const mesh = timed('bracePlateSolid', () =>
          buildStrutMeshFromDrawing(plate, bracePlatePlane(plane, job.beamThickness, brace), brace.params.plateThickness),
        )
        strutSolidMs += lastMs()
        if (mesh) {
          pieces.push({ positions: mesh.positions, normals: mesh.normals, indices: mesh.indices, color: BRACE_PLATE_COLOR, part: 'bracePlates' })
        }
      } catch (err) {
        console.error(`Failed to build brace plate ${brace.braceId} for edge ${job.index}`, err)
      }
    }
    prof?.items.push({ kind: 'strut', id: job.index, boundaryMs: strutBoundaryMs, solidMs: strutSolidMs })
  })

  // Each flange is built once, in the canonical local frame, as a plate `grooveDepth` thick
  // centered on z = 0 (`buildStrutMeshFromDrawing` centers its extrusion on the plane it's given).
  // The main thread then places it on every vertex it stands for - two plates each, seated flush
  // in the shoulder notch cut into the struts' own ends, one with its outer face level with the
  // struts' outer surface (halfWidth from the vertex), the other with its inner face level with
  // their inner surface - see DomeMesh.tsx.
  const localPlane = {
    origin: new THREE.Vector3(0, 0, 0),
    normal: new THREE.Vector3(0, 0, 1),
    xDir: new THREE.Vector3(1, 0, 0),
  }
  const flangeMeshes: FlangeMeshResult[] = []

  req.flangeJobs.forEach((job, i) => {
    const { vertex } = job
    const boundary = timed('flangeBoundary2D', () =>
      computeFlangeBoundary2D(
        { vertexId: vertex.vertexId, edges: vertex.edges, foot: vertex.foot },
        resolveFlangeParams(req.flangeParams, vertex.flangeOverrides),
      ),
    )
    const flangeBoundaryMs = lastMs()
    self.postMessage({
      type: 'progress',
      requestId: req.requestId,
      phase: 'flanges',
      done: i + 1,
      total: req.flangeJobs.length,
    } satisfies PreviewWorkerMessage)

    const flangeDrawing = boundary.main
    if (!flangeDrawing) {
      flangeMeshes.push({ key: job.key, mesh: null })
      prof?.items.push({ kind: 'flange', id: vertex.vertexId, boundaryMs: flangeBoundaryMs, solidMs: 0 })
      return
    }

    let mesh: FlangeMeshResult['mesh'] = null
    let flangeSolidMs = 0
    try {
      mesh = timed('flangeSolid (sketch+extrude+mesh)', () =>
        buildStrutMeshFromDrawing(flangeDrawing, localPlane, req.grooveDepth),
      )
      flangeSolidMs = lastMs()
    } catch (err) {
      console.error(`Failed to build flange solid for vertex ${vertex.vertexId}`, err)
    }
    flangeMeshes.push({ key: job.key, mesh })
    prof?.items.push({ kind: 'flange', id: vertex.vertexId, boundaryMs: flangeBoundaryMs, solidMs: flangeSolidMs })
  })

  req.footJobs.forEach((job, i) => {
    const { vertex } = job
    const foot = vertex.foot
    if (!foot) return

    const boundary = timed('footBoundary2D', () =>
      computeFootPartBoundary2D(foot, req.halfWidth * 2, req.grooveDepth),
    )
    self.postMessage({
      type: 'progress',
      requestId: req.requestId,
      phase: 'foot',
      done: i + 1,
      total: req.footJobs.length,
    } satisfies PreviewWorkerMessage)

    const drawing = boundary.main
    const plane = footPartPlane(vertex)
    if (!drawing || !plane || foot.thickness <= 0) return

    try {
      const mesh = timed('footSolid (sketch+extrude+mesh)', () =>
        buildStrutMeshFromDrawing(drawing, plane, foot.thickness),
      )
      if (mesh) pieces.push({ ...mesh, color: FOOT_COLOR, part: 'foot' })
    } catch (err) {
      console.error(`Failed to build foot solid for vertex ${vertex.vertexId}`, err)
    }
  })

  const profile: WorkerProfile | undefined = prof
    ? {
        initMs,
        buildMs: performance.now() - buildStart,
        stages: prof.stages,
        items: prof.items,
        replicad: snapshotReplicadStats(),
      }
    : undefined
  return { pieces, bracePoints, flangeMeshes, profile }
}

self.onmessage = (event: MessageEvent<PreviewBuildRequest>) => {
  const req = event.data
  buildPreview(req).then(
    ({ pieces, bracePoints, flangeMeshes, profile }) => {
      const transfer: Transferable[] = []
      for (const p of pieces) transfer.push(p.positions.buffer, p.normals.buffer, p.indices.buffer)
      for (const f of flangeMeshes) {
        if (f.mesh) transfer.push(f.mesh.positions.buffer, f.mesh.normals.buffer, f.mesh.indices.buffer)
      }
      self.postMessage({ type: 'result', requestId: req.requestId, pieces, bracePoints, flangeMeshes, profile } satisfies PreviewWorkerMessage, {
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
