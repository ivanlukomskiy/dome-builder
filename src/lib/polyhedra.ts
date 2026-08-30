import * as THREE from 'three'
import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping'

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

// A point's distance from the dome's center point (on the main vertical axis, at height
// `centerY`) - the radius of the sphere, centered there, that the point sits on.
export function sphereRadius(point: THREE.Vector3, centerY: number): number {
  return Math.hypot(point.x, point.y - centerY, point.z)
}

const RADIAL_EPS = 1e-9

// Rescales (guideX, guideY, guideZ) away from the center, along its own direction from that
// center, until its distance from the center equals `targetRadius`. Preserves the point's
// direction from the center, since that's exactly what's being held fixed.
function scaleToRadius(
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

// Turns a straight edge into `segments` sub-segments that bulge into a smooth arc: each
// intermediate point starts as a plain straight-line interpolation (fixing its direction from
// the center), then is rescaled from that center along that same direction until its distance
// from the center matches the value linearly interpolated between the edge's two endpoints -
// so the edge follows the sphere family from one endpoint's sphere to the other's.
export function computeArcEdgePoints(
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  centerY: number,
  segments: number,
): THREE.Vector3[] {
  const count = Math.max(1, Math.round(segments))
  if (count === 1) return [p1, p2]

  const r1 = sphereRadius(p1, centerY)
  const r2 = sphereRadius(p2, centerY)

  const points: THREE.Vector3[] = []
  for (let k = 0; k <= count; k++) {
    const t = k / count
    const guideX = p1.x + (p2.x - p1.x) * t
    const guideZ = p1.z + (p2.z - p1.z) * t
    const guideY = p1.y + (p2.y - p1.y) * t
    const targetRadius = r1 + (r2 - r1) * t
    points.push(scaleToRadius(guideX, guideY, guideZ, centerY, targetRadius))
  }
  return points
}

function pushQuad(
  triangles: THREE.Vector3[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  d: THREE.Vector3,
): void {
  triangles.push(a, b, c)
  triangles.push(a, c, d)
}

type Point2 = [number, number]

function sub2(a: Point2, b: Point2): Point2 {
  return [a[0] - b[0], a[1] - b[1]]
}

function normalize2(p: Point2): Point2 {
  const len = Math.hypot(p[0], p[1])
  return len < RADIAL_EPS ? [1, 0] : [p[0] / len, p[1] / len]
}

function addScaled2(p: Point2, dir: Point2, dist: number): Point2 {
  return [p[0] + dir[0] * dist, p[1] + dir[1] * dist]
}

// The rectangle sitting on a strut's end, used to square off the joint: one side is the
// "side line" (innerPt-outerPt, length `width`), extending `depth` inward along the strut
// (tangentIn) so that unioning it into the main polygon overwrites whatever the arc's
// curvature did to the boundary near the tip with a flat, perpendicular end.
function buildPositiveJointRect(
  innerPt: Point2,
  outerPt: Point2,
  tangentIn: Point2,
  depth: number,
): Ring {
  const innerFar = addScaled2(innerPt, tangentIn, depth)
  const outerFar = addScaled2(outerPt, tangentIn, depth)
  return [outerPt, innerPt, innerFar, outerFar, outerPt]
}

// The two rectangles flanking a positive joint rectangle's `depth`-length sides, each
// running from that side out past the strut's width by a large margin. Subtracting them
// trims away any part of the (curved) main polygon that pokes out past the flat joint
// rectangle's straight edges near the tip.
function buildNegativeJointRects(
  innerPt: Point2,
  outerPt: Point2,
  tangentIn: Point2,
  depth: number,
  radialOut: Point2,
  margin: number,
): [Ring, Ring] {
  const innerFar = addScaled2(innerPt, tangentIn, depth)
  const outerFar = addScaled2(outerPt, tangentIn, depth)
  const outerRect: Ring = [
    outerPt,
    outerFar,
    addScaled2(outerFar, radialOut, margin),
    addScaled2(outerPt, radialOut, margin),
    outerPt,
  ]
  const innerRect: Ring = [
    innerPt,
    innerFar,
    addScaled2(innerFar, radialOut, -margin),
    addScaled2(innerPt, radialOut, -margin),
    innerPt,
  ]
  return [outerRect, innerRect]
}

// Rounds every coordinate to a fixed grid before it reaches the clipping library. Two points
// that are mathematically meant to coincide (e.g. a corner shared by two independently-built
// rectangles) can otherwise differ in their last couple of significant digits depending on the
// arithmetic path used to compute each - well within visual tolerance at this model's scale,
// but enough to make the sweep-line algorithm's segment ordering inconsistent and fail to close
// its output rings.
const COORD_SNAP = 1e9

function snapRing(ring: Ring): Ring {
  return ring.map(([x, y]): [number, number] => [
    Math.round(x * COORD_SNAP) / COORD_SNAP,
    Math.round(y * COORD_SNAP) / COORD_SNAP,
  ])
}

function ringToVec2(ring: Ring): THREE.Vector2[] {
  // polygon-clipping's output rings repeat their first point at the end; drop it so the
  // triangulator and wall-edge walk don't see a degenerate zero-length closing edge.
  const points = ring.map(([x, y]) => new THREE.Vector2(x, y))
  const first = points[0]
  const last = points[points.length - 1]
  if (points.length > 1 && first.distanceToSquared(last) < RADIAL_EPS) points.pop()
  return points
}

// Builds a strut as a single flat "joint" polygon - the arc's width-wide ribbon with its two
// ends squared off against the arc's own curvature - then thickens that polygon into a solid
// beam. The joint polygon is assembled via 2D boolean ops, all within the plane shared by the
// arc, the sphere center, and the strut's own offset directions:
//   - main polygon: the ribbon traced by offsetting every arc point by half `width` toward and
//     away from the sphere center (inner/outer chains), closed off at both ends.
//   - positive joint rectangles: a `jointDistance`-deep rectangle at each end, flush with that
//     end's side line, reaching `jointDistance` back into the strut.
//   - negative joint rectangles: two per end, flanking the positive rectangle's inward-facing
//     sides and extending far past the strip's width, used to trim the curved boundary back to
//     that rectangle's straight edges.
// main ∪ positive rectangles, minus the negative rectangles, replaces the naturally curved ends
// with flat ones - a stable mating face for whatever joins struts at a shared vertex. The result
// is then thickened symmetrically along the plane's own normal by `thickness`, giving it depth.
export function extrudeArcToBeam(
  arcPoints: THREE.Vector3[],
  centerY: number,
  width: number,
  thickness: number,
  jointDistance: number,
): THREE.Vector3[] {
  const n = arcPoints.length
  if (n < 2) return []

  const halfWidth = width / 2
  const halfThickness = thickness / 2
  const center = new THREE.Vector3(0, centerY, 0)

  // Every arc point is a chord point rescaled along its own direction from `center`, so the
  // whole arc - and everything offset from it toward/away from that same center - stays within
  // the plane spanned by the two endpoints and the center.
  let normal = new THREE.Vector3().crossVectors(
    arcPoints[0].clone().sub(center),
    arcPoints[n - 1].clone().sub(center),
  )
  if (normal.lengthSq() < RADIAL_EPS) {
    const mid = arcPoints[Math.floor(n / 2)]
    normal = new THREE.Vector3().crossVectors(arcPoints[0].clone().sub(center), mid.clone().sub(center))
  }
  if (normal.lengthSq() < RADIAL_EPS) normal.set(0, 0, 1)
  normal.normalize()

  let e1 = arcPoints[0].clone().sub(center)
  if (e1.lengthSq() < RADIAL_EPS) e1 = arcPoints[n - 1].clone().sub(center)
  e1.normalize()
  const e2 = new THREE.Vector3().crossVectors(normal, e1).normalize()
  // e1 x e2 === normal by construction, so a counter-clockwise triangle in (e1, e2) 2D
  // coordinates faces +normal in 3D - relied on below to keep cap/wall winding consistent.

  const to2D = (p: THREE.Vector3): Point2 => {
    const rel = p.clone().sub(center)
    return [rel.dot(e1), rel.dot(e2)]
  }
  const to3D = ([x, y]: Point2): THREE.Vector3 =>
    center.clone().addScaledVector(e1, x).addScaledVector(e2, y)

  const pts2D = arcPoints.map(to2D)
  // The center is the 2D origin, so a point's own direction from the origin is exactly the
  // radial (toward/away from sphere center) direction at that point.
  const radialOut = pts2D.map(normalize2)

  const inner: Point2[] = pts2D.map((p, i) => addScaled2(p, radialOut[i], -halfWidth))
  const outer: Point2[] = pts2D.map((p, i) => addScaled2(p, radialOut[i], halfWidth))

  const mainRing: Ring = [...outer, ...[...inner].reverse(), outer[0]]

  const totalLen = pts2D.reduce(
    (sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p[0] - pts2D[i - 1][0], p[1] - pts2D[i - 1][1])),
    0,
  )
  // Keep the two joint zones from overlapping past the strut's midpoint.
  const depth = Math.max(0, Math.min(jointDistance, totalLen / 2 - 1e-6))

  const positiveRects: Ring[] = []
  const negativeRects: Ring[] = []
  if (depth > RADIAL_EPS) {
    // "Large" only needs to clear whatever bulge the arc's own curvature could plausibly put
    // past the strip's straight edge near a tip - bounded by `depth` and the local curvature,
    // never anywhere near the model's own scale. A margin comparable to that scale risks
    // sweeping the negative rectangles into each other (or into unrelated parts of this same
    // strut's geometry), which starves the clipping library's floating point sweep of
    // precision and makes it fail to close its output rings.
    const margin = Math.max(halfWidth, depth) * 4
    const startTangentIn = normalize2(sub2(pts2D[1], pts2D[0]))
    const endTangentIn = normalize2(sub2(pts2D[n - 2], pts2D[n - 1]))

    positiveRects.push(buildPositiveJointRect(inner[0], outer[0], startTangentIn, depth))
    positiveRects.push(buildPositiveJointRect(inner[n - 1], outer[n - 1], endTangentIn, depth))
    negativeRects.push(
      ...buildNegativeJointRects(inner[0], outer[0], startTangentIn, depth, radialOut[0], margin),
    )
    negativeRects.push(
      ...buildNegativeJointRects(
        inner[n - 1],
        outer[n - 1],
        endTangentIn,
        depth,
        radialOut[n - 1],
        margin,
      ),
    )
  }

  // At extreme slider combinations (e.g. joint distance and width both maxed out on a short
  // edge) the resulting rectangles can overlap in ways that push the clipping library's
  // floating-point sweep past what it can resolve. Rather than let a single strut's numerical
  // edge case blank the whole preview, fall back to the plain main polygon (no joint squaring)
  // for that strut alone.
  let jointPolygons: MultiPolygon
  try {
    const snappedMainRing = snapRing(mainRing)
    const unioned =
      positiveRects.length > 0
        ? polygonClipping.union(
            [snappedMainRing],
            ...positiveRects.map((r): Polygon => [snapRing(r)]),
          )
        : [[snappedMainRing]]
    jointPolygons =
      negativeRects.length > 0
        ? polygonClipping.difference(unioned, ...negativeRects.map((r): Polygon => [snapRing(r)]))
        : unioned
  } catch {
    jointPolygons = [[mainRing]]
  }

  const triangles: THREE.Vector3[] = []
  for (const polygon of jointPolygons) {
    if (polygon.length === 0) continue
    const [outerRing, ...holeRings] = polygon
    const contour = ringToVec2(outerRing)
    const holes = holeRings.map(ringToVec2)
    const combined = [...contour, ...holes.flat()]
    const capTriangles = THREE.ShapeUtils.triangulateShape(contour, holes)

    for (const [i0, i1, i2] of capTriangles) {
      const p0 = combined[i0]
      const p1 = combined[i1]
      const p2 = combined[i2]
      const signedArea2 = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)
      const [a, b, c] = signedArea2 >= 0 ? [p0, p1, p2] : [p0, p2, p1]

      const aTop = to3D([a.x, a.y]).addScaledVector(normal, halfThickness)
      const bTop = to3D([b.x, b.y]).addScaledVector(normal, halfThickness)
      const cTop = to3D([c.x, c.y]).addScaledVector(normal, halfThickness)
      triangles.push(aTop, bTop, cTop)

      const aBottom = to3D([a.x, a.y]).addScaledVector(normal, -halfThickness)
      const bBottom = to3D([b.x, b.y]).addScaledVector(normal, -halfThickness)
      const cBottom = to3D([c.x, c.y]).addScaledVector(normal, -halfThickness)
      triangles.push(aBottom, cBottom, bBottom)
    }

    for (const ring of [contour, ...holes]) {
      const m = ring.length
      for (let i = 0; i < m; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % m]
        const aTop = to3D([a.x, a.y]).addScaledVector(normal, halfThickness)
        const aBottom = to3D([a.x, a.y]).addScaledVector(normal, -halfThickness)
        const bTop = to3D([b.x, b.y]).addScaledVector(normal, halfThickness)
        const bBottom = to3D([b.x, b.y]).addScaledVector(normal, -halfThickness)
        pushQuad(triangles, aTop, aBottom, bBottom, bTop)
      }
    }
  }
  return triangles
}
