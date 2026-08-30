import * as THREE from 'three'

export type ShapeType = 'octahedron' | 'icosahedron' | 'goldberg'
export type AxisType = 'vertex' | 'face' | 'edge'

export type SelectionMode = 'point' | 'layer' | 'symmetric'

export const SELECTION_MODE_OPTIONS: { value: SelectionMode; label: string; hint: string }[] = [
  { value: 'point', label: 'Points', hint: 'Click a vertex to select it' },
  { value: 'layer', label: 'Layer', hint: 'Click a vertex to select its whole layer' },
  {
    value: 'symmetric',
    label: 'Symmetric',
    hint: 'Click a vertex to select its symmetric group',
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
type Edge = [number, number]

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

export function computePolyhedron(
  shape: ShapeType,
  axisType: AxisType,
  subdivisions = MIN_SUBDIVISIONS,
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
  const vertices = finalVertices.map((v) => v.clone().applyQuaternion(quat))

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

  return { vertices, faces, edges, layers }
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
// at the default position: z shifts elevation by a fraction of the model's total height,
// r shifts radial distance from the main axis by a fraction of the model's max radius,
// and theta rotates the vertex around the main (vertical) axis, in radians.
export interface VertexTransform {
  z: number
  r: number
  theta: number
}

export const DEFAULT_VERTEX_TRANSFORM: VertexTransform = { z: 0, r: 0, theta: 0 }

export function isDefaultVertexTransform(t: VertexTransform): boolean {
  return t.z === 0 && t.r === 0 && t.theta === 0
}

export interface ModelExtent {
  totalHeight: number
  maxRadius: number
}

// The reference scale transforms are measured against: the untransformed canonical model's
// own height and max radial distance from the main axis. Kept fixed regardless of what's
// currently selected, sliced, or transformed, so fractional edits stay stable.
export function computeModelExtent(canonicalVertices: THREE.Vector3[]): ModelExtent {
  let minY = Infinity
  let maxY = -Infinity
  let maxRadius = 0
  for (const v of canonicalVertices) {
    if (v.y < minY) minY = v.y
    if (v.y > maxY) maxY = v.y
    maxRadius = Math.max(maxRadius, Math.hypot(v.x, v.z))
  }
  return { totalHeight: maxY - minY, maxRadius }
}

export function applyVertexTransform(
  v: THREE.Vector3,
  t: VertexTransform,
  extent: ModelExtent,
): THREE.Vector3 {
  if (isDefaultVertexTransform(t)) return v

  const radius = Math.hypot(v.x, v.z)
  const angle = Math.atan2(v.z, v.x) + t.theta
  const newRadius = radius + t.r * extent.maxRadius
  return new THREE.Vector3(
    newRadius * Math.cos(angle),
    v.y + t.z * extent.totalHeight,
    newRadius * Math.sin(angle),
  )
}

// Applies per-vertex transforms, measuring height/radius fractions against the untransformed
// model's own extent so edits stay stable regardless of what's currently selected or sliced.
export function applyVertexTransforms(
  vertices: THREE.Vector3[],
  transforms: ReadonlyMap<number, VertexTransform>,
): THREE.Vector3[] {
  if (transforms.size === 0) return vertices
  const extent = computeModelExtent(vertices)
  return vertices.map((v, idx) => {
    const t = transforms.get(idx)
    return t ? applyVertexTransform(v, t, extent) : v
  })
}

// Same idea for added vertices: their default (untransformed) position is wherever they were
// created, but the z/r/theta fractions are still measured against the canonical model's extent
// so an added point's transform behaves the same way a canonical vertex's does.
export function applyAddedVertexTransforms(
  baseAddedVertices: ReadonlyMap<number, THREE.Vector3>,
  canonicalVertices: THREE.Vector3[],
  transforms: ReadonlyMap<number, VertexTransform>,
): Map<number, THREE.Vector3> {
  const extent = computeModelExtent(canonicalVertices)
  const result = new Map<number, THREE.Vector3>()
  for (const [id, pos] of baseAddedVertices) {
    const t = transforms.get(id)
    result.set(id, t ? applyVertexTransform(pos, t, extent) : pos)
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

export interface AddedGeometry {
  vertices: Map<number, THREE.Vector3>
  faces: Face[]
  nextId: number
}

// Greedily pairs up the given vertices by nearest neighbor: take one, find the closest
// remaining vertex to it, add a new vertex at their midpoint, and connect all three into a
// triangular face. Repeats until every input vertex has been paired. Requires an even count.
export function buildAddedGeometry(
  selectedIndices: number[],
  positionOf: (index: number) => THREE.Vector3,
  startId: number,
): AddedGeometry {
  const pool = [...selectedIndices]
  const vertices = new Map<number, THREE.Vector3>()
  const faces: Face[] = []
  let nextId = startId

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
    const midpoint = positionOf(a).clone().add(positionOf(b)).multiplyScalar(0.5)
    vertices.set(nextId, midpoint)
    faces.push([a, b, nextId])
    nextId -= 1
  }

  return { vertices, faces, nextId }
}
