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
      for (const idx of face) {
        const v = sliced.vertices[idx]
        positions.push(v.x, v.y, v.z)
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
            <sphereGeometry args={[0.035, 16, 16]} />
            <meshStandardMaterial color="#d94f4f" />
          </mesh>
        )
      })}
    </group>
  )
}
