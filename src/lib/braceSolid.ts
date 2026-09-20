import * as THREE from 'three'

// A brace's own body: the bar between the two struts' brace plates. Its footprint is the
// quadrilateral through the four plate end points (two per strut, already moved out onto the
// plates' outer faces - see bracePlateEndPoints3D), extruded symmetrically along the quad's normal.
// Pure three.js math - no replicad/WASM - so it can run on the main thread.

export type Vec3 = [number, number, number]

// One strut's contribution to a brace: which brace, and its plate's two end points in 3D.
export interface BracePoints {
  braceId: number
  // Brace thickness, mm.
  thickness: number
  points: [Vec3, Vec3]
}

export interface BraceSolidMesh {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
}

// The four points as a quad in drawing order. The first strut's two points are taken as they
// come; the second strut's are paired up so that each is matched with the nearer of the first's
// (the shorter pairing never twists the quad into a bow-tie).
export function orderBraceQuad(a: [THREE.Vector3, THREE.Vector3], b: [THREE.Vector3, THREE.Vector3]): THREE.Vector3[] {
  const straight = a[0].distanceTo(b[0]) + a[1].distanceTo(b[1])
  const crossed = a[0].distanceTo(b[1]) + a[1].distanceTo(b[0])
  const [b0, b1] = straight <= crossed ? [b[0], b[1]] : [b[1], b[0]]
  return [a[0], a[1], b1, b0]
}

// The best-fit plane of the quad: its centroid and (Newell) unit normal. The four points are
// meant to be coplanar, but slightly off is fine - they get projected onto this plane.
export function fitQuadPlane(quad: THREE.Vector3[]): { centroid: THREE.Vector3; normal: THREE.Vector3 } {
  const centroid = new THREE.Vector3()
  quad.forEach((p) => centroid.add(p))
  centroid.divideScalar(quad.length)

  const normal = new THREE.Vector3()
  for (let i = 0; i < quad.length; i++) {
    const p = quad[i]
    const q = quad[(i + 1) % quad.length]
    normal.x += (p.y - q.y) * (p.z + q.z)
    normal.y += (p.z - q.z) * (p.x + q.x)
    normal.z += (p.x - q.x) * (p.y + q.y)
  }
  return { centroid, normal: normal.normalize() }
}

// The prism: the quad projected onto its plane and extruded `thickness / 2` each way. Flat-shaded
// (every face has its own vertices/normal), triangles wound counter-clockwise seen from outside.
// Null if the quad is degenerate or the thickness isn't positive.
export function buildBraceSolidMesh(
  a: [Vec3, Vec3],
  b: [Vec3, Vec3],
  thickness: number,
): BraceSolidMesh | null {
  if (!(thickness > 0)) return null
  const toV = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2])
  const quad = orderBraceQuad([toV(a[0]), toV(a[1])], [toV(b[0]), toV(b[1])])
  const { centroid, normal } = fitQuadPlane(quad)
  if (normal.lengthSq() < 0.5) return null

  const flat = quad.map((p) => p.clone().addScaledVector(normal, -p.clone().sub(centroid).dot(normal)))

  // Make the quad counter-clockwise around `normal`, so the top face (+normal) winds outward.
  const winding = new THREE.Vector3()
  for (let i = 0; i < 4; i++) winding.add(new THREE.Vector3().crossVectors(flat[i], flat[(i + 1) % 4]))
  if (winding.dot(normal) < 0) flat.reverse()

  const half = thickness / 2
  const top = flat.map((p) => p.clone().addScaledVector(normal, half))
  const bottom = flat.map((p) => p.clone().addScaledVector(normal, -half))

  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const addFace = (corners: THREE.Vector3[], n: THREE.Vector3) => {
    const base = positions.length / 3
    for (const c of corners) {
      positions.push(c.x, c.y, c.z)
      normals.push(n.x, n.y, n.z)
    }
    for (let i = 1; i < corners.length - 1; i++) indices.push(base, base + i, base + i + 1)
  }

  addFace(top, normal)
  addFace([...bottom].reverse(), normal.clone().negate())
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    const edge = new THREE.Vector3().subVectors(flat[j], flat[i])
    const n = new THREE.Vector3().crossVectors(edge, normal).normalize() // outward for a CCW quad
    addFace([bottom[i], bottom[j], top[j], top[i]], n)
  }

  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
  }
}

// Every brace that has plates on both of its struts, as one solid each. `parts` is the flat
// collection of every strut's BracePoints; a brace with fewer/more than two entries (one strut
// missing, or a brace beyond the first on its strut end) is skipped.
export function buildBraceSolids(parts: BracePoints[]): { braceId: number; mesh: BraceSolidMesh }[] {
  const byBrace = new Map<number, BracePoints[]>()
  for (const part of parts) {
    const list = byBrace.get(part.braceId)
    if (list) list.push(part)
    else byBrace.set(part.braceId, [part])
  }
  const solids: { braceId: number; mesh: BraceSolidMesh }[] = []
  for (const [braceId, list] of byBrace) {
    if (list.length !== 2) continue
    const mesh = buildBraceSolidMesh(list[0].points, list[1].points, list[0].thickness)
    if (mesh) solids.push({ braceId, mesh })
  }
  return solids
}
