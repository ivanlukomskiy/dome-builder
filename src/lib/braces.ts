import * as THREE from 'three'
import type { Edge, SceneData } from './polyhedra'

// A brace is a cross-link between two struts that meet at the same vertex: a straight line from
// a point on one edge to a point on the other, each at `shift * edge length` from that shared
// vertex. Tunable properties live under `params` so new ones can be added there without touching
// the brace's topology (`vertexId`, `edgeIds`).
export interface BraceParams {
  // Fraction of each edge's length, measured from the brace's vertex: 0 < shift < 1.
  shift: number
  // Brace width, mm: the plate's length along the strut, at the brace.
  width: number
  // Cap, mm, on the plate's size across the strut (which is otherwise as wide as fits between the
  // strut's two curved sides).
  maxPlateWidth: number
  plateRadius: number
  plateHoleDiameter: number
  plateHoleOffsetLongitudinal: number
  plateHoleOffsetTransverse: number
  // How thick the plate is, mm - extruded out from the strut's side face.
  plateThickness: number
}

// Everything but `shift` - the properties of a brace's plate, which are the same for every brace
// for now (see the Preview sidebar). `shift` is where each brace sits, set per brace.
export type BracePlateParams = Omit<BraceParams, 'shift'>

export const DEFAULT_BRACE_PARAMS: BraceParams = {
  shift: 0.5,
  width: 50,
  maxPlateWidth: 50,
  plateRadius: 5,
  plateHoleDiameter: 5,
  plateHoleOffsetLongitudinal: 7,
  plateHoleOffsetTransverse: 7,
  plateThickness: 5,
}

export const DEFAULT_BRACE_PLATE_PARAMS: BracePlateParams = (() => {
  const { shift: _shift, ...plate } = DEFAULT_BRACE_PARAMS
  return plate
})()

// How each brace property is presented when editing it.
export const BRACE_PARAM_FIELDS: { key: keyof BraceParams; label: string; step: number }[] = [
  { key: 'shift', label: 'Shift (fraction of edge length, 0-1)', step: 0.05 },
  { key: 'width', label: 'Brace width (mm)', step: 5 },
  { key: 'maxPlateWidth', label: 'Max plate width (mm)', step: 5 },
  { key: 'plateRadius', label: 'Plate radius (mm)', step: 1 },
  { key: 'plateHoleDiameter', label: 'Plate hole diameter (mm)', step: 1 },
  { key: 'plateHoleOffsetLongitudinal', label: 'Plate hole offset, longitudinal (mm)', step: 1 },
  { key: 'plateHoleOffsetTransverse', label: 'Plate hole offset, transverse (mm)', step: 1 },
  { key: 'plateThickness', label: 'Plate thickness (mm)', step: 1 },
]

export const BRACE_PLATE_PARAM_FIELDS = BRACE_PARAM_FIELDS.filter((f) => f.key !== 'shift') as {
  key: keyof BracePlateParams
  label: string
  step: number
}[]

export interface Brace {
  // The vertex both edges are connected to.
  vertexId: number
  edgeIds: [number, number]
  params: BraceParams
}

export const DEFAULT_BRACE_SHIFT = DEFAULT_BRACE_PARAMS.shift
// 0 < shift < 1 is exclusive, so editing clamps just inside the bounds.
export const MIN_BRACE_SHIFT = 0.01
export const MAX_BRACE_SHIFT = 0.99

export function clampBraceShift(shift: number): number {
  return Math.min(Math.max(shift, MIN_BRACE_SHIFT), MAX_BRACE_SHIFT)
}

// Keeps an edited value legal: shift strictly inside (0, 1), every other property non-negative.
export function sanitizeBraceParam(key: keyof BraceParams, value: number): number {
  return key === 'shift' ? clampBraceShift(value) : Math.max(value, 0)
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

// "Add Brace": adds one brace between the two selected edges, at the default shift, with the given
// plate properties (the defaults if none). Returns the scene unchanged if the selection isn't a
// valid pair (see resolveBracePair).
export function addBrace(
  scene: SceneData,
  selectedEdgeIds: ReadonlySet<number>,
  plateParams: BracePlateParams = DEFAULT_BRACE_PLATE_PARAMS,
): SceneData {
  const pair = resolveBracePair(scene, selectedEdgeIds)
  if (!pair) return scene
  const vertexId = sharedVertex(scene.edges.get(pair[0])!, scene.edges.get(pair[1])!)!
  const braces = new Map(scene.braces)
  braces.set(scene.nextBraceId, {
    vertexId,
    edgeIds: pair,
    params: { ...DEFAULT_BRACE_PARAMS, ...plateParams },
  })
  return { ...scene, braces, nextBraceId: scene.nextBraceId + 1 }
}

// The plate properties of the first brace, or the defaults if there are none.
export function firstBracePlateParams(braces: ReadonlyMap<number, Brace>): BracePlateParams {
  for (const brace of braces.values()) {
    const { shift: _shift, ...plate } = { ...DEFAULT_BRACE_PARAMS, ...brace.params }
    return plate
  }
  return DEFAULT_BRACE_PLATE_PARAMS
}

// Whether any brace's plate properties differ from `plate`.
export function bracePlateParamsDiffer(scene: SceneData, plate: BracePlateParams): boolean {
  const keys = Object.keys(plate) as (keyof BracePlateParams)[]
  for (const brace of scene.braces.values()) {
    if (keys.some((key) => brace.params[key] !== plate[key])) return true
  }
  return false
}

// Gives every brace the same plate properties (keeping each one's own shift).
export function applyBracePlateParams(scene: SceneData, plate: BracePlateParams): SceneData {
  if (scene.braces.size === 0) return scene
  const braces = new Map<number, Brace>()
  for (const [id, brace] of scene.braces) braces.set(id, { ...brace, params: { ...brace.params, ...plate } })
  return { ...scene, braces }
}

export function deleteBraces(scene: SceneData, ids: ReadonlySet<number>): SceneData {
  if (ids.size === 0) return scene
  const braces = new Map(Array.from(scene.braces).filter(([id]) => !ids.has(id)))
  return { ...scene, braces }
}

export function setBraceParam(
  scene: SceneData,
  ids: ReadonlySet<number>,
  key: keyof BraceParams,
  value: number,
): SceneData {
  if (ids.size === 0) return scene
  const sanitized = sanitizeBraceParam(key, value)
  const braces = new Map(scene.braces)
  for (const id of ids) {
    const brace = braces.get(id)
    if (brace) braces.set(id, { ...brace, params: { ...brace.params, [key]: sanitized } })
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
  // All of the brace's properties (shift, width, plate settings, ...).
  params: BraceParams
  // shift * the strut's (chord) length, in mm, measured from this end's vertex.
  distanceFromVertex: number
  // The other edge the brace runs to.
  otherEdgeId: number
  // Unit vector, in the model's 3D space, from this end's vertex along that other edge - which way
  // the brace's plate should stick out from the strut.
  otherEdgeDirection: [number, number, number]
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
  edges: ReadonlyMap<number, Edge>,
  positionOf: (vertexId: number) => THREE.Vector3,
): StrutBraces {
  const result: StrutBraces = { a: [], b: [] }
  for (const { braceId, brace } of bracesByEdge.get(edgeId) ?? []) {
    const otherEdgeId = brace.edgeIds[0] === edgeId ? brace.edgeIds[1] : brace.edgeIds[0]
    const otherEdge = edges.get(otherEdgeId)
    if (!otherEdge) continue
    const farVertexId = otherEdge[0] === brace.vertexId ? otherEdge[1] : otherEdge[0]
    const direction = positionOf(farVertexId).clone().sub(positionOf(brace.vertexId)).normalize()
    const entry: StrutBraceEnd = {
      braceId,
      params: brace.params,
      distanceFromVertex: brace.params.shift * length,
      otherEdgeId,
      otherEdgeDirection: [direction.x, direction.y, direction.z],
    }
    if (brace.vertexId === edge[0]) result.a.push(entry)
    else if (brace.vertexId === edge[1]) result.b.push(entry)
  }
  return result
}

// Where a brace's plate goes, as the plane `buildStrutMeshFromDrawing` extrudes symmetrically about
// (see replicadCad.ts): the strut's own plane moved out along its normal, toward the side the
// brace's other edge is on, so the plate starts at the strut's face (half its thickness out) and
// reaches `plateThickness` beyond it. Pair with `params.plateThickness` as the extrusion depth.
export function bracePlatePlane(
  strutPlane: { origin: THREE.Vector3; normal: THREE.Vector3; xDir: THREE.Vector3 },
  strutThickness: number,
  brace: StrutBraceEnd,
): { origin: THREE.Vector3; normal: THREE.Vector3; xDir: THREE.Vector3 } {
  const toOther = new THREE.Vector3(...brace.otherEdgeDirection)
  const side = strutPlane.normal.dot(toOther) < 0 ? -1 : 1
  const offset = side * (strutThickness / 2 + brace.params.plateThickness / 2)
  return {
    origin: strutPlane.origin.clone().addScaledVector(strutPlane.normal, offset),
    normal: strutPlane.normal.clone(),
    xDir: strutPlane.xDir.clone(),
  }
}
