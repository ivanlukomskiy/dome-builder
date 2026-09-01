import * as THREE from 'three'

export type ShapeType = 'octahedron' | 'icosahedron' | 'goldberg'
export type AxisType = 'vertex' | 'face' | 'edge'

export type SelectionMode = 'point' | 'layer' | 'symmetric'

export const SELECTION_MODE_OPTIONS: { value: SelectionMode; label: string; hint: string }[] = [
  { value: 'point', label: 'Individual', hint: 'Click one to select it' },
  { value: 'layer', label: 'Layer', hint: 'Click one to select its whole layer' },
  {
    value: 'symmetric',
    label: 'Symmetric',
    hint: 'Click one to select its symmetric group',
  },
]

// Goldberg polyhedra are the classic dual of a geodesic icosahedron, so they always
// borrow the icosahedron's raw vertex/face data and axis options.
type BaseShapeType = 'octahedron' | 'icosahedron'

export interface AxisOption {
  value: AxisType
  label: string
  axisCount: number
  fold: number
}

export const SHAPE_LABELS: Record<ShapeType, string> = {
  octahedron: 'Octahedron',
  icosahedron: 'Icosahedron',
  goldberg: 'Goldberg Polyhedron',
}

export const SHAPE_AXES: Record<ShapeType, AxisOption[]> = {
  octahedron: [
    { value: 'vertex', label: 'Opposite vertices', axisCount: 3, fold: 4 },
    { value: 'face', label: 'Opposite face centers', axisCount: 4, fold: 3 },
    { value: 'edge', label: 'Opposite edge midpoints', axisCount: 6, fold: 2 },
  ],
  icosahedron: [
    { value: 'vertex', label: 'Opposite vertices', axisCount: 6, fold: 5 },
    { value: 'face', label: 'Opposite face centers', axisCount: 10, fold: 3 },
    { value: 'edge', label: 'Opposite edge midpoints', axisCount: 15, fold: 2 },
  ],
  goldberg: [
    { value: 'vertex', label: 'Opposite vertices', axisCount: 6, fold: 5 },
    { value: 'face', label: 'Opposite face centers', axisCount: 10, fold: 3 },
    { value: 'edge', label: 'Opposite edge midpoints', axisCount: 15, fold: 2 },
  ],
}

// A face is an ordered ring of vertex indices tracing its outward-facing boundary.
// Raw shape data and subdivision always deal in triangles; the Goldberg dual produces
// pentagons/hexagons, so downstream code (edges, layers, rendering) treats faces generically.
type TriFace = [number, number, number]
export type Face = number[]
export type Edge = [number, number]

// Canonical vertex/face data, matching three.js's own Octahedron/IcosahedronGeometry
// construction, so winding (outward normals) is already correct.
const PHI = (1 + Math.sqrt(5)) / 2

const RAW_SHAPE_DATA: Record<
  BaseShapeType,
  { vertices: [number, number, number][]; faces: TriFace[] }
> = {
  octahedron: {
    vertices: [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ],
    faces: [
      [0, 2, 4],
      [0, 4, 3],
      [0, 3, 5],
      [0, 5, 2],
      [1, 2, 5],
      [1, 5, 3],
      [1, 3, 4],
      [1, 4, 2],
    ],
  },
  icosahedron: {
    vertices: [
      [-1, PHI, 0],
      [1, PHI, 0],
      [-1, -PHI, 0],
      [1, -PHI, 0],
      [0, -1, PHI],
      [0, 1, PHI],
      [0, -1, -PHI],
      [0, 1, -PHI],
      [PHI, 0, -1],
      [PHI, 0, 1],
      [-PHI, 0, -1],
      [-PHI, 0, 1],
    ],
    faces: [
      [0, 11, 5],
      [0, 5, 1],
      [0, 1, 7],
      [0, 7, 10],
      [0, 10, 11],
      [1, 5, 9],
      [5, 11, 4],
      [11, 10, 2],
      [10, 7, 6],
      [7, 1, 8],
      [3, 9, 4],
      [3, 4, 2],
      [3, 2, 6],
      [3, 6, 8],
      [3, 8, 9],
      [4, 9, 5],
      [2, 4, 11],
      [6, 2, 10],
      [8, 6, 7],
      [9, 8, 1],
    ],
  },
}

export const MIN_SUBDIVISIONS = 1
export const MAX_SUBDIVISIONS = 4

function subdivideFace(
  face: TriFace,
  baseVertices: THREE.Vector3[],
  freq: number,
  radius: number,
  pointMap: Map<string, number>,
  outVertices: THREE.Vector3[],
  outFaces: TriFace[],
): void {
  const [ia, ib, ic] = face
  const A = baseVertices[ia]
  const B = baseVertices[ib]
  const C = baseVertices[ic]

  // grid[i][j]: point at barycentric weights (k, i, j) / freq toward (A, B, C)
  const grid: number[][] = []
  for (let i = 0; i <= freq; i++) {
    const row: number[] = []
    for (let j = 0; j <= freq - i; j++) {
      const k = freq - i - j
      const p = new THREE.Vector3()
        .addScaledVector(A, k / freq)
        .addScaledVector(B, i / freq)
        .addScaledVector(C, j / freq)
      p.normalize().multiplyScalar(radius)
      const key = `${p.x.toFixed(6)}_${p.y.toFixed(6)}_${p.z.toFixed(6)}`
      let idx = pointMap.get(key)
      if (idx === undefined) {
        idx = outVertices.length
        outVertices.push(p)
        pointMap.set(key, idx)
      }
      row.push(idx)
    }
    grid.push(row)
  }

  for (let i = 0; i < freq; i++) {
    for (let j = 0; j < freq - i; j++) {
      outFaces.push([grid[i][j], grid[i + 1][j], grid[i][j + 1]])
      if (j < freq - i - 1) {
        outFaces.push([grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]])
      }
    }
  }
}

function subdividePolyhedron(
  vertices: THREE.Vector3[],
  faces: TriFace[],
  subdivisions: number,
): { vertices: THREE.Vector3[]; faces: TriFace[] } {
  if (subdivisions <= 1) return { vertices, faces }

  const radius = vertices[0].length()
  const newVertices: THREE.Vector3[] = []
  const newFaces: TriFace[] = []
  const pointMap = new Map<string, number>()
  for (const face of faces) {
    subdivideFace(face, vertices, subdivisions, radius, pointMap, newVertices, newFaces)
  }
  return { vertices: newVertices, faces: newFaces }
}

// Builds the planar dual of a closed, consistently-wound triangle mesh: one dual vertex
// per input face (its centroid, projected back onto the sphere), and one dual face per
// input vertex (the ring of surrounding face-centroids). This is exactly how a Goldberg
// polyhedron is derived from a geodesic icosahedron.
function computeDualPolyhedron(
  vertices: THREE.Vector3[],
  faces: TriFace[],
): { vertices: THREE.Vector3[]; faces: Face[] } {
  const radius = vertices[0].length()
  const dualVertices = faces.map((face) => {
    const centroid = new THREE.Vector3()
    for (const idx of face) centroid.add(vertices[idx])
    return centroid.multiplyScalar(1 / face.length).normalize().multiplyScalar(radius)
  })

  const edgeToFace = new Map<string, number>()
  faces.forEach((face, fi) => {
    for (let i = 0; i < face.length; i++) {
      edgeToFace.set(`${face[i]}_${face[(i + 1) % face.length]}`, fi)
    }
  })

  const facesByVertex = new Map<number, number>()
  faces.forEach((face, fi) => {
    for (const v of face) {
      if (!facesByVertex.has(v)) facesByVertex.set(v, fi)
    }
  })

  const dualFaces: Face[] = []
  for (const [v, startFace] of facesByVertex) {
    const ring: number[] = []
    let currentFace = startFace
    do {
      ring.push(currentFace)
      const face = faces[currentFace]
      const idx = face.indexOf(v)
      const prev = face[(idx + 2) % face.length]
      const nextFace = edgeToFace.get(`${v}_${prev}`)
      if (nextFace === undefined) break
      currentFace = nextFace
    } while (currentFace !== startFace && ring.length <= faces.length)
    dualFaces.push(ring)
  }

  return { vertices: dualVertices, faces: dualFaces }
}

function computeEdges(faces: Face[]): Edge[] {
  const seen = new Map<string, Edge>()
  for (const face of faces) {
    for (let i = 0; i < face.length; i++) {
      const x = face[i]
      const y = face[(i + 1) % face.length]
      const key = x < y ? `${x}_${y}` : `${y}_${x}`
      if (!seen.has(key)) seen.set(key, x < y ? [x, y] : [y, x])
    }
  }
  return Array.from(seen.values())
}

export interface Layer {
  height: number
  vertexIndices: number[]
}

export interface PolyhedronData {
  vertices: THREE.Vector3[]
  faces: Face[]
  edges: Edge[]
  layers: Layer[] // sorted top (index 0) to bottom
}

const HEIGHT_EPS = 1e-4

// Groups vertices into horizontal layers by height, sorted top (index 0) to bottom - purely
// geometric, so it works equally well on a freshly generated polyhedron or on vertices
// restored from a saved config.
export function computeLayers(vertices: THREE.Vector3[]): Layer[] {
  const order = vertices.map((_, i) => i).sort((a, b) => vertices[b].y - vertices[a].y)
  const layers: Layer[] = []
  for (const idx of order) {
    const y = vertices[idx].y
    const current = layers[layers.length - 1]
    if (current && Math.abs(current.height - y) < HEIGHT_EPS) {
      current.vertexIndices.push(idx)
    } else {
      layers.push({ height: y, vertexIndices: [idx] })
    }
  }
  return layers
}

function getAxisVector(
  vertices: THREE.Vector3[],
  faces: Face[],
  edges: Edge[],
  axisType: AxisType,
): THREE.Vector3 {
  if (axisType === 'vertex') {
    return vertices[0].clone().normalize()
  }
  if (axisType === 'face') {
    const [a, b, c] = faces[0]
    return vertices[a]
      .clone()
      .add(vertices[b])
      .add(vertices[c])
      .multiplyScalar(1 / 3)
      .normalize()
  }
  const [a, b] = edges[0]
  return vertices[a].clone().add(vertices[b]).multiplyScalar(0.5).normalize()
}

// The dome's real-world size: the diameter (in mm) of the sphere its vertices sit on.
export const DEFAULT_DIAMETER_MM = 5000

export function computePolyhedron(
  shape: ShapeType,
  axisType: AxisType,
  subdivisions = MIN_SUBDIVISIONS,
  diameter = DEFAULT_DIAMETER_MM,
): PolyhedronData {
  const baseShape: BaseShapeType = shape === 'goldberg' ? 'icosahedron' : shape
  const raw = RAW_SHAPE_DATA[baseShape]
  const baseVertices = raw.vertices.map((v) => new THREE.Vector3(...v))
  const baseFaces = raw.faces
  const baseEdges = computeEdges(baseFaces)

  const axisVec = getAxisVector(baseVertices, baseFaces, baseEdges, axisType)

  const clamped = Math.min(Math.max(subdivisions, MIN_SUBDIVISIONS), MAX_SUBDIVISIONS)
  const { vertices: subdividedVertices, faces: subdividedFaces } = subdividePolyhedron(
    baseVertices,
    baseFaces,
    clamped,
  )

  const { vertices: finalVertices, faces } =
    shape === 'goldberg'
      ? computeDualPolyhedron(subdividedVertices, subdividedFaces)
      : { vertices: subdividedVertices, faces: subdividedFaces }
  const edges = computeEdges(faces)

  const up = new THREE.Vector3(0, 1, 0)
  const quat = new THREE.Quaternion().setFromUnitVectors(axisVec, up)
  // Every vertex sits on the raw shape's own radius (subdivision/dual construction both
  // normalize onto it); rescale that onto the requested real-world diameter, in mm.
  const scale = diameter / 2 / baseVertices[0].length()
  const vertices = finalVertices.map((v) =>
    v.clone().applyQuaternion(quat).multiplyScalar(scale),
  )

  return { vertices, faces, edges, layers: computeLayers(vertices) }
}

export interface SlicedPolyhedron {
  vertices: THREE.Vector3[]
  keptVertexIndices: number[]
  keptEdges: Edge[]
  keptFaces: Face[]
}

export function sliceLayers(data: PolyhedronData, layerCount: number): SlicedPolyhedron {
  const count = Math.min(Math.max(layerCount, 1), data.layers.length)
  const kept = new Set<number>()
  for (let i = 0; i < count; i++) {
    for (const idx of data.layers[i].vertexIndices) kept.add(idx)
  }
  return {
    vertices: data.vertices,
    keptVertexIndices: Array.from(kept),
    keptEdges: data.edges.filter(([a, b]) => kept.has(a) && kept.has(b)),
    keptFaces: data.faces.filter((f) => f.every((i) => kept.has(i))),
  }
}

// Every vertex among `candidateIds` on the same layer (same height) as the given vertex.
// Geometric, not tied to `data.layers`, so it naturally covers added vertices too - a
// midpoint created between two same-height points lands on that exact height itself.
export function findLayerGroup(
  vertexIndex: number,
  candidateIds: number[],
  positionOf: (id: number) => THREE.Vector3,
): number[] {
  const height = positionOf(vertexIndex).y
  const group = candidateIds.filter((id) => Math.abs(positionOf(id).y - height) < HEIGHT_EPS)
  return group.length > 0 ? group : [vertexIndex]
}

const ROTATION_EPS = 1e-4

// The orbit of a vertex under the shape's rotational symmetry about the main (vertical)
// axis: up to `fold` vertices among `candidateIds` on the same layer, evenly spaced around
// the axis, that the polyhedron's symmetry carries into one another. Works for added
// vertices too, as long as they were created from (and so inherit the arrangement of) a
// symmetric set of points. A vertex sitting on the axis itself (radius ~0, e.g. an apex)
// has no distinct rotational partners.
export function findRotationalSymmetryGroup(
  vertexIndex: number,
  candidateIds: number[],
  positionOf: (id: number) => THREE.Vector3,
  fold: number,
): number[] {
  const clicked = positionOf(vertexIndex)
  const radius = Math.hypot(clicked.x, clicked.z)
  if (radius < ROTATION_EPS) return [vertexIndex]

  const sameLayer = candidateIds.filter(
    (id) => Math.abs(positionOf(id).y - clicked.y) < HEIGHT_EPS,
  )

  const group = new Set<number>()
  const angleStep = (2 * Math.PI) / fold
  for (let k = 0; k < fold; k++) {
    const angle = angleStep * k
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const rx = clicked.x * cos - clicked.z * sin
    const rz = clicked.x * sin + clicked.z * cos

    let bestId: number | null = null
    let bestDist = Infinity
    for (const id of sameLayer) {
      const v = positionOf(id)
      const dist = Math.hypot(v.x - rx, v.z - rz)
      if (dist < bestDist) {
        bestDist = dist
        bestId = id
      }
    }
    if (bestId !== null && bestDist < 1e-3) group.add(bestId)
  }
  return Array.from(group)
}

// Per-vertex adjustment away from its default (canonical) position. All fields are 0
// at the default position: z shifts elevation in mm, r shifts radial distance from the
// main axis in mm, and theta rotates the vertex around the main (vertical) axis, in radians.
export interface VertexTransform {
  z: number
  r: number
  theta: number
}

export const DEFAULT_VERTEX_TRANSFORM: VertexTransform = { z: 0, r: 0, theta: 0 }

export function isDefaultVertexTransform(t: VertexTransform): boolean {
  return t.z === 0 && t.r === 0 && t.theta === 0
}

export function applyVertexTransform(v: THREE.Vector3, t: VertexTransform): THREE.Vector3 {
  if (isDefaultVertexTransform(t)) return v

  const radius = Math.hypot(v.x, v.z)
  const angle = Math.atan2(v.z, v.x) + t.theta
  const newRadius = radius + t.r
  return new THREE.Vector3(newRadius * Math.cos(angle), v.y + t.z, newRadius * Math.sin(angle))
}

export function applyVertexTransforms(
  vertices: THREE.Vector3[],
  transforms: ReadonlyMap<number, VertexTransform>,
): THREE.Vector3[] {
  if (transforms.size === 0) return vertices
  return vertices.map((v, idx) => {
    const t = transforms.get(idx)
    return t ? applyVertexTransform(v, t) : v
  })
}

// Same idea for added vertices: their default (untransformed) position is wherever they were
// created.
export function applyAddedVertexTransforms(
  baseAddedVertices: ReadonlyMap<number, THREE.Vector3>,
  transforms: ReadonlyMap<number, VertexTransform>,
): Map<number, THREE.Vector3> {
  const result = new Map<number, THREE.Vector3>()
  for (const [id, pos] of baseAddedVertices) {
    const t = transforms.get(id)
    result.set(id, t ? applyVertexTransform(pos, t) : pos)
  }
  return result
}

export function removeVertices(
  sliced: SlicedPolyhedron,
  removed: ReadonlySet<number>,
): SlicedPolyhedron {
  if (removed.size === 0) return sliced
  return {
    vertices: sliced.vertices,
    keptVertexIndices: sliced.keptVertexIndices.filter((i) => !removed.has(i)),
    keptEdges: sliced.keptEdges.filter(([a, b]) => !removed.has(a) && !removed.has(b)),
    keptFaces: sliced.keptFaces.filter((f) => f.every((i) => !removed.has(i))),
  }
}

// Every vertex id currently visible in the model: canonical vertices kept by the layer slice
// and not deleted, plus added vertices whose whole triangle (all three anchors) is still
// visible too - the same rule DomeMesh uses to decide what to render.
export function computeVisibleVertexIds(
  data: PolyhedronData,
  transformedVertices: THREE.Vector3[],
  layerCount: number,
  deletedVertexIndices: ReadonlySet<number>,
  addedFaces: Face[],
): number[] {
  const sliced = sliceLayers({ ...data, vertices: transformedVertices }, layerCount)
  const kept = removeVertices(sliced, deletedVertexIndices)
  const keptSet = new Set(kept.keptVertexIndices)

  const ids = new Set(kept.keptVertexIndices)
  for (const face of addedFaces) {
    const visible = face.every((idx) => (idx < 0 ? !deletedVertexIndices.has(idx) : keptSet.has(idx)))
    if (!visible) continue
    for (const idx of face) if (idx < 0) ids.add(idx)
  }
  return Array.from(ids)
}

// Vertex indices are non-negative for the shape's own (canonical) vertices, looked up in
// `canonicalVertices`. A user-added vertex instead gets a negative id, looked up in `added` -
// this keeps the two spaces collision-free without needing a combined array.
export function resolveVertexPosition(
  index: number,
  canonicalVertices: THREE.Vector3[],
  added: ReadonlyMap<number, THREE.Vector3>,
): THREE.Vector3 {
  return index >= 0 ? canonicalVertices[index] : added.get(index)!
}

// An edge's own "position", for grouping purposes (layer/symmetric selection work the same way
// for edges as for vertices, just keyed off this midpoint instead of the vertex itself). Takes
// a generic positionOf since an edge (canonical or added) can reference added vertices too.
export function edgeMidpoint(edge: Edge, positionOf: (id: number) => THREE.Vector3): THREE.Vector3 {
  return positionOf(edge[0]).clone().add(positionOf(edge[1])).multiplyScalar(0.5)
}

// a_b, order-independent - the shared key two vertex ids resolve to regardless of which order
// an edge lists them in.
export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`
}

// Every edge that already exists between two vertices, canonical or added, keyed the same
// order-independent way - so a new edge only gets created when one is genuinely missing.
// Signed the same way added vertices/faces are: non-negative indexes into `canonicalEdges`,
// negative into `addedEdges` via -(index + 1).
export function buildEdgeIndex(canonicalEdges: Edge[], addedEdges: Edge[]): Map<string, number> {
  const index = new Map<string, number>()
  canonicalEdges.forEach(([a, b], i) => index.set(edgeKey(a, b), i))
  addedEdges.forEach(([a, b], i) => index.set(edgeKey(a, b), -(i + 1)))
  return index
}

// A face's own "position", same idea as edgeMidpoint - takes a generic positionOf since a face
// (canonical or added) can reference added vertices too, unlike a canonical edge.
export function faceCentroid(face: Face, positionOf: (id: number) => THREE.Vector3): THREE.Vector3 {
  const sum = new THREE.Vector3()
  for (const idx of face) sum.add(positionOf(idx))
  return sum.multiplyScalar(1 / face.length)
}

// Every triangle hiding among the given edges: any 3 of them whose 6 endpoints resolve to
// exactly 3 distinct vertices, each appearing twice (the only way 3 distinct edges can do that
// is by forming a closed loop). Powers "Create Face" - select a batch of edges (e.g. a whole
// symmetric orbit) and turn every triangle among them into a face in one go. Takes an `edgeById`
// lookup (rather than a plain array) so the selection can mix canonical and added edges, keyed
// by the same signed id scheme used everywhere else.
export function findEdgeTriangles(
  edgeIndices: number[],
  edgeById: (id: number) => Edge,
): [number, number, number][] {
  const triangles: [number, number, number][] = []
  for (let i = 0; i < edgeIndices.length; i++) {
    for (let j = i + 1; j < edgeIndices.length; j++) {
      for (let k = j + 1; k < edgeIndices.length; k++) {
        const counts = new Map<number, number>()
        for (const e of [edgeById(edgeIndices[i]), edgeById(edgeIndices[j]), edgeById(edgeIndices[k])]) {
          for (const v of e) counts.set(v, (counts.get(v) ?? 0) + 1)
        }
        if (counts.size === 3 && Array.from(counts.values()).every((c) => c === 2)) {
          triangles.push(Array.from(counts.keys()) as [number, number, number])
        }
      }
    }
  }
  return triangles
}

// Greedily pairs up the given ids by nearest neighbor: take one, find the closest remaining id
// to it, pair them off, repeat until every id has been paired. Requires an even count. Shared
// by "Add Points" (bridges each pair with a new midpoint) and "Connect Vertices" (joins each
// pair directly).
export function pairByNearestNeighbor(
  ids: number[],
  positionOf: (id: number) => THREE.Vector3,
): [number, number][] {
  const pool = [...ids]
  const pairs: [number, number][] = []

  while (pool.length > 0) {
    const a = pool.shift()!
    let closestPos = 0
    let closestDist = Infinity
    for (let i = 0; i < pool.length; i++) {
      const dist = positionOf(a).distanceTo(positionOf(pool[i]))
      if (dist < closestDist) {
        closestDist = dist
        closestPos = i
      }
    }
    const b = pool.splice(closestPos, 1)[0]
    pairs.push([a, b])
  }
  return pairs
}

export interface VertexEdgeRef {
  edgeId: number
  neighborId: number
}

// Every edge - canonical or added - currently connecting to the given vertex: kept by the
// layer slice, not deleted, with its other endpoint likewise kept/not deleted. Mirrors the
// same visibility rules DomeMesh renders edges by, so this matches what's actually on screen.
export function computeVisibleVertexEdges(
  data: PolyhedronData,
  transformedVertices: THREE.Vector3[],
  layerCount: number,
  deletedVertexIndices: ReadonlySet<number>,
  deletedEdgeIndices: ReadonlySet<number>,
  addedEdges: Edge[],
  vertexId: number,
): VertexEdgeRef[] {
  const sliced = sliceLayers({ ...data, vertices: transformedVertices }, layerCount)
  const kept = removeVertices(sliced, deletedVertexIndices)
  const keptSet = new Set(kept.keptVertexIndices)

  const refs: VertexEdgeRef[] = []
  data.edges.forEach(([a, b], i) => {
    if (deletedEdgeIndices.has(i) || !keptSet.has(a) || !keptSet.has(b)) return
    if (a === vertexId) refs.push({ edgeId: i, neighborId: b })
    else if (b === vertexId) refs.push({ edgeId: i, neighborId: a })
  })
  addedEdges.forEach(([a, b], i) => {
    const id = -(i + 1)
    if (deletedEdgeIndices.has(id)) return
    const aOk = a < 0 ? !deletedVertexIndices.has(a) : keptSet.has(a)
    const bOk = b < 0 ? !deletedVertexIndices.has(b) : keptSet.has(b)
    if (!aOk || !bOk) return
    if (a === vertexId) refs.push({ edgeId: id, neighborId: b })
    else if (b === vertexId) refs.push({ edgeId: id, neighborId: a })
  })
  return refs
}

export interface HubEdgeMetric {
  edgeId: number
  neighborId: number
  thicknessMm: number
  angleToNextDeg: number
  offsetMm: number
}

// The hub-connector geometry at a vertex: the tangent plane there (normal = the direction from
// the gravity center to the vertex, i.e. perpendicular to the radius), with every connected
// edge's direction projected onto it. Reports, going around that plane, the angle from each
// edge to the next (wrapping back to the first) and each edge's own thickness (its override, or
// the model's default strut thickness) - what you'd need to lay out a flat connector plate for
// that vertex.
export function computeVertexHubMetrics(
  vertexPos: THREE.Vector3,
  center: THREE.Vector3,
  edges: VertexEdgeRef[],
  positionOf: (id: number) => THREE.Vector3,
  edgeThicknessOf: (edgeId: number) => number,
): HubEdgeMetric[] {
  if (edges.length === 0) return []

  const normal = vertexPos.clone().sub(center)
  if (normal.lengthSq() < RADIAL_EPS) normal.set(0, 1, 0)
  else normal.normalize()

  // An arbitrary right-handed basis (e1, e2) for the tangent plane.
  const arbitrary = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
  const e1 = arbitrary.clone().addScaledVector(normal, -arbitrary.dot(normal)).normalize()
  const e2 = normal.clone().cross(e1)

  const withAngles = edges.map((ref) => {
    const direction = positionOf(ref.neighborId).clone().sub(vertexPos)
    const projected = direction.addScaledVector(normal, -direction.dot(normal))
    let angle = Math.atan2(projected.dot(e2), projected.dot(e1))
    if (angle < 0) angle += 2 * Math.PI
    return { ref, angle }
  })
  withAngles.sort((a, b) => a.angle - b.angle)

  const n = withAngles.length
  // Angle (radians), going around the plane, from edge i to edge (i + 1) mod n.
  const deltas = withAngles.map(({ angle }, i) => {
    const next = withAngles[(i + 1) % n]
    return i === n - 1 ? next.angle - angle + 2 * Math.PI : next.angle - angle
  })
  const thicknesses = withAngles.map(({ ref }) => edgeThicknessOf(ref.edgeId))

  // Where a strut can be safely cut back from the vertex: far enough that its own beam width
  // no longer overlaps the neighboring struts' beams on either side, given each beam's
  // thickness and the (in-plane) angle between them. Each side alone must clear that neighbor,
  // so the offset that clears both sides is the larger of the two.
  return withAngles.map(({ ref }, i) => {
    const prevIdx = (i - 1 + n) % n
    const nextIdx = (i + 1) % n
    const aPrev = deltas[prevIdx]
    const aNext = deltas[i]
    const thickness = thicknesses[i]
    const thicknessPrev = thicknesses[prevIdx]
    const thicknessNext = thicknesses[nextIdx]

    const minOffsetPrev = thicknessPrev / (2 * Math.sin(aPrev)) + thickness / (2 * Math.tan(aPrev))
    const minOffsetNext = thickness / (2 * Math.tan(aNext)) + thicknessNext / (2 * Math.sin(aNext))

    return {
      edgeId: ref.edgeId,
      neighborId: ref.neighborId,
      thicknessMm: thickness,
      angleToNextDeg: (aNext * 180) / Math.PI,
      offsetMm: Math.max(minOffsetPrev, minOffsetNext),
    }
  })
}

export interface ModelBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

export interface ModelStats {
  vertexCount: number
  edgeCount: number
  faceCount: number
  bounds: ModelBounds | null
}

// Everything the HUD needs to know about the model currently on screen: how many
// vertices/edges/faces are actually visible (kept by the layer slice, not individually
// deleted - canonical and added alike, the same rules DomeMesh itself renders by) and the
// bounding box those visible vertices span, in mm.
export function computeModelStats(
  data: PolyhedronData,
  transformedVertices: THREE.Vector3[],
  addedVertices: ReadonlyMap<number, THREE.Vector3>,
  layerCount: number,
  deletedVertexIndices: ReadonlySet<number>,
  deletedEdgeIndices: ReadonlySet<number>,
  deletedFaceIndices: ReadonlySet<number>,
  addedFaces: Face[],
  addedEdges: Edge[],
): ModelStats {
  const sliced = sliceLayers({ ...data, vertices: transformedVertices }, layerCount)
  const kept = removeVertices(sliced, deletedVertexIndices)
  const keptSet = new Set(kept.keptVertexIndices)

  const visibleVertexIds = new Set(kept.keptVertexIndices)

  let faceCount = 0
  data.faces.forEach((f, i) => {
    if (!deletedFaceIndices.has(i) && f.every((idx) => keptSet.has(idx))) faceCount++
  })
  addedFaces.forEach((f, i) => {
    const id = -(i + 1)
    if (deletedFaceIndices.has(id)) return
    if (f.every((idx) => (idx < 0 ? !deletedVertexIndices.has(idx) : keptSet.has(idx)))) {
      faceCount++
      for (const idx of f) if (idx < 0) visibleVertexIds.add(idx)
    }
  })

  let edgeCount = 0
  data.edges.forEach(([a, b], i) => {
    if (!deletedEdgeIndices.has(i) && keptSet.has(a) && keptSet.has(b)) edgeCount++
  })
  addedEdges.forEach(([a, b], i) => {
    const id = -(i + 1)
    if (deletedEdgeIndices.has(id)) return
    const aOk = a < 0 ? !deletedVertexIndices.has(a) : keptSet.has(a)
    const bOk = b < 0 ? !deletedVertexIndices.has(b) : keptSet.has(b)
    if (aOk && bOk) edgeCount++
  })

  let bounds: ModelBounds | null = null
  for (const id of visibleVertexIds) {
    const p = resolveVertexPosition(id, transformedVertices, addedVertices)
    if (!bounds) {
      bounds = { minX: p.x, maxX: p.x, minY: p.y, maxY: p.y, minZ: p.z, maxZ: p.z }
    } else {
      bounds.minX = Math.min(bounds.minX, p.x)
      bounds.maxX = Math.max(bounds.maxX, p.x)
      bounds.minY = Math.min(bounds.minY, p.y)
      bounds.maxY = Math.max(bounds.maxY, p.y)
      bounds.minZ = Math.min(bounds.minZ, p.z)
      bounds.maxZ = Math.max(bounds.maxZ, p.z)
    }
  }

  return { vertexCount: visibleVertexIds.size, edgeCount, faceCount, bounds }
}

export interface AddedGeometry {
  vertices: Map<number, THREE.Vector3>
  faces: Face[]
  nextId: number
}

// Pairs up the given vertices by nearest neighbor, adding a new vertex at each pair's midpoint
// and connecting all three into a triangular face.
export function buildAddedGeometry(
  selectedIndices: number[],
  positionOf: (index: number) => THREE.Vector3,
  startId: number,
): AddedGeometry {
  const vertices = new Map<number, THREE.Vector3>()
  const faces: Face[] = []
  let nextId = startId

  for (const [a, b] of pairByNearestNeighbor(selectedIndices, positionOf)) {
    const midpoint = positionOf(a).clone().add(positionOf(b)).multiplyScalar(0.5)
    vertices.set(nextId, midpoint)
    faces.push([a, b, nextId])
    nextId -= 1
  }

  return { vertices, faces, nextId }
}

const RADIAL_EPS = 1e-9

// Rescales (guideX, guideY, guideZ) away from the center, along its own direction from that
// center, until its distance from the center equals `targetRadius`. Preserves the point's
// direction from the center, since that's exactly what's being held fixed.
export function scaleToRadius(
  guideX: number,
  guideY: number,
  guideZ: number,
  centerY: number,
  targetRadius: number,
): THREE.Vector3 {
  const axialOffset = guideY - centerY
  const dist = Math.hypot(guideX, axialOffset, guideZ)
  if (dist < RADIAL_EPS) return new THREE.Vector3(0, centerY + targetRadius, 0)

  const scale = targetRadius / dist
  return new THREE.Vector3(guideX * scale, centerY + axialOffset * scale, guideZ * scale)
}

// The (z, r, theta) transform that, applied to `canonicalPos` via applyVertexTransform, lands
// exactly on `targetPos`. Used to bake an absolute target position (e.g. a point moved onto a
// given sphere) into the same cylindrical-offset representation manual edits use, replacing
// whatever transform (if any) was there before.
export function computeTransformToPosition(
  canonicalPos: THREE.Vector3,
  targetPos: THREE.Vector3,
): VertexTransform {
  const baseCylRadius = Math.hypot(canonicalPos.x, canonicalPos.z)
  const targetCylRadius = Math.hypot(targetPos.x, targetPos.z)
  const baseAngle = Math.atan2(canonicalPos.z, canonicalPos.x)
  const targetAngle = Math.atan2(targetPos.z, targetPos.x)
  return {
    z: targetPos.y - canonicalPos.y,
    r: targetCylRadius - baseCylRadius,
    theta: targetCylRadius > RADIAL_EPS ? targetAngle - baseAngle : 0,
  }
}

