import { useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { EditTarget, ViewMode } from '../App'
import type { HubEdgeMetric, SceneData } from '../lib/polyhedra'
import { buildVertexAdjacency, computeModelStats, computeVertexHubMetrics } from '../lib/polyhedra'
import { buildFaceNeighborPairs, directedEdgeKey } from '../lib/edgesInfo'
import type { FlangeShapeParams } from '../lib/flangeGeometry'
import { DomeMesh, type PreviewProgress } from './DomeMesh'
import type { PartTransparency } from '../lib/previewParts'
import { Hud, type HudHubEdgeMetric } from './Hud'

interface ViewportProps {
  mode: ViewMode
  editTarget: EditTarget
  diameter: number
  data: SceneData
  transformedVertices: ReadonlyMap<number, THREE.Vector3>
  selectedVertexIndices: ReadonlySet<number>
  selectedEdgeIndices: ReadonlySet<number>
  edgeThickness: ReadonlyMap<number, number>
  vertexCornerLength: ReadonlyMap<number, number>
  vertexFlangeParams: ReadonlyMap<number, Partial<FlangeShapeParams>>
  selectedFaceIndices: ReadonlySet<number>
  selectedBraceIndices: ReadonlySet<number>
  extrudeDistance: number
  thickness: number
  cornerLength: number
  offsetModifier: number
  endGrooveLengthPercent: number
  midGrooveLengthPercent: number
  grooveDepth: number
  millingDiameter: number
  chamferLength: number
  toleranceLongitudinal: number
  toleranceTransverse: number
  centerHoleDiameter: number
  sideHoleDiameter: number
  sideHoleDiameterOffset: number
  overshoot: number
  minSide: number
  flangeMillingDiameter: number
  partTransparency: PartTransparency
  onVertexClick: (index: number) => void
  onEdgeClick: (index: number) => void
  onFaceClick: (id: number) => void
  onBraceClick: (id: number) => void
  onDeselectAll: () => void
}

export function Viewport({
  mode,
  editTarget,
  diameter,
  data,
  transformedVertices,
  selectedVertexIndices,
  selectedEdgeIndices,
  edgeThickness,
  vertexCornerLength,
  vertexFlangeParams,
  selectedFaceIndices,
  selectedBraceIndices,
  extrudeDistance,
  thickness,
  cornerLength,
  offsetModifier,
  endGrooveLengthPercent,
  midGrooveLengthPercent,
  grooveDepth,
  millingDiameter,
  chamferLength,
  toleranceLongitudinal,
  toleranceTransverse,
  centerHoleDiameter,
  sideHoleDiameter,
  sideHoleDiameterOffset,
  overshoot,
  minSide,
  flangeMillingDiameter,
  partTransparency,
  onVertexClick,
  onEdgeClick,
  onFaceClick,
  onBraceClick,
  onDeselectAll,
}: ViewportProps) {
  const stats = useMemo(
    () => computeModelStats(transformedVertices, data.edges.size, data.faces.size),
    [transformedVertices, data.edges.size, data.faces.size],
  )

  const selectedVertexElevation = useMemo(() => {
    if (mode !== 'edit' || editTarget !== 'vertices' || selectedVertexIndices.size !== 1 || !stats.bounds) {
      return null
    }
    const [id] = selectedVertexIndices
    const pos = transformedVertices.get(id)!
    return pos.y - stats.bounds.minY
  }, [mode, editTarget, selectedVertexIndices, transformedVertices, stats.bounds])

  const selectedVertexId = useMemo(() => {
    if (mode !== 'edit' || editTarget !== 'vertices' || selectedVertexIndices.size !== 1) return null
    const [id] = selectedVertexIndices
    return id
  }, [mode, editTarget, selectedVertexIndices])

  const selectedEdgeId = useMemo(() => {
    if (mode !== 'edit' || editTarget !== 'edges' || selectedEdgeIndices.size !== 1) return null
    const [id] = selectedEdgeIndices
    return id
  }, [mode, editTarget, selectedEdgeIndices])

  const selectedVertexHubMetrics = useMemo<HudHubEdgeMetric[]>(() => {
    if (selectedVertexId === null) return []
    const id = selectedVertexId
    const positionOf = (vid: number) => transformedVertices.get(vid)!
    const edges = buildVertexAdjacency(data.edges).get(id) ?? []
    const center = new THREE.Vector3(0, 0, 0)
    const metrics: HubEdgeMetric[] = computeVertexHubMetrics(
      positionOf(id),
      center,
      edges,
      positionOf,
      (edgeId) => edgeThickness.get(edgeId) ?? thickness,
    )
    const facePairs = buildFaceNeighborPairs(data.faces, positionOf, center).get(id) ?? new Map()
    const n = metrics.length
    return metrics.map((m, i) => {
      const nextNeighborId = metrics[(i + 1) % n].neighborId
      return {
        ...m,
        hasFaceToNextEdge: facePairs.has(directedEdgeKey(m.neighborId, nextNeighborId)),
      }
    })
  }, [selectedVertexId, transformedVertices, data.edges, data.faces, edgeThickness, thickness])

  // Preview mode builds every strut/flange solid in a background worker (see DomeMesh.tsx and
  // previewBuilder.worker.ts) - this just holds whatever progress it last reported, to surface in
  // the HUD rather than leaving the viewport looking stuck while it works.
  const [previewProgress, setPreviewProgress] = useState<PreviewProgress | null>(null)

  return (
    <div className="viewport">
      <Hud
        mode={mode}
        editTarget={editTarget}
        stats={stats}
        selectedVertexCount={selectedVertexIndices.size}
        selectedEdgeCount={selectedEdgeIndices.size}
        selectedFaceCount={selectedFaceIndices.size}
        selectedBraceCount={selectedBraceIndices.size}
        selectedVertexId={selectedVertexId}
        selectedEdgeId={selectedEdgeId}
        selectedVertexElevation={selectedVertexElevation}
        selectedVertexHubMetrics={selectedVertexHubMetrics}
        previewProgress={mode === 'preview' ? previewProgress : null}
      />
      <Canvas
        camera={{ position: [8750, 7000, 10000], fov: 45, near: 10, far: 200000 }}
        onPointerMissed={onDeselectAll}
      >
        <color attach="background" args={['#12141a']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[12500, 20000, 12500]} intensity={2.6} />
        <directionalLight position={[-10000, -5000, -10000]} intensity={0.6} />
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
          editTarget={editTarget}
          diameter={diameter}
          data={data}
          transformedVertices={transformedVertices}
          selectedVertexIndices={selectedVertexIndices}
          selectedEdgeIndices={selectedEdgeIndices}
          edgeThickness={edgeThickness}
          vertexCornerLength={vertexCornerLength}
          vertexFlangeParams={vertexFlangeParams}
          selectedFaceIndices={selectedFaceIndices}
          selectedBraceIndices={selectedBraceIndices}
          extrudeDistance={extrudeDistance}
          thickness={thickness}
          cornerLength={cornerLength}
          offsetModifier={offsetModifier}
          endGrooveLengthPercent={endGrooveLengthPercent}
          midGrooveLengthPercent={midGrooveLengthPercent}
          grooveDepth={grooveDepth}
          millingDiameter={millingDiameter}
          chamferLength={chamferLength}
          toleranceLongitudinal={toleranceLongitudinal}
          toleranceTransverse={toleranceTransverse}
          centerHoleDiameter={centerHoleDiameter}
          sideHoleDiameter={sideHoleDiameter}
          sideHoleDiameterOffset={sideHoleDiameterOffset}
          overshoot={overshoot}
          minSide={minSide}
          flangeMillingDiameter={flangeMillingDiameter}
          partTransparency={partTransparency}
          onVertexClick={onVertexClick}
          onEdgeClick={onEdgeClick}
          onFaceClick={onFaceClick}
          onBraceClick={onBraceClick}
          onPreviewProgress={setPreviewProgress}
        />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
      </Canvas>
    </div>
  )
}
