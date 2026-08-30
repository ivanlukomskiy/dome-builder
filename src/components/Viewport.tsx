import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import type * as THREE from 'three'
import type { ViewMode } from '../App'
import type { Face, PolyhedronData } from '../lib/polyhedra'
import { DomeMesh } from './DomeMesh'

interface ViewportProps {
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
  onDeselectAll: () => void
}

export function Viewport({
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
  onDeselectAll,
}: ViewportProps) {
  return (
    <div className="viewport">
      <Canvas camera={{ position: [3.5, 2.8, 4], fov: 45 }} onPointerMissed={onDeselectAll}>
        <color attach="background" args={['#12141a']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[5, 8, 5]} intensity={1.1} />
        <directionalLight position={[-4, -2, -4]} intensity={0.25} />
        <Grid
          args={[10, 10]}
          position={[0, -1.6, 0]}
          cellColor="#2a2e39"
          sectionColor="#3a4050"
          fadeDistance={20}
          infiniteGrid
        />
        <DomeMesh
          mode={mode}
          data={data}
          layerCount={layerCount}
          transformedVertices={transformedVertices}
          deletedVertexIndices={deletedVertexIndices}
          selectedVertexIndices={selectedVertexIndices}
          addedVertices={addedVertices}
          addedFaces={addedFaces}
          centerY={centerY}
          edgeSegments={edgeSegments}
          extrudeDistance={extrudeDistance}
          thickness={thickness}
          cornerLength={cornerLength}
          onVertexClick={onVertexClick}
        />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
      </Canvas>
    </div>
  )
}
