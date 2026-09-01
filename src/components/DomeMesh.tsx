import { useCallback, useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ThreeEvent } from '@react-three/fiber'
import type { EditTarget, ViewMode } from '../App'
import type { Edge, Face, PolyhedronData } from '../lib/polyhedra'
import { removeVertices, resolveVertexPosition, sliceLayers } from '../lib/polyhedra'
import type { ToothParams } from '../lib/strutGeometry'
import { computeEdgeEndOffsets, computeStrutBoundary } from '../lib/strutGeometry'

// Vertex/center marker sizes, in mm - purely visual, sized to stay visible without dwarfing a
// typical (few-meter) dome.
const VERTEX_MARKER_RADIUS = 80
const SELECTED_VERTEX_MARKER_RADIUS = 115

// Clickable-edge cylinder radius while editing edges - deliberately thicker than the plain
// wireframe line so edges read as the interactive element in that mode.
const EDGE_MARKER_RADIUS = 40
const SELECTED_COLOR = '#f5a623'
const EDGE_DEFAULT_COLOR = new THREE.Color('#3a5a7a')
const EDGE_OVERRIDE_MIN_COLOR = new THREE.Color('#4fd97e')
const EDGE_OVERRIDE_MAX_COLOR = new THREE.Color('#ff3b3b')
// Override magnitude (mm) at which the color heatmap maxes out.
const EDGE_OVERRIDE_COLOR_REFERENCE = 300

// The heatmap color for a given thickness override (or the default tone if there isn't one) -
// shared between the clickable edge markers in Edit mode and the beam mesh in Preview, so a
// dome's strut coloring means the same thing in both places.
function edgeThicknessColor(override: number | undefined): THREE.Color {
  if (override === undefined) return EDGE_DEFAULT_COLOR.clone()
  const t = Math.min(override / EDGE_OVERRIDE_COLOR_REFERENCE, 1)
  return EDGE_OVERRIDE_MIN_COLOR.clone().lerp(EDGE_OVERRIDE_MAX_COLOR, t)
}

function edgeMarkerColor(override: number | undefined, isSelected: boolean): string {
  if (isSelected) return SELECTED_COLOR
  return `#${edgeThicknessColor(override).getHexString()}`
}

// Fan-triangulates a face (a triangle, or a pentagon/hexagon for a Goldberg dual face) from its
// first vertex, into its own small standalone geometry - used for individually clickable faces.
function buildFanGeometry(positions: THREE.Vector3[]): THREE.BufferGeometry {
  const verts: number[] = []
  const v0 = positions[0]
  for (let i = 1; i < positions.length - 1; i++) {
    const v1 = positions[i]
    const v2 = positions[i + 1]
    verts.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z)
  }
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geom.computeVertexNormals()
  return geom
}

interface DomeMeshProps {
  mode: ViewMode
  editTarget: EditTarget
  data: PolyhedronData
  layerCount: number
  transformedVertices: THREE.Vector3[]
  deletedVertexIndices: ReadonlySet<number>
  selectedVertexIndices: ReadonlySet<number>
  selectedEdgeIndices: ReadonlySet<number>
  deletedEdgeIndices: ReadonlySet<number>
  edgeThickness: ReadonlyMap<number, number>
  selectedFaceIndices: ReadonlySet<number>
  deletedFaceIndices: ReadonlySet<number>
  addedVertices: ReadonlyMap<number, THREE.Vector3>
  addedFaces: Face[]
  addedEdges: Edge[]
  centerY: number
  extrudeDistance: number
  thickness: number
  cornerLength: number
  offsetModifier: number
  toothHeight: number
  toothLength: number
  toothChamfer: number
  millRadius: number
  onVertexClick: (index: number) => void
  onEdgeClick: (index: number) => void
  onFaceClick: (id: number) => void
}

export function DomeMesh({
  mode,
  editTarget,
  data,
  layerCount,
  transformedVertices,
  deletedVertexIndices,
  selectedVertexIndices,
  selectedEdgeIndices,
  deletedEdgeIndices,
  edgeThickness,
  selectedFaceIndices,
  deletedFaceIndices,
  addedVertices,
  addedFaces,
  addedEdges,
  centerY,
  extrudeDistance,
  thickness,
  cornerLength,
  offsetModifier,
  toothHeight,
  toothLength,
  toothChamfer,
  millRadius,
  onVertexClick,
  onEdgeClick,
  onFaceClick,
}: DomeMeshProps) {
  const sliced = useMemo(() => {
    const layered = sliceLayers({ ...data, vertices: transformedVertices }, layerCount)
    return removeVertices(layered, deletedVertexIndices)
  }, [data, transformedVertices, layerCount, deletedVertexIndices])

  const keptSet = useMemo(() => new Set(sliced.keptVertexIndices), [sliced])

  // The canonical faces currently in view: kept by the layer slice and not individually
  // deleted. Keeps each face's own index into `data.faces` around, since that's what face
  // selection and deletion are keyed by.
  const visibleFaceEntries = useMemo(
    () =>
      data.faces
        .map((face, index) => ({ face, index }))
        .filter(({ face }) => face.every((i) => keptSet.has(i)))
        .filter(({ index }) => !deletedFaceIndices.has(index)),
    [data.faces, keptSet, deletedFaceIndices],
  )

  // Added faces/vertices only show while everything they were built from is still present:
  // canonical anchors must still be in view (kept by the layer slice and not deleted), any
  // added-vertex anchor must not itself have been deleted, and the face itself must not have
  // been deleted (signed the same way added vertices are: -(index in addedFaces) - 1).
  const visibleAddedFaceEntries = useMemo(
    () =>
      addedFaces
        .map((face, i) => ({ face, id: -(i + 1) }))
        .filter(
          ({ face, id }) =>
            !deletedFaceIndices.has(id) &&
            face.every((idx) => (idx < 0 ? !deletedVertexIndices.has(idx) : keptSet.has(idx))),
        ),
    [addedFaces, keptSet, deletedVertexIndices, deletedFaceIndices],
  )
  const visibleAddedFaces = useMemo(
    () => visibleAddedFaceEntries.map((e) => e.face),
    [visibleAddedFaceEntries],
  )

  const resolvePosition = useCallback(
    (idx: number) => resolveVertexPosition(idx, transformedVertices, addedVertices),
    [transformedVertices, addedVertices],
  )

  const visibleAddedVertexIds = useMemo(() => {
    const ids = new Set<number>()
    for (const face of visibleAddedFaces) {
      for (const idx of face) if (idx < 0) ids.add(idx)
    }
    return ids
  }, [visibleAddedFaces])

  const faceGeometry = useMemo(() => {
    const positions: number[] = []
    for (const { face } of visibleFaceEntries) {
      // Fan-triangulate each face (a triangle for triangular meshes, or a
      // pentagon/hexagon for a Goldberg polyhedron's dual faces) from vertex 0.
      const v0 = sliced.vertices[face[0]]
      for (let i = 1; i < face.length - 1; i++) {
        const v1 = sliced.vertices[face[i]]
        const v2 = sliced.vertices[face[i + 1]]
        positions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z)
      }
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geom.computeVertexNormals()
    return geom
  }, [visibleFaceEntries, sliced.vertices])

  const addedFaceGeometry = useMemo(() => {
    const positions: number[] = []
    for (const [i0, i1, i2] of visibleAddedFaces) {
      const v0 = resolvePosition(i0)
      const v1 = resolvePosition(i1)
      const v2 = resolvePosition(i2)
      positions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z)
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geom.computeVertexNormals()
    return geom
  }, [visibleAddedFaces, resolvePosition])

  // The canonical edges currently in view, keeping each one's index into `data.edges` around -
  // that index is what selection, deletion, and thickness overrides are keyed by.
  const visibleEdgeEntries = useMemo(
    () =>
      data.edges
        .map((edge, index) => ({ edge, index }))
        .filter(({ edge: [a, b], index }) => keptSet.has(a) && keptSet.has(b) && !deletedEdgeIndices.has(index)),
    [data.edges, keptSet, deletedEdgeIndices],
  )

  // Added edges currently in view - the ones "Add Points" (or a canonical edge that got
  // deleted) created beyond the canonical set. Signed the same way added vertices/faces are
  // (negative, via -(index in addedEdges) - 1), and independent of any face: an edge stays
  // visible as long as its own endpoints are and it isn't itself deleted, whether or not the
  // face it was originally built for still stands.
  const visibleAddedEdgeEntries = useMemo(
    () =>
      addedEdges
        .map((edge, i) => ({ edge, index: -(i + 1) }))
        .filter(
          ({ edge: [a, b], index }) =>
            !deletedEdgeIndices.has(index) &&
            (a < 0 ? !deletedVertexIndices.has(a) : keptSet.has(a)) &&
            (b < 0 ? !deletedVertexIndices.has(b) : keptSet.has(b)),
        ),
    [addedEdges, keptSet, deletedVertexIndices, deletedEdgeIndices],
  )

  const edgeGeometry = useMemo(() => {
    const positions: number[] = []
    for (const { edge: [a, b] } of visibleEdgeEntries) {
      const va = sliced.vertices[a]
      const vb = sliced.vertices[b]
      positions.push(va.x, va.y, va.z, vb.x, vb.y, vb.z)
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    return geom
  }, [visibleEdgeEntries, sliced.vertices])

  const addedEdgeGeometry = useMemo(() => {
    const positions: number[] = []
    for (const { edge: [a, b] } of visibleAddedEdgeEntries) {
      const va = resolvePosition(a)
      const vb = resolvePosition(b)
      positions.push(va.x, va.y, va.z, vb.x, vb.y, vb.z)
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    return geom
  }, [visibleAddedEdgeEntries, resolvePosition])

  // Preview mode instead turns each edge into a real solid strut, built with replicad/
  // opencascade.js: a flat sketch on the meridian plane through the edge and the gravity center
  // (mitered lead-ins at each end, trimmed back by that hub's minOffset, bridged by a sharp
  // corner or a true circular arc centered on the gravity center - see strutGeometry.ts),
  // extruded by the sheet thickness (or that edge's own override, same as before). Building a
  // solid is async (opencascade.js's WASM module has to load first, and .mesh() calls happen
  // off this effect's synchronous path), so the merged result lives in state rather than a
  // useMemo.
  const [previewGeometry, setPreviewGeometry] = useState<THREE.BufferGeometry | null>(null)

  useEffect(() => {
    if (mode !== 'preview') return
    let cancelled = false

    const entries = [
      ...visibleEdgeEntries.map(({ edge: [a, b], index }) => ({
        a,
        b,
        index,
        posA: sliced.vertices[a],
        posB: sliced.vertices[b],
      })),
      ...visibleAddedEdgeEntries.map(({ edge: [a, b], index }) => ({
        a,
        b,
        index,
        posA: resolvePosition(a),
        posB: resolvePosition(b),
      })),
    ]

    ;(async () => {
      const { ensureReplicadReady, buildStrutMesh } = await import('../lib/replicadCad')
      await ensureReplicadReady()
      if (cancelled) return

      const offsets = computeEdgeEndOffsets(
        data,
        transformedVertices,
        addedVertices,
        layerCount,
        deletedVertexIndices,
        deletedEdgeIndices,
        addedFaces,
        addedEdges,
        centerY,
        (edgeId) => edgeThickness.get(edgeId) ?? thickness,
      )
      const center = new THREE.Vector3(0, centerY, 0)
      const halfWidth = extrudeDistance / 2
      const tooth: ToothParams = { height: toothHeight, length: toothLength, chamfer: toothChamfer, millRadius }

      // Colored the same way the clickable edge markers are in Edit mode, so a strut's color
      // means the same thing (thickness override, and by how much) in both places.
      const geometries: THREE.BufferGeometry[] = []
      for (const { a, b, index, posA, posB } of entries) {
        const override = edgeThickness.get(index)
        const beamThickness = override ?? thickness
        const offsetA = (offsets.get(index)?.get(a) ?? 0) + offsetModifier
        const offsetB = (offsets.get(index)?.get(b) ?? 0) + offsetModifier
        const boundary = computeStrutBoundary(posA, posB, center, offsetA, offsetB, cornerLength, halfWidth, tooth)
        if (!boundary) continue

        try {
          const strut = buildStrutMesh(boundary, beamThickness)
          const geom = new THREE.BufferGeometry()
          geom.setAttribute('position', new THREE.Float32BufferAttribute(strut.positions, 3))
          geom.setAttribute('normal', new THREE.Float32BufferAttribute(strut.normals, 3))
          geom.setIndex(new THREE.Uint32BufferAttribute(strut.indices, 1))

          const color = edgeThicknessColor(override)
          const vertexCount = strut.positions.length / 3
          const colors = new Float32Array(vertexCount * 3)
          for (let i = 0; i < vertexCount; i++) {
            colors[i * 3] = color.r
            colors[i * 3 + 1] = color.g
            colors[i * 3 + 2] = color.b
          }
          geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
          geometries.push(geom)
        } catch (err) {
          console.error(`Failed to build strut solid for edge ${index}`, err)
        }
      }

      if (cancelled) {
        geometries.forEach((g) => g.dispose())
        return
      }

      const merged = geometries.length > 0 ? mergeGeometries(geometries, false) : null
      geometries.forEach((g) => g.dispose())

      setPreviewGeometry((prev) => {
        prev?.dispose()
        return merged
      })
    })()

    return () => {
      cancelled = true
    }
  }, [
    mode,
    data,
    transformedVertices,
    addedVertices,
    layerCount,
    deletedVertexIndices,
    deletedEdgeIndices,
    addedFaces,
    addedEdges,
    centerY,
    edgeThickness,
    thickness,
    extrudeDistance,
    cornerLength,
    offsetModifier,
    toothHeight,
    toothLength,
    toothChamfer,
    millRadius,
    visibleEdgeEntries,
    visibleAddedEdgeEntries,
    sliced.vertices,
    resolvePosition,
  ])

  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    document.body.style.cursor = 'pointer'
  }
  const handlePointerOut = () => {
    document.body.style.cursor = 'auto'
  }

  const editingVertices = mode === 'edit' && editTarget === 'vertices'
  const editingEdges = mode === 'edit' && editTarget === 'edges'
  const editingFaces = mode === 'edit' && editTarget === 'faces'

  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])

  // One small standalone geometry per visible face (canonical and added alike, sharing the
  // same signed id scheme as added vertices), only needed while individually clickable.
  const faceMeshEntries = useMemo(() => {
    if (!editingFaces) return []
    const canonical = visibleFaceEntries.map(({ face, index }) => ({
      id: index,
      geometry: buildFanGeometry(face.map((idx) => sliced.vertices[idx])),
    }))
    const added = visibleAddedFaceEntries.map(({ face, id }) => ({
      id,
      geometry: buildFanGeometry(face.map(resolvePosition)),
    }))
    return [...canonical, ...added]
  }, [editingFaces, visibleFaceEntries, visibleAddedFaceEntries, sliced.vertices, resolvePosition])

  return (
    <group>
      {!editingFaces && (mode === 'edit' || mode === 'new') && (
        <mesh geometry={faceGeometry}>
          <meshStandardMaterial
            color="#5b9bd5"
            transparent
            opacity={0.4}
            side={THREE.DoubleSide}
            roughness={0.6}
          />
        </mesh>
      )}
      {(mode === 'new' || editingVertices || editingFaces) && (
        <lineSegments geometry={edgeGeometry}>
          <lineBasicMaterial color="#1b3a57" />
        </lineSegments>
      )}
      {!editingFaces && mode === 'edit' && (
        <mesh geometry={addedFaceGeometry}>
          <meshStandardMaterial
            color="#5b9bd5"
            transparent
            opacity={0.4}
            side={THREE.DoubleSide}
            roughness={0.6}
          />
        </mesh>
      )}
      {(editingVertices || editingFaces) && (
        <lineSegments geometry={addedEdgeGeometry}>
          <lineBasicMaterial color="#1b3a57" />
        </lineSegments>
      )}
      {mode === 'preview' && previewGeometry && (
        <mesh geometry={previewGeometry}>
          <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.5} />
        </mesh>
      )}
      {editingVertices &&
        sliced.keptVertexIndices.map((idx) => {
          const v = sliced.vertices[idx]
          const isSelected = selectedVertexIndices.has(idx)
          return (
            <mesh
              key={idx}
              position={[v.x, v.y, v.z]}
              onClick={(e) => {
                e.stopPropagation()
                onVertexClick(idx)
              }}
              onPointerOver={handlePointerOver}
              onPointerOut={handlePointerOut}
            >
              <sphereGeometry
                args={[isSelected ? SELECTED_VERTEX_MARKER_RADIUS : VERTEX_MARKER_RADIUS, 16, 16]}
              />
              <meshStandardMaterial color={isSelected ? '#f5a623' : '#4fd97e'} />
            </mesh>
          )
        })}
      {editingVertices &&
        Array.from(visibleAddedVertexIds).map((idx) => {
          const v = addedVertices.get(idx)!
          const isSelected = selectedVertexIndices.has(idx)
          return (
            <mesh
              key={idx}
              position={[v.x, v.y, v.z]}
              onClick={(e) => {
                e.stopPropagation()
                onVertexClick(idx)
              }}
              onPointerOver={handlePointerOver}
              onPointerOut={handlePointerOut}
            >
              <sphereGeometry
                args={[isSelected ? SELECTED_VERTEX_MARKER_RADIUS : VERTEX_MARKER_RADIUS, 16, 16]}
              />
              <meshStandardMaterial color={isSelected ? '#f5a623' : '#e0729f'} />
            </mesh>
          )
        })}
      {editingEdges &&
        visibleEdgeEntries.map(({ edge: [a, b], index }) => {
          const va = sliced.vertices[a]
          const vb = sliced.vertices[b]
          const mid = va.clone().add(vb).multiplyScalar(0.5)
          const direction = vb.clone().sub(va)
          const length = direction.length()
          const quaternion = new THREE.Quaternion().setFromUnitVectors(
            up,
            direction.normalize(),
          )
          const isSelected = selectedEdgeIndices.has(index)
          return (
            <mesh
              key={index}
              position={[mid.x, mid.y, mid.z]}
              quaternion={quaternion}
              onClick={(e) => {
                e.stopPropagation()
                onEdgeClick(index)
              }}
              onPointerOver={handlePointerOver}
              onPointerOut={handlePointerOut}
            >
              <cylinderGeometry args={[EDGE_MARKER_RADIUS, EDGE_MARKER_RADIUS, length, 8]} />
              <meshStandardMaterial
                color={edgeMarkerColor(edgeThickness.get(index), isSelected)}
              />
            </mesh>
          )
        })}
      {editingEdges &&
        visibleAddedEdgeEntries.map(({ edge: [a, b], index }) => {
          const va = resolvePosition(a)
          const vb = resolvePosition(b)
          const mid = va.clone().add(vb).multiplyScalar(0.5)
          const direction = vb.clone().sub(va)
          const length = direction.length()
          const quaternion = new THREE.Quaternion().setFromUnitVectors(
            up,
            direction.normalize(),
          )
          const isSelected = selectedEdgeIndices.has(index)
          return (
            <mesh
              key={index}
              position={[mid.x, mid.y, mid.z]}
              quaternion={quaternion}
              onClick={(e) => {
                e.stopPropagation()
                onEdgeClick(index)
              }}
              onPointerOver={handlePointerOver}
              onPointerOut={handlePointerOut}
            >
              <cylinderGeometry args={[EDGE_MARKER_RADIUS, EDGE_MARKER_RADIUS, length, 8]} />
              <meshStandardMaterial
                color={edgeMarkerColor(edgeThickness.get(index), isSelected)}
              />
            </mesh>
          )
        })}
      {editingFaces &&
        faceMeshEntries.map(({ id, geometry }) => {
          const isSelected = selectedFaceIndices.has(id)
          return (
            <mesh
              key={id}
              geometry={geometry}
              onClick={(e) => {
                e.stopPropagation()
                onFaceClick(id)
              }}
              onPointerOver={handlePointerOver}
              onPointerOut={handlePointerOut}
            >
              <meshStandardMaterial
                color={isSelected ? SELECTED_COLOR : '#5b9bd5'}
                side={THREE.DoubleSide}
                roughness={0.6}
              />
            </mesh>
          )
        })}
      <mesh position={[0, centerY, 0]}>
        <sphereGeometry args={[VERTEX_MARKER_RADIUS, 16, 16]} />
        <meshStandardMaterial color="#f5e050" />
      </mesh>
    </group>
  )
}
