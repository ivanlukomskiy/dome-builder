import * as THREE from 'three'
import type { Edge, Face, PolyhedronData } from './polyhedra'
import {
  computeVertexHubMetrics,
  computeVisibleVertexEdges,
  computeVisibleVertexIds,
  resolveVertexPosition,
} from './polyhedra'
import { add2, sub2, scale2, dot2, cross2, length2, normalize2 } from './vec2'

// Pure 2D math for a single flat "meridian" plane - the plane through an edge's two vertices
// and the gravity center. Kept dependency-free (no replicad/WASM) so it's easy to reason about
// and test; `replicadCad.ts` is the only place that turns this into an actual solid.

export type Vec2 = [number, number]

const EPS = 1e-9

// Rotates a 2D vector by 90 degrees - used as a fallback tangent direction when the direct
// computation is degenerate.
function perp2(a: Vec2): Vec2 {
  return [-a[1], a[0]]
}

// The tangent direction at `from`, in the plane's local coordinates (where the gravity center
// sits at the origin), leaning as much as possible toward `toward` - i.e. the component of
// (toward - from) perpendicular to the radius from the origin to `from`. Mirrors the 3D
// `tangentDirection` this replaces, just expressed in-plane where the center is the origin.
function tangentDirection2D(from: Vec2, toward: Vec2): Vec2 {
  const radial = normalize2(from)
  const alongEdge = sub2(toward, from)
  let tangent = sub2(alongEdge, scale2(radial, dot2(alongEdge, radial)))
  if (length2(tangent) < EPS) tangent = perp2(radial)
  return normalize2(tangent)
}

export interface ToothParams {
  // A tooth only appears where its budget fits and this is positive - 0 (or too little room
  // along the lead-in) falls back to the plain straight line, so this doubles as an on/off
  // switch.
  height: number
  length: number
  chamfer: number
  millRadius: number
}

// The via point for a semicircular arc of radius `r`, centered at `center`, bulging toward unit
// direction `bulgeDir`.
function semicircleVia(center: Vec2, bulgeDir: Vec2, r: number): Vec2 {
  return add2(center, scale2(bulgeDir, r))
}

// A straight boundary run (from -> to) with a rectangular interlocking tooth cut into its
// middle: straight flanks rising the full `height` perpendicular to `tangent` from each (still
// sharp) base corner, a flat top `length` wide and exactly parallel to `tangent`, a chamfer
// clipping each of the tooth's two (convex) top corners, and - at each of the tooth's two
// (concave) base corners - a semicircular "dogbone"/"T-bone" mill relief cut into the main line
// just before the corner, rather than rounding the corner itself: one end of the semicircle
// sits exactly on the (still sharp) corner, the other sits further out at twice the mill radius,
// and the arc bulges into the solid (away from the tooth, i.e. a bite taken out of the material,
// not a bump added to it). A real round mill bit can't cut a sharp concave corner, so without
// this relief it would leave a rounded remnant blocking a square mating part from seating flush.
// `tangent` is the true lead-in direction (tA/tB) shared by both the outer and
// inner call for this end, rather than each side's own (very slightly non-parallel) offset line -
// so the tooth's top and sides end up exactly parallel/perpendicular to the actual corner line, and
// the outer and inner teeth end up exact mirror images of each other. `side` is +1 to have the
// tooth protrude away from the gravity center (the outer boundary) or -1 toward it (the inner
// boundary). Falls back to a plain line if there's no positive height, or not enough room along
// the run for the tooth's own length plus its relief cuts.
function buildToothedRun(
  from: Vec2,
  to: Vec2,
  tangent: Vec2,
  side: 1 | -1,
  tooth: ToothParams,
): { to: Vec2; seg: PathSegment }[] {
  const runLength = dot2(sub2(to, from), tangent)
  const millRadius = Math.max(tooth.millRadius, 0)
  if (tooth.height <= EPS || runLength < EPS) return [{ to, seg: { kind: 'line' } }]

  const midpoint = scale2(add2(from, to), 0.5)
  const outward = normalize2(midpoint)
  // The component of the radial-outward direction perpendicular to `tangent` - same "project out
  // the parallel part" trick as tangentDirection2D, just for the other axis.
  let heightDir = sub2(outward, scale2(tangent, dot2(outward, tangent)))
  if (length2(heightDir) < EPS) heightDir = perp2(tangent)
  heightDir = scale2(normalize2(heightDir), side)

  const half = tooth.length / 2
  if (half <= EPS || half + 2 * millRadius > runLength / 2 - EPS) return [{ to, seg: { kind: 'line' } }]

  const baseLeft = add2(midpoint, scale2(tangent, -half))
  const baseRight = add2(midpoint, scale2(tangent, half))
  const chamfer = Math.max(Math.min(tooth.chamfer, tooth.height, half), 0)

  const path: { to: Vec2; seg: PathSegment }[] = []

  if (millRadius > EPS) {
    // A straight run up to 2r before the corner, then a semicircle (center r before the corner,
    // bulging into the solid, away from the tooth) that ends exactly on the still-sharp corner.
    const entryCenter = sub2(baseLeft, scale2(tangent, millRadius))
    path.push({ to: sub2(baseLeft, scale2(tangent, 2 * millRadius)), seg: { kind: 'line' } })
    path.push({
      to: baseLeft,
      seg: { kind: 'arc', via: semicircleVia(entryCenter, scale2(heightDir, -1), millRadius) },
    })
  } else {
    path.push({ to: baseLeft, seg: { kind: 'line' } })
  }

  const sharpTopLeft = add2(baseLeft, scale2(heightDir, tooth.height))
  const sharpTopRight = add2(baseRight, scale2(heightDir, tooth.height))

  if (chamfer > EPS) {
    path.push({ to: sub2(sharpTopLeft, scale2(heightDir, chamfer)), seg: { kind: 'line' } })
    path.push({ to: add2(sharpTopLeft, scale2(tangent, chamfer)), seg: { kind: 'line' } })
    path.push({ to: sub2(sharpTopRight, scale2(tangent, chamfer)), seg: { kind: 'line' } })
    path.push({ to: sub2(sharpTopRight, scale2(heightDir, chamfer)), seg: { kind: 'line' } })
  } else {
    path.push({ to: sharpTopLeft, seg: { kind: 'line' } })
    path.push({ to: sharpTopRight, seg: { kind: 'line' } })
  }

  path.push({ to: baseRight, seg: { kind: 'line' } })
  if (millRadius > EPS) {
    // Mirror of the entry: starts exactly on the (still-sharp) corner, semicircles out to the
    // point 2r past it, then a plain line resumes for the rest of the run.
    const exitCenter = add2(baseRight, scale2(tangent, millRadius))
    path.push({
      to: add2(baseRight, scale2(tangent, 2 * millRadius)),
      seg: { kind: 'arc', via: semicircleVia(exitCenter, scale2(heightDir, -1), millRadius) },
    })
  }
  path.push({ to, seg: { kind: 'line' } })

  return path
}

// Reverses a path (start -> path[0].to -> path[1].to -> ...) into one that walks the same points
// backwards. Segment kinds/via-points are direction-agnostic (a line or a three-point arc looks
// the same walked either way), so they just get replayed in reverse order.
function reversePath(
  start: Vec2,
  path: { to: Vec2; seg: PathSegment }[],
): { start: Vec2; path: { to: Vec2; seg: PathSegment }[] } {
  const points = [start, ...path.map((p) => p.to)].reverse()
  const segs = path.map((p) => p.seg).reverse()
  return { start: points[0], path: segs.map((seg, i) => ({ to: points[i + 1], seg })) }
}

// Where two rays (from p1 along d1, from p2 along d2, both length `cornerLength`) cross, if they
// do so within both rays' own length. Returns the crossing point and how far along each ray (as
// a 0-1 fraction of `cornerLength`) it sits.
function findLeadInIntersection(
  p1: Vec2,
  d1: Vec2,
  p2: Vec2,
  d2: Vec2,
  cornerLength: number,
): { point: Vec2; t: number; s: number } | null {
  const D1 = scale2(d1, cornerLength)
  const D2 = scale2(d2, cornerLength)
  const denom = cross2(D1, D2)
  if (Math.abs(denom) < EPS) return null

  const diff = sub2(p2, p1)
  const t = cross2(diff, D2) / denom
  const s = cross2(diff, D1) / denom
  const EDGE_EPS = 1e-6
  if (t < -EDGE_EPS || t > 1 + EDGE_EPS || s < -EDGE_EPS || s > 1 + EDGE_EPS) return null

  const clampedT = Math.min(Math.max(t, 0), 1)
  return { point: add2(p1, scale2(D1, clampedT)), t: clampedT, s }
}

export type PathSegment = { kind: 'line' } | { kind: 'arc'; via: Vec2 }

export interface SketchPath {
  start: Vec2
  // Ordered path from `start`, through each `to` in turn.
  path: { to: Vec2; seg: PathSegment }[]
}

export interface StrutSketch extends SketchPath {
  planeOrigin: THREE.Vector3
  planeNormal: THREE.Vector3
  planeXDir: THREE.Vector3
  // The trimmed, mitered centerline `path` was built by offsetting (see the module doc) -
  // exposed mainly for debugging/visualization (e.g. the edge-sketch debug view), not needed to
  // build the solid itself.
  centerline: SketchPath
}

// The meridian plane for an edge: the flat plane through both vertices and the gravity center -
// exactly the plane sheet material for this strut lies in. Falls back to an arbitrary plane
// through the edge if the two vertices and the center are (nearly) collinear, which shouldn't
// happen for real dome geometry.
export function computeStrutPlane(
  a: THREE.Vector3,
  b: THREE.Vector3,
  center: THREE.Vector3,
): { origin: THREE.Vector3; normal: THREE.Vector3; xDir: THREE.Vector3 } {
  const ca = a.clone().sub(center)
  const cb = b.clone().sub(center)
  let normal = ca.clone().cross(cb)
  if (normal.lengthSq() < EPS) {
    const edgeDir = b.clone().sub(a).normalize()
    const arbitrary = Math.abs(edgeDir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
    normal = edgeDir.clone().cross(arbitrary)
  }
  normal.normalize()

  const xDir = ca.lengthSq() > EPS ? ca.normalize() : new THREE.Vector3(1, 0, 0)
  return { origin: center.clone(), normal, xDir }
}

function toLocal(
  p: THREE.Vector3,
  plane: { origin: THREE.Vector3; normal: THREE.Vector3; xDir: THREE.Vector3 },
  yDir: THREE.Vector3,
): Vec2 {
  const rel = p.clone().sub(plane.origin)
  return [rel.dot(plane.xDir), rel.dot(yDir)]
}

// Offsets a point (in local coordinates, where the gravity center is the origin) radially by
// `dist`, i.e. toward/away from the center - toward if `dist` is negative.
function offsetRadial(p: Vec2, dist: number): Vec2 {
  return add2(p, scale2(normalize2(p), dist))
}

// The flat sketch outline for one strut: the trimmed, mitered centerline (see
// computeStrutPlane's doc and the module-level algorithm this implements) turned into a closed
// polygon by offsetting it radially by `halfWidth` on each side, with an interlocking tooth cut
// into each end's straight lead-in on both sides (see buildToothedRun) if `tooth.height` is
// positive. Returns null for degenerate input (a vertex sitting on the gravity center -
// shouldn't happen for real dome geometry).
export function computeStrutBoundary(
  a: THREE.Vector3,
  b: THREE.Vector3,
  center: THREE.Vector3,
  offsetA: number,
  offsetB: number,
  cornerLength: number,
  halfWidth: number,
  tooth: ToothParams,
): StrutSketch | null {
  const plane = computeStrutPlane(a, b, center)
  const yDir = plane.normal.clone().cross(plane.xDir).normalize()

  const A = toLocal(a, plane, yDir)
  const B = toLocal(b, plane, yDir)
  if (length2(A) < EPS || length2(B) < EPS) return null

  // A degenerate offset computation (e.g. NaN/Infinity from a vertex with a near-0 or near-360
  // angle between edges) falls back to the full cornerLength budget - the safer of the two
  // directions to be wrong in, since it over-trims rather than risking overlap.
  const clampOffset = (offset: number): number =>
    Number.isFinite(offset) ? Math.min(Math.max(offset, 0), cornerLength) : cornerLength

  const tA = tangentDirection2D(A, B)
  const tB = tangentDirection2D(B, A)

  const corner = findLeadInIntersection(A, tA, B, tB, cornerLength)

  let offsetALimit = clampOffset(offsetA)
  let offsetBLimit = clampOffset(offsetB)
  if (corner) {
    offsetALimit = Math.min(offsetALimit, corner.t * cornerLength)
    offsetBLimit = Math.min(offsetBLimit, corner.s * cornerLength)
  }

  const trimmedA = add2(A, scale2(tA, offsetALimit))
  const trimmedB = add2(B, scale2(tB, offsetBLimit))

  // The centerline's key points and the segment used to reach each from the previous one.
  const centerline: { pt: Vec2; seg: PathSegment }[] = [{ pt: trimmedA, seg: { kind: 'line' } }]

  if (corner) {
    centerline.push({ pt: corner.point, seg: { kind: 'line' } })
    centerline.push({ pt: trimmedB, seg: { kind: 'line' } })
  } else {
    const eA = add2(A, scale2(tA, cornerLength))
    const eB = add2(B, scale2(tB, cornerLength))
    // The two lead-ins' free ends may sit at slightly different distances from the gravity
    // center (the vertices need not share a sphere); snap both onto their average radius so a
    // single circle, centered at the gravity center, passes through both exactly.
    const radius = (length2(eA) + length2(eB)) / 2
    const eAu = normalize2(eA)
    const eBu = normalize2(eB)
    const eAr = scale2(eAu, radius)
    const eBr = scale2(eBu, radius)
    const viaDir = normalize2(add2(eAu, eBu))
    const via = scale2(viaDir, radius)

    centerline.push({ pt: eAr, seg: { kind: 'line' } })
    centerline.push({ pt: eBr, seg: { kind: 'arc', via } })
    centerline.push({ pt: trimmedB, seg: { kind: 'line' } })
  }

  // Turns each centerline segment into its outer (away from center) and inner (toward center)
  // boundary counterpart. A line segment's boundary is normally the line between its two
  // endpoints' radial offsets (the same per-point-offset approximation the old three.js beam
  // used) - except the first and last (always the two straight lead-ins, one per vertex end),
  // which get an interlocking tooth cut into their middle instead, mirrored between the outer
  // and inner sides. An arc segment's boundary is an exact concentric arc, at radius +/-
  // halfWidth, since it's already centered at the origin.
  const outerStart = offsetRadial(centerline[0].pt, halfWidth)
  const innerStart = offsetRadial(centerline[0].pt, -halfWidth)
  const outerPath: { to: Vec2; seg: PathSegment }[] = []
  const innerPath: { to: Vec2; seg: PathSegment }[] = []

  for (let i = 1; i < centerline.length; i++) {
    const { pt, seg } = centerline[i]

    if (seg.kind === 'arc') {
      const outerRadius = length2(seg.via) + halfWidth
      const innerRadius = length2(seg.via) - halfWidth
      const viaDir = normalize2(seg.via)
      outerPath.push({ to: offsetRadial(pt, halfWidth), seg: { kind: 'arc', via: scale2(viaDir, outerRadius) } })
      innerPath.push({ to: offsetRadial(pt, -halfWidth), seg: { kind: 'arc', via: scale2(viaDir, innerRadius) } })
      continue
    }

    const isLeadIn = i === 1 || i === centerline.length - 1
    const prevPt = centerline[i - 1].pt
    const outerFrom = offsetRadial(prevPt, halfWidth)
    const outerTo = offsetRadial(pt, halfWidth)
    const innerFrom = offsetRadial(prevPt, -halfWidth)
    const innerTo = offsetRadial(pt, -halfWidth)
    if (isLeadIn) {
      // The true lead-in direction (tA at the a-side, -tB at the b-side, since that segment
      // walks from the corner/arc-start back toward B) - shared by both the outer and inner
      // call, rather than each side's own (very slightly non-parallel) offset line.
      const leadTangent = i === 1 ? tA : scale2(tB, -1)
      outerPath.push(...buildToothedRun(outerFrom, outerTo, leadTangent, 1, tooth))
      innerPath.push(...buildToothedRun(innerFrom, innerTo, leadTangent, -1, tooth))
    } else {
      outerPath.push({ to: outerTo, seg: { kind: 'line' } })
      innerPath.push({ to: innerTo, seg: { kind: 'line' } })
    }
  }

  const { start: innerReversedStart, path: innerReversedPath } = reversePath(innerStart, innerPath)
  const path: { to: Vec2; seg: PathSegment }[] = [
    ...outerPath,
    // End cap at the b-side.
    { to: innerReversedStart, seg: { kind: 'line' } },
    ...innerReversedPath,
  ]
  // Closing the loop back to `start` (the a-side end cap) is left to the caller's sketcher.

  const centerlinePath: { to: Vec2; seg: PathSegment }[] = centerline
    .slice(1)
    .map(({ pt, seg }) => ({ to: pt, seg }))

  return {
    planeOrigin: plane.origin,
    planeNormal: plane.normal,
    planeXDir: plane.xDir,
    start: outerStart,
    path,
    centerline: { start: centerline[0].pt, path: centerlinePath },
  }
}

// minOffset for every edge-end in the currently visible model, keyed by edge id then by the
// vertex id at that end - built by running the same per-vertex hub-metric computation the HUD
// uses (computeVertexHubMetrics/computeVisibleVertexEdges) for every visible vertex, so struts
// get the exact miter offsets the HUD already shows for each hub.
export function computeEdgeEndOffsets(
  data: PolyhedronData,
  transformedVertices: THREE.Vector3[],
  addedVertices: ReadonlyMap<number, THREE.Vector3>,
  layerCount: number,
  deletedVertexIndices: ReadonlySet<number>,
  deletedEdgeIndices: ReadonlySet<number>,
  addedFaces: Face[],
  addedEdges: Edge[],
  centerY: number,
  edgeThicknessOf: (edgeId: number) => number,
): Map<number, Map<number, number>> {
  const visibleVertexIds = computeVisibleVertexIds(
    data,
    transformedVertices,
    layerCount,
    deletedVertexIndices,
    addedFaces,
  )
  const center = new THREE.Vector3(0, centerY, 0)
  const positionOf = (id: number) => resolveVertexPosition(id, transformedVertices, addedVertices)

  const result = new Map<number, Map<number, number>>()
  for (const vertexId of visibleVertexIds) {
    const edges = computeVisibleVertexEdges(
      data,
      transformedVertices,
      layerCount,
      deletedVertexIndices,
      deletedEdgeIndices,
      addedEdges,
      vertexId,
    )
    const metrics = computeVertexHubMetrics(positionOf(vertexId), center, edges, positionOf, edgeThicknessOf)
    for (const m of metrics) {
      let byVertex = result.get(m.edgeId)
      if (!byVertex) {
        byVertex = new Map()
        result.set(m.edgeId, byVertex)
      }
      byVertex.set(vertexId, m.offsetMm)
    }
  }
  return result
}
