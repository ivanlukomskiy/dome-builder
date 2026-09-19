import * as THREE from 'three'
import type { Edge, SceneData } from './polyhedra'

// A brace is a cross-link between two struts that meet at the same vertex: a straight line from
// a point on one edge to a point on the other, each at `shift * edge length` from that shared
// vertex. Tunable properties live under `params` (just `shift` for now) so new ones can be added
// there without touching the brace's topology (`vertexId`, `edgeIds`).
export interface BraceParams {
  // Fraction of each edge's length, measured from the brace's vertex: 0 < shift < 1.
  shift: number
}

export interface Brace {
  // The vertex both edges are connected to.
  vertexId: number
  edgeIds: [number, number]
  params: BraceParams
}

export const DEFAULT_BRACE_SHIFT = 0.5
// 0 < shift < 1 is exclusive, so editing clamps just inside the bounds.
export const MIN_BRACE_SHIFT = 0.01
export const MAX_BRACE_SHIFT = 0.99

export function clampBraceShift(shift: number): number {
  return Math.min(Math.max(shift, MIN_BRACE_SHIFT), MAX_BRACE_SHIFT)
}

// The one vertex two edges share, or null if they share none (or - degenerate duplicate edges -
// both).
export function sharedVertex(e1: Edge, e2: Edge): number | null {
  const shared = e1.filter((v) => e2.includes(v))
  return shared.length === 1 ? shared[0] : null
}

// The pair of edge ids a new brace would be made from, or null if the selection can't form one:
// it must be exactly two existing edges that share a vertex and don't already have a brace
// between them.
export function resolveBracePair(
  scene: SceneData,
  selectedEdgeIds: ReadonlySet<number>,
): [number, number] | null {
  if (selectedEdgeIds.size !== 2) return null
  const [idA, idB] = Array.from(selectedEdgeIds)
  const edgeA = scene.edges.get(idA)
  const edgeB = scene.edges.get(idB)
  if (!edgeA || !edgeB || sharedVertex(edgeA, edgeB) === null) return null
  for (const brace of scene.braces.values()) {
    if (brace.edgeIds.includes(idA) && brace.edgeIds.includes(idB)) return null
  }
  return [idA, idB]
}

// "Add Brace": adds one brace between the two selected edges, at the default shift. Returns the
// scene unchanged if the selection isn't a valid pair (see resolveBracePair).
export function addBrace(scene: SceneData, selectedEdgeIds: ReadonlySet<number>): SceneData {
  const pair = resolveBracePair(scene, selectedEdgeIds)
  if (!pair) return scene
  const vertexId = sharedVertex(scene.edges.get(pair[0])!, scene.edges.get(pair[1])!)!
  const braces = new Map(scene.braces)
  braces.set(scene.nextBraceId, { vertexId, edgeIds: pair, params: { shift: DEFAULT_BRACE_SHIFT } })
  return { ...scene, braces, nextBraceId: scene.nextBraceId + 1 }
}

export function deleteBraces(scene: SceneData, ids: ReadonlySet<number>): SceneData {
  if (ids.size === 0) return scene
  const braces = new Map(Array.from(scene.braces).filter(([id]) => !ids.has(id)))
  return { ...scene, braces }
}

export function setBraceShift(scene: SceneData, ids: ReadonlySet<number>, shift: number): SceneData {
  if (ids.size === 0) return scene
  const clamped = clampBraceShift(shift)
  const braces = new Map(scene.braces)
  for (const id of ids) {
    const brace = braces.get(id)
    if (brace) braces.set(id, { ...brace, params: { ...brace.params, shift: clamped } })
  }
  return { ...scene, braces }
}

// Drops every brace whose edges are no longer both present - used when edges (or the vertices
// they hang off) get deleted. Returns the same map if nothing needed dropping.
export function pruneBraces(
  braces: ReadonlyMap<number, Brace>,
  edges: ReadonlyMap<number, Edge>,
): Map<number, Brace> {
  const kept = new Map(Array.from(braces).filter(([, b]) => b.edgeIds.every((id) => edges.has(id))))
  return kept.size === braces.size ? (braces as Map<number, Brace>) : kept
}

// The two end points of a brace's line: on each of its edges, `shift * length` from the shared
// vertex, toward the edge's other end. Null if the brace refers to an edge that doesn't exist.
export function computeBraceEndpoints(
  brace: Brace,
  edges: ReadonlyMap<number, Edge>,
  positionOf: (vertexId: number) => THREE.Vector3,
): [THREE.Vector3, THREE.Vector3] | null {
  const origin = positionOf(brace.vertexId)
  const points: THREE.Vector3[] = []
  for (const edgeId of brace.edgeIds) {
    const edge = edges.get(edgeId)
    if (!edge) return null
    const otherId = edge[0] === brace.vertexId ? edge[1] : edge[0]
    points.push(origin.clone().lerp(positionOf(otherId), brace.params.shift))
  }
  return [points[0], points[1]]
}

// What the strut builder needs to know about one brace lying on one end of a strut.
export interface StrutBraceEnd {
  braceId: number
  shift: number
  // shift * the strut's (chord) length, in mm, measured from this end's vertex.
  distanceFromVertex: number
  // The other edge the brace runs to.
  otherEdgeId: number
}

// The braces on a strut's two ends - A is the edge's first vertex, B its second. Empty lists mean
// no brace there, so a strut can have braces at A, at B, at both, or at neither (and, at a
// vertex with three or more edges, more than one at the same end).
export interface StrutBraces {
  a: StrutBraceEnd[]
  b: StrutBraceEnd[]
}

export const NO_STRUT_BRACES: StrutBraces = { a: [], b: [] }

export function indexBracesByEdge(
  braces: ReadonlyMap<number, Brace>,
): Map<number, { braceId: number; brace: Brace }[]> {
  const byEdge = new Map<number, { braceId: number; brace: Brace }[]>()
  for (const [braceId, brace] of braces) {
    for (const edgeId of brace.edgeIds) {
      let list = byEdge.get(edgeId)
      if (!list) {
        list = []
        byEdge.set(edgeId, list)
      }
      list.push({ braceId, brace })
    }
  }
  return byEdge
}

export function computeStrutBraces(
  edgeId: number,
  edge: Edge,
  length: number,
  bracesByEdge: ReadonlyMap<number, { braceId: number; brace: Brace }[]>,
): StrutBraces {
  const result: StrutBraces = { a: [], b: [] }
  for (const { braceId, brace } of bracesByEdge.get(edgeId) ?? []) {
    const entry: StrutBraceEnd = {
      braceId,
      shift: brace.params.shift,
      distanceFromVertex: brace.params.shift * length,
      otherEdgeId: brace.edgeIds[0] === edgeId ? brace.edgeIds[1] : brace.edgeIds[0],
    }
    if (brace.vertexId === edge[0]) result.a.push(entry)
    else if (brace.vertexId === edge[1]) result.b.push(entry)
  }
  return result
}
