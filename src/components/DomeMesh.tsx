import { useCallback, useMemo } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import type { ViewMode } from '../App'
import type { Face, PolyhedronData } from '../lib/polyhedra'
import {
  computeEdgePolyline,
  extrudeArcToBeam,
  removeVertices,
  resolveVertexPosition,
  sliceLayers,
} from '../lib/polyhedra'

// Vertex/center marker sizes, in mm - purely visual, sized to stay visible without dwarfing a
// typical (few-meter) dome.
const VERTEX_MARKER_RADIUS = 80
const SELECTED_VERTEX_MARKER_RADIUS = 115

interface DomeMeshProps {
  mode: ViewMode
  data: PolyhedronData
  layerCount: number
  transformedVertices: THREE.Vector3[]
  deletedVertexIndices: ReadonlySet<number>
  selectedVertexIndices: ReadonlySet<number>
  addedVertices: ReadonlyMap<number, THREE.Vector3>
  addedFaces: Face[]
  centerY: number
  edgeSegments: number
  extrudeDistance: number
  thickness: number
  cornerLength: number
  onVertexClick: (index: number) => void
}

export function DomeMesh({
  mode,
  data,
  layerCount,
  transformedVertices,
  deletedVertexIndices,
  selectedVertexIndices,
  addedVertices,
  addedFaces,
  centerY,
  edgeSegments,
  extrudeDistance,
  thickness,
  cornerLength,
  onVertexClick,
}: DomeMeshProps) {
  const sliced = useMemo(() => {
    const layered = sliceLayers({ ...data, vertices: transformedVertices }, layerCount)
    return removeVertices(layered, deletedVertexIndices)
  }, [data, transformedVertices, layerCount, deletedVertexIndices])

  // An added face/vertex only shows while everything it was built from is still present:
  // its canonical anchors must still be in view (kept by the layer slice and not deleted),
  // and its new midpoint vertex must not itself have been deleted.
  const keptSet = useMemo(() => new Set(sliced.keptVertexIndices), [sliced])
  const visibleAddedFaces = useMemo(
    () =>
      addedFaces.filter((face) =>
        face.every((idx) => (idx < 0 ? !deletedVertexIndices.has(idx) : keptSet.has(idx))),
      ),
    [addedFaces, keptSet, deletedVertexIndices],
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

  // Edit mode draws each edge as a plain straight line.
  const addedEdgeGeometry = useMemo(() => {
    const positions: number[] = []
    for (const [i0, i1, i2] of visibleAddedFaces) {
      const v0 = resolvePosition(i0)
      const v1 = resolvePosition(i1)
      const v2 = resolvePosition(i2)
      positions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z)
      positions.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z)
      positions.push(v2.x, v2.y, v2.z, v0.x, v0.y, v0.z)
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    return geom
  }, [visibleAddedFaces, resolvePosition])

  const edgeGeometry = useMemo(() => {
    const positions: number[] = []
    for (const [a, b] of sliced.keptEdges) {
      const va = sliced.vertices[a]
      const vb = sliced.vertices[b]
      positions.push(va.x, va.y, va.z, vb.x, vb.y, vb.z)
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    return geom
  }, [sliced])

  // Preview mode instead turns each edge into a solid beam: turn it into a polyline with
  // mitered corners (straight tangent lead-ins at each end, bridged either by a sharp point or
  // by an arc bulging along the sphere family centered on the dome's center point), then
  // symmetrically extrude that polyline toward/away from the sphere's center (width) and along
  // its own surface normal (thickness) to give it a rectangular cross-section.
  const buildBeam = useCallback(
    (va: THREE.Vector3, vb: THREE.Vector3) => {
      const points = computeEdgePolyline(va, vb, centerY, edgeSegments, cornerLength)
      return extrudeArcToBeam(points, centerY, extrudeDistance, thickness)
    },
    [centerY, edgeSegments, extrudeDistance, thickness, cornerLength],
  )

  const edgeBeamGeometry = useMemo(() => {
    const positions: number[] = []
    for (const [a, b] of sliced.keptEdges) {
      for (const v of buildBeam(sliced.vertices[a], sliced.vertices[b])) {
        positions.push(v.x, v.y, v.z)
      }
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geom.computeVertexNormals()
    return geom
  }, [sliced, buildBeam])

  const addedEdgeBeamGeometry = useMemo(() => {
    const positions: number[] = []
    for (const [i0, i1, i2] of visibleAddedFaces) {
      const v0 = resolvePosition(i0)
      const v1 = resolvePosition(i1)
      const v2 = resolvePosition(i2)
      for (const [a, b] of [
        [v0, v1],
        [v1, v2],
        [v2, v0],
      ] as const) {
        for (const v of buildBeam(a, b)) positions.push(v.x, v.y, v.z)
      }
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geom.computeVertexNormals()
    return geom
  }, [visibleAddedFaces, resolvePosition, buildBeam])

  const faceGeometry = useMemo(() => {
    const positions: number[] = []
    for (const face of sliced.keptFaces) {
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
  }, [sliced])

  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    document.body.style.cursor = 'pointer'
  }
  const handlePointerOut = () => {
    document.body.style.cursor = 'auto'
  }

  return (
    <group>
      {(mode === 'edit' || mode === 'new') && (
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
      {(mode === 'edit' || mode === 'new') && (
        <lineSegments geometry={edgeGeometry}>
          <lineBasicMaterial color="#1b3a57" />
        </lineSegments>
      )}
      {mode === 'edit' && (
        <mesh geometry={addedFaceGeometry}>
          <meshStandardMaterial
            color="#d55b9b"
            transparent
            opacity={0.4}
            side={THREE.DoubleSide}
            roughness={0.6}
          />
        </mesh>
      )}
      {mode === 'edit' && (
        <lineSegments geometry={addedEdgeGeometry}>
          <lineBasicMaterial color="#571b3a" />
        </lineSegments>
      )}
      {mode === 'preview' && (
        <mesh geometry={edgeBeamGeometry}>
          <meshStandardMaterial color="#5b9bd5" side={THREE.DoubleSide} roughness={0.5} />
        </mesh>
      )}
      {mode === 'preview' && (
        <mesh geometry={addedEdgeBeamGeometry}>
          <meshStandardMaterial color="#d55b9b" side={THREE.DoubleSide} roughness={0.5} />
        </mesh>
      )}
      {mode === 'edit' &&
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
      {mode === 'edit' &&
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
      <mesh position={[0, centerY, 0]}>
        <sphereGeometry args={[VERTEX_MARKER_RADIUS, 16, 16]} />
        <meshStandardMaterial color="#f5e050" />
      </mesh>
    </group>
  )
}
