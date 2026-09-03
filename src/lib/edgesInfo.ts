import * as THREE from 'three'
import type { Edge, Face, PolyhedronData } from './polyhedra'
import {
  computeVertexHubMetrics,
  computeVertexTangentPlane,
  computeVisibleVertexEdges,
  computeVisibleVertexIds,
  edgeKey,
  resolveVertexPosition,
} from './polyhedra'
import { precalculateStrutEnd, type StrutEndMeasurements } from './strutGeometryManual'

type Vec3Tuple = [number, number, number]

function toTuple(v: THREE.Vector3): Vec3Tuple {
  return [v.x, v.y, v.z]
}

export interface EdgeInfo {
  edgeId: number
  neighborId: number
  neighborPosition: Vec3Tuple
  thicknessMm: number
  // The miter offset this end is trimmed back by (the hub's own minimum, plus the global offset
  // modifier) - the same value fed into precalculateStrutEnd for the live Preview solids.
  offsetMm: number
  // The shouldered-tenon layout for this strut end, computed exactly as it is for the real
  // Preview solids (see precalculateStrutEnd in strutGeometryManual.ts).
  strutEnd: StrutEndMeasurements
  // This edge's own direction, projected onto the vertex's tangent plane and measured as an
  // angle (degrees, 0-360) from the plane's e1 axis toward e2.
  projectedAngleDeg: number
  // Angle (degrees), going around the tangent plane, from this edge to the next one in angular
  // order (wrapping back to the first edge after the last).
  angleToNextEdgeDeg: number
  // Whether a (visible) face fills the wedge between this edge and the next one in angular
  // order, and which face it is if so - the same signed id scheme used everywhere else
  // (non-negative = index into data.faces, negative = -(index in addedFaces) - 1).
  hasFaceToNextEdge: boolean
  faceIdToNextEdge: number | null
}

export interface VertexEdgesInfo {
  vertexId: number
  position: Vec3Tuple
  // The tangent plane this vertex's edges were projected onto to compute the angles above -
  // origin is the vertex itself, normal points away from the gravity center.
  tangentPlane: {
    origin: Vec3Tuple
    normal: Vec3Tuple
    e1: Vec3Tuple
    e2: Vec3Tuple
  }
  // Sorted in angular order around the tangent plane (matching angleToNextEdgeDeg's meaning).
  edges: EdgeInfo[]
}

export interface EdgesInfoResult {
  vertices: VertexEdgesInfo[]
}

export interface ComputeEdgesInfoParams {
  data: PolyhedronData
  transformedVertices: THREE.Vector3[]
  addedVertices: ReadonlyMap<number, THREE.Vector3>
  layerCount: number
  deletedVertexIndices: ReadonlySet<number>
  deletedEdgeIndices: ReadonlySet<number>
  deletedFaceIndices: ReadonlySet<number>
  addedFaces: Face[]
  addedEdges: Edge[]
  centerY: number
  edgeThicknessOf: (edgeId: number) => number
  // Strut-end params - see precalculateStrutEnd in strutGeometryManual.ts.
  cornerLength: number
  halfWidth: number
  offsetModifier: number
  endGrooveLengthPercent: number
  midGrooveLengthPercent: number
  grooveDepth: number
  millingDiameter: number
  chamferLength: number
}

// Every visible face (canonical or added), registers - for each of its vertices - the unordered
// pair of ring-neighbors it connects to on either side. A face incident to vertex v always
// occupies exactly the angular wedge between v's edges to those two neighbors, so this is what
// "is there a face between these two adjacent edges" reduces to.
function buildFaceNeighborPairs(
  data: PolyhedronData,
  addedFaces: Face[],
  deletedFaceIndices: ReadonlySet<number>,
  visibleVertexSet: ReadonlySet<number>,
): Map<number, Map<string, number>> {
  const byVertex = new Map<number, Map<string, number>>()

  const register = (ring: Face, faceId: number) => {
    const n = ring.length
    for (let i = 0; i < n; i++) {
      const v = ring[i]
      if (!visibleVertexSet.has(v)) continue
      const prev = ring[(i - 1 + n) % n]
      const next = ring[(i + 1) % n]
      let pairs = byVertex.get(v)
      if (!pairs) {
        pairs = new Map()
        byVertex.set(v, pairs)
      }
      pairs.set(edgeKey(prev, next), faceId)
    }
  }

  data.faces.forEach((face, i) => {
    if (deletedFaceIndices.has(i)) return
    if (!face.every((idx) => visibleVertexSet.has(idx))) return
    register(face, i)
  })
  addedFaces.forEach((face, i) => {
    const id = -(i + 1)
    if (deletedFaceIndices.has(id)) return
    if (!face.every((idx) => visibleVertexSet.has(idx))) return
    register(face, id)
  })

  return byVertex
}

// Everything about each visible vertex's edges: which struts go into it, their precalculated
// strut-end measurements (the same shouldered-tenon layout the live Preview builds each solid
// strut from), which adjacent pairs of edges have a face spanning them (and which don't - a
// missing panel), and the tangent plane those edges were projected onto to work that out.
export function computeEdgesInfo(params: ComputeEdgesInfoParams): EdgesInfoResult {
  const {
    data,
    transformedVertices,
    addedVertices,
    layerCount,
    deletedVertexIndices,
    deletedEdgeIndices,
    deletedFaceIndices,
    addedFaces,
    addedEdges,
    centerY,
    edgeThicknessOf,
    cornerLength,
    halfWidth,
    offsetModifier,
    endGrooveLengthPercent,
    midGrooveLengthPercent,
    grooveDepth,
    millingDiameter,
    chamferLength,
  } = params

  const center = new THREE.Vector3(0, centerY, 0)
  const positionOf = (id: number) => resolveVertexPosition(id, transformedVertices, addedVertices)

  const visibleVertexIds = computeVisibleVertexIds(
    data,
    transformedVertices,
    layerCount,
    deletedVertexIndices,
    addedFaces,
  )
  const visibleVertexSet = new Set(visibleVertexIds)

  const faceNeighborPairs = buildFaceNeighborPairs(
    data,
    addedFaces,
    deletedFaceIndices,
    visibleVertexSet,
  )

  const vertices: VertexEdgesInfo[] = []

  for (const vertexId of visibleVertexIds) {
    const vertexPos = positionOf(vertexId)
    const edgeRefs = computeVisibleVertexEdges(
      data,
      transformedVertices,
      layerCount,
      deletedVertexIndices,
      deletedEdgeIndices,
      addedEdges,
      vertexId,
    )
    if (edgeRefs.length === 0) continue

    const { normal, e1, e2 } = computeVertexTangentPlane(vertexPos, center)
    const metrics = computeVertexHubMetrics(vertexPos, center, edgeRefs, positionOf, edgeThicknessOf)

    const projectedAngleByEdge = new Map<number, number>()
    for (const ref of edgeRefs) {
      const direction = positionOf(ref.neighborId).clone().sub(vertexPos)
      const projected = direction.addScaledVector(normal, -direction.dot(normal))
      let angle = Math.atan2(projected.dot(e2), projected.dot(e1))
      if (angle < 0) angle += 2 * Math.PI
      projectedAngleByEdge.set(ref.edgeId, (angle * 180) / Math.PI)
    }

    const facePairs = faceNeighborPairs.get(vertexId) ?? new Map<string, number>()
    const n = metrics.length

    const edges: EdgeInfo[] = metrics.map((m, i) => {
      const offset = m.offsetMm + offsetModifier
      const strutEnd = precalculateStrutEnd(
        offset,
        cornerLength,
        endGrooveLengthPercent,
        midGrooveLengthPercent,
        chamferLength,
        millingDiameter,
        grooveDepth,
        halfWidth,
      )
      const nextNeighborId = metrics[(i + 1) % n].neighborId
      const faceId = facePairs.get(edgeKey(m.neighborId, nextNeighborId))

      return {
        edgeId: m.edgeId,
        neighborId: m.neighborId,
        neighborPosition: toTuple(positionOf(m.neighborId)),
        thicknessMm: m.thicknessMm,
        offsetMm: offset,
        strutEnd,
        projectedAngleDeg: projectedAngleByEdge.get(m.edgeId) ?? 0,
        angleToNextEdgeDeg: m.angleToNextDeg,
        hasFaceToNextEdge: faceId !== undefined,
        faceIdToNextEdge: faceId ?? null,
      }
    })

    vertices.push({
      vertexId,
      position: toTuple(vertexPos),
      tangentPlane: {
        origin: toTuple(vertexPos),
        normal: toTuple(normal),
        e1: toTuple(e1),
        e2: toTuple(e2),
      },
      edges,
    })
  }

  return { vertices }
}
