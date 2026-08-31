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
      <Canvas
        camera={{ position: [8750, 7000, 10000], fov: 45, near: 10, far: 200000 }}
        onPointerMissed={onDeselectAll}
      >
        <color attach="background" args={['#12141a']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[12500, 20000, 12500]} intensity={1.1} />
        <directionalLight position={[-10000, -5000, -10000]} intensity={0.25} />
        {/* With infiniteGrid, drei scales the plane's own vertices by (1 + fadeDistance) to
            fake infinite extent - so `args` must stay small (it's not the visible size), or the
            two multiply together into vertex positions in the hundreds of millions and the GPU
            grinds on it every frame. fadeDistance alone controls how far the grid actually fades out. */}
        <Grid
          args={[10, 10]}
          position={[0, -4000, 0]}
          cellSize={250}
          sectionSize={1000}
          cellColor="#2a2e39"
          sectionColor="#3a4050"
          fadeDistance={50000}
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
