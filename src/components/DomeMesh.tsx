import { useMemo } from 'react'
import * as THREE from 'three'
import type { PolyhedronData } from '../lib/polyhedra'
import { sliceLayers } from '../lib/polyhedra'

interface DomeMeshProps {
  data: PolyhedronData
  layerCount: number
}

export function DomeMesh({ data, layerCount }: DomeMeshProps) {
  const sliced = useMemo(() => sliceLayers(data, layerCount), [data, layerCount])

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

  return (
    <group>
      <mesh geometry={faceGeometry}>
        <meshStandardMaterial
          color="#5b9bd5"
          transparent
          opacity={0.4}
          side={THREE.DoubleSide}
          roughness={0.6}
        />
      </mesh>
      <lineSegments geometry={edgeGeometry}>
        <lineBasicMaterial color="#1b3a57" />
      </lineSegments>
      {sliced.keptVertexIndices.map((idx) => {
        const v = sliced.vertices[idx]
        return (
          <mesh key={idx} position={[v.x, v.y, v.z]}>
            <sphereGeometry args={[0.02, 16, 16]} />
            <meshStandardMaterial color="#4fd97e" />
          </mesh>
        )
      })}
    </group>
  )
}
