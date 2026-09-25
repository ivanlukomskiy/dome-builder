import type { VertexEdgesInfo } from './edgesInfo'
import type { FlangeFoot } from './flangeGeometry'

// Flange plates are expensive to build (a 2D outline of ~60 boolean cuts, then extrude + mesh) but
// most of them are copies of each other: in a symmetric dome many hubs have exactly the same
// struts, angles and parameters, differing only by where they sit and how they're turned about
// the vertex's normal. So instead of building one flange per vertex we
//   1. group vertices by a rotation-invariant signature of their flange inputs,
//   2. build ONE mesh per group, in a canonical local frame (origin at 0, normal +z, xDir +x,
//      extrusion centered on z = 0 - see previewBuilder.worker.ts),
//   3. place that mesh at every vertex of the group (both plates of the pair) with a rigid
//      transform - pure JS, no opencascade - and
//   4. remember the local meshes across rebuilds (flangeMeshCache), so changing something that
//      doesn't affect the flanges doesn't rebuild them at all.
// This file is the pure-JS part of that (no WASM), used by the main thread.

type Vec3 = [number, number, number]

export interface MeshData {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
}

// Rounding used to compare inputs - far finer than anything that changes the geometry visibly
// (1e-4 mm / degree), coarse enough to absorb floating-point noise between symmetric vertices.
const PRECISION = 1e4
function num(n: number): string {
  return String(Math.round(n * PRECISION) / PRECISION)
}

function mod360(deg: number): number {
  return ((deg % 360) + 360) % 360
}

// The foot's own dimensions (not its direction, which is folded in relative to the edges instead).
function footShapeKey(foot: FlangeFoot): string {
  return [foot.length, foot.thickness, foot.grooveLength, foot.holeOffset, foot.tipOffset].map(num).join(',')
}

export interface FlangeSignature {
  key: string
  // Absolute angle (degrees, in the vertex's own tangent frame) of the edge the canonical
  // rotation starts at. Two vertices with equal keys differ, as flanges, by a rotation about
  // their normal of exactly the difference of these.
  startAngleDeg: number
}

// `context` carries everything shared by all vertices that affects the flange (global flange
// parameters, extrusion thickness) - see flangeSignatureContext. Everything about the vertex
// that the flange outline depends on is folded in below: each edge's thickness, strut-end
// measurements, wedge angle, whether a face fills the wedge, and its direction relative to the
// first edge. Absolute angles and ids (edgeId, neighbor, face ids: only used for labels) are
// deliberately left out, and the edge list is read from whichever start gives the smallest
// string, so a rotated but otherwise identical hub yields the same key.
export function computeFlangeSignature(vertex: VertexEdgesInfo, context: string): FlangeSignature {
  const edges = vertex.edges
  const n = edges.length

  let best = ''
  let bestStart = 0
  for (let start = 0; start < n; start++) {
    const startAngle = edges[start].projectedAngleDeg
    const parts: string[] = []
    for (let k = 0; k < n; k++) {
      const e = edges[(start + k) % n]
      const strutEnd = Object.keys(e.strutEnd)
        .sort()
        .map((field) => num(e.strutEnd[field as keyof typeof e.strutEnd]))
        .join(',')
      parts.push(
        [
          num(mod360(e.projectedAngleDeg - startAngle)),
          num(e.angleToNextEdgeDeg),
          e.hasFaceToNextEdge ? 1 : 0,
          num(e.thicknessMm),
          num(e.offsetMm),
          strutEnd,
        ].join('|'),
      )
    }
    // The foot's direction, relative to the first edge, is part of what makes two hubs identical.
    const footDirection = vertex.foot ? `;foot@${num(mod360(vertex.foot.projectedAngleDeg - startAngle))}` : ''
    const candidate = parts.join(';') + footDirection
    if (start === 0 || candidate < best) {
      best = candidate
      bestStart = start
    }
  }

  return {
    key: `${context}#${n}#${vertex.flangeOverrides ? JSON.stringify(vertex.flangeOverrides) : ''}#${vertex.foot ? footShapeKey(vertex.foot) : ''}#${best}`,
    startAngleDeg: n > 0 ? edges[bestStart].projectedAngleDeg : 0,
  }
}

export function flangeSignatureContext(flangeParams: object, grooveDepth: number): string {
  return JSON.stringify([flangeParams, grooveDepth])
}

export interface FlangeGroupMember {
  vertex: VertexEdgesInfo
  // See FlangeSignature.startAngleDeg.
  startAngleDeg: number
}

export interface FlangeGroup {
  key: string
  // The vertex whose actual 2D outline gets built if the group isn't cached (members[0]).
  representative: FlangeGroupMember
  members: FlangeGroupMember[]
}

export function groupFlanges(vertices: readonly VertexEdgesInfo[], context: string): FlangeGroup[] {
  const groups = new Map<string, FlangeGroup>()
  for (const vertex of vertices) {
    const { key, startAngleDeg } = computeFlangeSignature(vertex, context)
    const member: FlangeGroupMember = { vertex, startAngleDeg }
    const group = groups.get(key)
    if (group) group.members.push(member)
    else groups.set(key, { key, representative: member, members: [member] })
  }
  return Array.from(groups.values())
}

// A flange mesh in the canonical local frame, plus the `startAngleDeg` of the vertex whose
// outline it was built from. Placing it for a member of the same group means turning it by
// `member.startAngleDeg - built.startAngleDeg` about the member's normal (see flangeFrame).
export interface LocalFlange {
  mesh: MeshData
  startAngleDeg: number
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export interface Frame {
  origin: Vec3
  xDir: Vec3
  yDir: Vec3
  zDir: Vec3
}

// Where a flange mesh built in the canonical local frame goes for this vertex: the vertex's
// tangent plane (origin at the vertex, normal, xDir = e1 - exactly the plane the outline used to
// be sketched on directly), turned by `deltaDeg` about the normal, and pushed `offsetAlongNormal`
// along it (the two plates of a hub sit `+/- span` from the vertex).
export function flangeFrame(vertex: VertexEdgesInfo, deltaDeg: number, offsetAlongNormal: number): Frame {
  const { normal, e1, origin } = vertex.tangentPlane
  const e2 = cross(normal, e1)
  const c = Math.cos((deltaDeg * Math.PI) / 180)
  const s = Math.sin((deltaDeg * Math.PI) / 180)
  const xDir: Vec3 = [c * e1[0] + s * e2[0], c * e1[1] + s * e2[1], c * e1[2] + s * e2[2]]
  const yDir: Vec3 = [c * e2[0] - s * e1[0], c * e2[1] - s * e1[1], c * e2[2] - s * e1[2]]
  return {
    origin: [
      origin[0] + normal[0] * offsetAlongNormal,
      origin[1] + normal[1] * offsetAlongNormal,
      origin[2] + normal[2] * offsetAlongNormal,
    ],
    xDir,
    yDir,
    zDir: normal,
  }
}

// A rigid copy of `mesh` (canonical local frame) in world space. Always allocates fresh buffers
// (the cached local mesh is shared by every placement, and each piece's buffers are handed on
// independently).
export function placeMesh(mesh: MeshData, frame: Frame): MeshData {
  const { origin, xDir, yDir, zDir } = frame
  const positions = new Float32Array(mesh.positions.length)
  const normals = new Float32Array(mesh.normals.length)
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i]
    const y = mesh.positions[i + 1]
    const z = mesh.positions[i + 2]
    positions[i] = origin[0] + x * xDir[0] + y * yDir[0] + z * zDir[0]
    positions[i + 1] = origin[1] + x * xDir[1] + y * yDir[1] + z * zDir[1]
    positions[i + 2] = origin[2] + x * xDir[2] + y * yDir[2] + z * zDir[2]
    const nx = mesh.normals[i]
    const ny = mesh.normals[i + 1]
    const nz = mesh.normals[i + 2]
    normals[i] = nx * xDir[0] + ny * yDir[0] + nz * zDir[0]
    normals[i + 1] = nx * xDir[1] + ny * yDir[1] + nz * zDir[1]
    normals[i + 2] = nx * xDir[2] + ny * yDir[2] + nz * zDir[2]
  }
  return { positions, normals, indices: mesh.indices.slice() }
}

// Local flanges by signature key, kept for the whole session so a rebuild only has to
// build flanges whose inputs actually changed. `null` = the outline came out empty; not cached
// (cheap to find out again, and the cause may be transient).
const MAX_CACHED_FLANGE_MESHES = 64
const cache = new Map<string, LocalFlange>()

export const flangeMeshCache = {
  get(key: string): LocalFlange | undefined {
    const entry = cache.get(key)
    if (entry) {
      // Refresh recency (Map iterates in insertion order).
      cache.delete(key)
      cache.set(key, entry)
    }
    return entry
  },
  set(key: string, entry: LocalFlange): void {
    cache.delete(key)
    cache.set(key, entry)
    while (cache.size > MAX_CACHED_FLANGE_MESHES) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  },
  clear(): void {
    cache.clear()
  },
}

// While developing, an edit to the flange code (or anything else HMR reloads) may change what a
// signature stands for - never serve meshes built by older code.
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => cache.clear())
}
