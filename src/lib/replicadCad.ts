import { Plane, Sketcher, setOC } from 'replicad'
import type { Drawing } from 'replicad'
import type * as THREE from 'three'
import type { StrutSketch } from './strutGeometry'

// The only module that touches replicad/opencascade.js. Callers reach it via a dynamic
// `import('./replicadCad')`, so its (sizeable) JS stays out of the main bundle until Preview
// mode actually needs it.

let readyPromise: Promise<void> | null = null

// Lazily downloads and initializes the opencascade.js WASM module (~20+ MB) and hands it to
// replicad via `setOC`. Safe to call repeatedly - after the first call, every caller just awaits
// the same promise.
export function ensureReplicadReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      const [{ default: initOpenCascade }, { default: wasmUrl }] = await Promise.all([
        import('replicad-opencascadejs'),
        import('replicad-opencascadejs/wasm?url'),
      ])
      const oc = await initOpenCascade({ locateFile: () => wasmUrl })
      setOC(oc)
    })()
  }
  return readyPromise
}

export interface StrutMesh {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
}

// Tessellation quality for the mesh replicad hands back - fine enough that the curved hub
// arcs read as smooth at dome scale (hundreds to low thousands of mm) without over-tessellating
// the mostly-flat sheet faces.
const MESH_TOLERANCE = 0.1
const MESH_ANGULAR_TOLERANCE = 0.3

// Builds one strut's solid from its flat sketch outline (see strutGeometry.ts) - sketch on the
// meridian plane, extrude by the sheet thickness, center the material on that plane, and
// tessellate. `ensureReplicadReady` must have resolved before calling this.
export function buildStrutMesh(sketch: StrutSketch, thicknessMm: number): StrutMesh {
  const plane = new Plane(
    [sketch.planeOrigin.x, sketch.planeOrigin.y, sketch.planeOrigin.z],
    [sketch.planeXDir.x, sketch.planeXDir.y, sketch.planeXDir.z],
    [sketch.planeNormal.x, sketch.planeNormal.y, sketch.planeNormal.z],
  )

  const sketcher = new Sketcher(plane)
  sketcher.movePointerTo(sketch.start)
  for (const { to, seg } of sketch.path) {
    if (seg.kind === 'line') sketcher.lineTo(to)
    else sketcher.threePointsArcTo(to, seg.via)
  }
  const drawing = sketcher.close()
  // The Sketcher clones the plane it's given rather than taking ownership of it, so both the
  // plane we built and the Sketcher's own clone need explicit disposal (WASM-backed objects
  // aren't garbage collected).
  sketcher.delete()
  plane.delete()

  const solid = drawing.extrude(thicknessMm)
  const { x: nx, y: ny, z: nz } = sketch.planeNormal
  // `.translate()` deletes `solid` itself and returns a distinct object, so there's nothing to
  // separately dispose of here - only `centered` (below) is still alive afterward.
  const centered = solid.translate([(-nx * thicknessMm) / 2, (-ny * thicknessMm) / 2, (-nz * thicknessMm) / 2])

  const mesh = centered.mesh({ tolerance: MESH_TOLERANCE, angularTolerance: MESH_ANGULAR_TOLERANCE })
  centered.delete()

  return {
    positions: Float32Array.from(mesh.vertices),
    normals: Float32Array.from(mesh.normals),
    indices: Uint32Array.from(mesh.triangles),
  }
}

export interface StrutPlane {
  origin: THREE.Vector3
  normal: THREE.Vector3
  xDir: THREE.Vector3
}

// Builds one strut's solid from a flat `Drawing` already in the strut's own 2D coordinates (see
// strutGeometryManual.ts's `computeStrutBoundaryManual`) - sketches it onto the actual meridian
// plane (rather than the default XY plane `meshDrawing` below uses), extrudes by the sheet
// thickness, centers the material on that plane, and tessellates. Returns null for an empty
// drawing. `ensureReplicadReady` must have resolved before calling this.
export function buildStrutMeshFromDrawing(drawing: Drawing, plane: StrutPlane, thicknessMm: number): StrutMesh | null {
  const ocPlane = new Plane(
    [plane.origin.x, plane.origin.y, plane.origin.z],
    [plane.xDir.x, plane.xDir.y, plane.xDir.z],
    [plane.normal.x, plane.normal.y, plane.normal.z],
  )

  let sketched
  try {
    sketched = drawing.sketchOnPlane(ocPlane)
  } catch {
    ocPlane.delete()
    return null
  }
  ocPlane.delete()

  // `.extrude()` consumes `sketched`'s own wire to build the solid, so - like `buildStrutMesh`'s
  // Sketch from `Sketcher.close()` - there's nothing left on it to separately dispose of.
  const solid = sketched.extrude(thicknessMm)

  const { x: nx, y: ny, z: nz } = plane.normal
  // `.translate()` deletes `solid` itself and returns a distinct object, mirroring buildStrutMesh.
  const centered = solid.translate([(-nx * thicknessMm) / 2, (-ny * thicknessMm) / 2, (-nz * thicknessMm) / 2])

  const mesh = centered.mesh({ tolerance: MESH_TOLERANCE, angularTolerance: MESH_ANGULAR_TOLERANCE })
  centered.delete()

  return {
    positions: Float32Array.from(mesh.vertices),
    normals: Float32Array.from(mesh.normals),
    indices: Uint32Array.from(mesh.triangles),
  }
}

// Meshes an arbitrary flat `Drawing` (e.g. from replicad's own `draw()`/boolean-op primitives -
// see strutGeometryManual.ts and the "Strut Shape Debug" tool) directly, without extruding: puts
// it on the default XY plane, turns it into a face, and tessellates. Returns null for an empty
// drawing (e.g. a `.cut()`/`.intersect()` that leaves nothing). `ensureReplicadReady` must have
// resolved before calling this.
export function meshDrawing(drawing: Drawing): StrutMesh | null {
  let sketched
  try {
    sketched = drawing.sketchOnPlane()
  } catch {
    return null
  }

  // A single-region drawing yields a Sketch (`.face()`); a drawing with several disjoint
  // regions yields a Sketches (`.faces()`, a compound) - both are meshable the same way.
  const shape = 'face' in sketched ? sketched.face() : sketched.faces()
  ;(sketched as { delete?: () => void }).delete?.()

  const mesh = shape.mesh({ tolerance: MESH_TOLERANCE, angularTolerance: MESH_ANGULAR_TOLERANCE })
  shape.delete()

  return {
    positions: Float32Array.from(mesh.vertices),
    normals: Float32Array.from(mesh.normals),
    indices: Uint32Array.from(mesh.triangles),
  }
}
