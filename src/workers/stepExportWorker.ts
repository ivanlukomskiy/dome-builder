/// <reference lib="webworker" />
import * as THREE from 'three'
import { computeStrutBoundary, computeStrutPlane } from '../lib/strutGeometry'
import { computeFlangeBoundary2D, resolveFlangeParams, type FlangeShapeParams, type FlangeSide } from '../lib/flangeGeometry'
import type { VertexEdgesInfo } from '../lib/edgesInfo'
import type { StrutGeometryEntry } from '../lib/previewBuildInputs'
import { bracePlateEndPoints3D, bracePlatePlane, type StrutBraceEnd } from '../lib/braces'
import { braceQuadFrame, braceQuadPoints2D, pairBracePoints, type BraceBody, type BracePoints } from '../lib/braceSolid'
import { draw, type Drawing } from 'replicad'
import type { StepAssemblyShape, StrutPlane } from '../lib/replicadCad'

// The STEP-export counterpart to previewBuilder.worker.ts: same per-edge/per-vertex 2D drawing
// and solid-building steps, but each solid is exported as a STEP file Blob (buildStrutStepFromDrawing)
// instead of tessellated for rendering - see App.tsx's "Download STEP Archive", which zips
// everything this returns into one file. Kept as its own worker (rather than a mode flag on
// previewBuilder.worker.ts) so the live Preview path stays untouched by this one.

declare const self: DedicatedWorkerGlobalScope

export interface StepExportRequest {
  requestId: number
  mode?: 'archive' | 'assembly'
  strutJobs: StrutGeometryEntry[]
  // Brace bodies to export (see braceSolid.ts's pairBracePoints) - a batch of these is all a
  // 'braces' worker does, and strutJobs/vertices are empty then.
  braceBodies: BraceBody[]
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

export type StepExportPhase = 'struts' | 'flanges' | 'braces'
export type StepExportWorkerPhase = StepExportPhase | 'writing'

export type StepExportWorkerMessage =
  | { type: 'progress'; requestId: number; phase: StepExportWorkerPhase; done: number; total: number }
  | { type: 'result'; requestId: number; pieces: StepExportPiece[]; bracePoints: BracePoints[]; assemblyBlob?: Blob }
  | { type: 'error'; requestId: number; message: string }

function toVector3(t: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(t[0], t[1], t[2])
}

async function buildStepExports(
  req: StepExportRequest,
): Promise<{ pieces: StepExportPiece[]; bracePoints: BracePoints[]; assemblyBlob?: Blob }> {
  const { ensureReplicadReady, buildStepAssembly, buildStrutSolidFromDrawing } = await import('../lib/replicadCad')
  await ensureReplicadReady()

  const center = new THREE.Vector3(0, 0, 0)
  const pieces: StepExportPiece[] = []
  const assemblyShapes: StepAssemblyShape[] = []
  // Each strut's brace plate end points in 3D, for the caller to pair up into brace bodies.
  const bracePoints: BracePoints[] = []
  const mode = req.mode ?? 'archive'

  const addStepShape = (name: string, drawing: Drawing, plane: StrutPlane, thickness: number) => {
    const solid = buildStrutSolidFromDrawing(drawing, plane, thickness, req.scale)
    if (!solid) return
    if (mode === 'assembly') {
      assemblyShapes.push({ name, shape: solid })
      return
    }

    const blob = solid.blobSTEP()
    solid.delete()
    if (blob) pieces.push({ name, blob })
  }

  req.strutJobs.forEach((job, i) => {
    const posA = toVector3(job.posA)
    const posB = toVector3(job.posB)
    const boundary = computeStrutBoundary(
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
    )
    self.postMessage({
      type: 'progress',
      requestId: req.requestId,
      phase: 'struts',
      done: i + 1,
      total: req.strutJobs.length,
    } satisfies StepExportWorkerMessage)
    const plane = computeStrutPlane(posA, posB, center)

    if (boundary.main) {
      try {
        addStepShape(`strut-${job.index}.step`, boundary.main, plane, job.beamThickness)
      } catch (err) {
        console.error(`Failed to export strut solid for edge ${job.index}`, err)
      }
    }

    // Brace plates: same placement as previewBuilder.worker.ts (bracePlatePlane).
    const plates: [Drawing | null, StrutBraceEnd | undefined, 'A' | 'B', [number, number][] | null][] = [
      [boundary.bracePlateA, job.braces.a[0], 'A', boundary.bracePlateEndsA],
      [boundary.bracePlateB, job.braces.b[0], 'B', boundary.bracePlateEndsB],
    ]
    for (const [plate, brace, end, ends] of plates) {
      if (!brace) continue
      if (ends) {
        const [p, q] = bracePlateEndPoints3D(plane, job.beamThickness, brace, [ends[0], ends[1]])
        bracePoints.push({ braceId: brace.braceId, edgeId: job.index, thickness: brace.params.thickness, points: [p.toArray(), q.toArray()] })
      }
      if (!plate || brace.params.plateThickness <= 0) continue
      try {
        addStepShape(
          `brace-plate-${brace.braceId}-strut-${job.index}-${end}.step`,
          plate,
          bracePlatePlane(plane, job.beamThickness, brace),
          brace.params.plateThickness,
        )
      } catch (err) {
        console.error(`Failed to export brace plate ${brace.braceId} for edge ${job.index}`, err)
      }
    }
  })

  // Same plate placement as previewBuilder.worker.ts - see its own comment for the geometry.
  const flangeSpan = req.halfWidth - req.grooveDepth / 2

  req.vertices.forEach((vertex, i) => {
    const flangeParams = resolveFlangeParams(req.flangeParams, vertex.flangeOverrides)
    self.postMessage({
      type: 'progress',
      requestId: req.requestId,
      phase: 'flanges',
      done: i + 1,
      total: req.vertices.length,
    } satisfies StepExportWorkerMessage)

    const vertexPos = toVector3(vertex.position)
    const normal = toVector3(vertex.tangentPlane.normal)
    const xDir = toVector3(vertex.tangentPlane.e1)

    try {
      const sides: { sign: 1 | -1; side: FlangeSide }[] = [
        { sign: 1, side: 'outer' },
        { sign: -1, side: 'inner' },
      ]
      for (const { sign, side } of sides) {
        const boundary = computeFlangeBoundary2D(
          { vertexId: vertex.vertexId, edges: vertex.edges, foot: vertex.foot },
          flangeParams,
          side,
        )
        if (!boundary.main) continue
        const plane = {
          origin: vertexPos.clone().addScaledVector(normal, sign * flangeSpan),
          normal,
          xDir,
        }
        addStepShape(`flange-${vertex.vertexId}-${side}.step`, boundary.main, plane, req.grooveDepth)
      }
    } catch (err) {
      console.error(`Failed to export flange solid for vertex ${vertex.vertexId}`, err)
    }
  })

  // Brace bodies: the quadrilateral through the plates' end points, extruded symmetrically.
  const braceBodies = mode === 'assembly' ? pairBracePoints(bracePoints) : req.braceBodies
  braceBodies.forEach((body, i) => {
    self.postMessage({
      type: 'progress',
      requestId: req.requestId,
      phase: 'braces',
      done: i + 1,
      total: braceBodies.length,
    } satisfies StepExportWorkerMessage)
    if (!(body.thickness > 0)) return
    try {
      const frame = braceQuadFrame(body.a, body.b)
      if (!frame) return
      const [first, ...rest] = braceQuadPoints2D(frame)
      let outline = draw(first)
      for (const pt of rest) outline = outline.lineTo(pt)
      addStepShape(`brace-${body.braceId}.step`, outline.close(), frame.plane, body.thickness)
    } catch (err) {
      console.error(`Failed to export brace ${body.braceId}`, err)
    }
  })

  if (mode !== 'assembly') return { pieces, bracePoints }

  try {
    self.postMessage({
      type: 'progress',
      requestId: req.requestId,
      phase: 'writing',
      done: 0,
      total: assemblyShapes.length,
    } satisfies StepExportWorkerMessage)
    const assemblyBlob = buildStepAssembly(assemblyShapes)
    return { pieces, bracePoints, assemblyBlob }
  } finally {
    for (const { shape } of assemblyShapes) shape.delete()
  }
}

self.onmessage = (event: MessageEvent<StepExportRequest>) => {
  const req = event.data
  buildStepExports(req).then(
    ({ pieces, bracePoints, assemblyBlob }) => {
      self.postMessage({ type: 'result', requestId: req.requestId, pieces, bracePoints, assemblyBlob } satisfies StepExportWorkerMessage)
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
