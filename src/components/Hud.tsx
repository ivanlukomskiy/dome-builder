import type { EditTarget, ViewMode } from '../App'
import type { HubEdgeMetric, ModelStats } from '../lib/polyhedra'

interface HudProps {
  mode: ViewMode
  editTarget: EditTarget
  stats: ModelStats
  selectedVertexCount: number
  selectedEdgeCount: number
  selectedFaceCount: number
  selectedVertexElevation: number | null
  selectedVertexHubMetrics: HubEdgeMetric[]
  previewLoading: boolean
}

function formatMm(value: number): string {
  return `${Math.round(value)} mm`
}

export function Hud({
  mode,
  editTarget,
  stats,
  selectedVertexCount,
  selectedEdgeCount,
  selectedFaceCount,
  selectedVertexElevation,
  selectedVertexHubMetrics,
  previewLoading,
}: HudProps) {
  let selectionLine: string | null = null
  if (mode === 'edit') {
    if (editTarget === 'vertices' && selectedVertexCount > 0) {
      selectionLine =
        selectedVertexCount === 1 && selectedVertexElevation !== null
          ? `1 vertex selected — elevation ${formatMm(selectedVertexElevation)}`
          : `${selectedVertexCount} vertices selected`
    } else if (editTarget === 'edges' && selectedEdgeCount > 0) {
      selectionLine = `${selectedEdgeCount} edge${selectedEdgeCount === 1 ? '' : 's'} selected`
    } else if (editTarget === 'faces' && selectedFaceCount > 0) {
      selectionLine = `${selectedFaceCount} face${selectedFaceCount === 1 ? '' : 's'} selected`
    }
  }

  if (selectionLine) {
    return (
      <div className="hud">
        <div>{selectionLine}</div>
        {selectedVertexHubMetrics.length > 0 && (
          <div className="hud-hub">
            <div>{`hub — ${selectedVertexHubMetrics.length} edge${selectedVertexHubMetrics.length === 1 ? '' : 's'}`}</div>
            {selectedVertexHubMetrics.map((m, i) => (
              <div key={m.edgeId}>{`#${i + 1} ${formatMm(m.thicknessMm)} — ${Math.round(m.angleToNextDeg)}° to next — offset ${formatMm(m.offsetMm)}`}</div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const { bounds } = stats
  const width = bounds ? bounds.maxX - bounds.minX : 0
  const depth = bounds ? bounds.maxZ - bounds.minZ : 0
  const height = bounds ? bounds.maxY - bounds.minY : 0

  return (
    <div className="hud">
      {previewLoading && <div>Loading CAD engine…</div>}
      <div>{`${formatMm(width)} × ${formatMm(depth)} × ${formatMm(height)}`}</div>
      <div>{`${stats.faceCount} faces, ${stats.edgeCount} edges`}</div>
    </div>
  )
}
