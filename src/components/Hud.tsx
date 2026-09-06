import type { EditTarget, ViewMode } from '../App'
import type { PreviewProgress } from './DomeMesh'
import type { HubEdgeMetric, ModelStats } from '../lib/polyhedra'

export interface HudHubEdgeMetric extends HubEdgeMetric {
  // Whether a (visible) face fills the wedge between this edge and the next one in angular
  // order, going around the vertex's tangent plane - see buildFaceNeighborPairs in edgesInfo.ts.
  hasFaceToNextEdge: boolean
}

interface HudProps {
  mode: ViewMode
  editTarget: EditTarget
  stats: ModelStats
  selectedVertexCount: number
  selectedEdgeCount: number
  selectedFaceCount: number
  selectedVertexId: number | null
  selectedEdgeId: number | null
  selectedVertexElevation: number | null
  selectedVertexHubMetrics: HudHubEdgeMetric[]
  previewProgress: PreviewProgress | null
}

function formatMm(value: number): string {
  return `${Math.round(value)} mm`
}

const PREVIEW_PHASE_LABEL: Record<PreviewProgress['phase'], string> = {
  loading: 'Loading CAD engine…',
  struts: 'Building struts',
  flanges: 'Building flanges',
}

function PreviewProgressBar({ progress }: { progress: PreviewProgress }) {
  const label = PREVIEW_PHASE_LABEL[progress.phase]
  if (progress.total === 0) {
    return <div className="hud-progress-label">{label}</div>
  }
  const percent = Math.round((progress.done / progress.total) * 100)
  return (
    <div className="hud-progress">
      <div className="hud-progress-label">{`${label} — ${progress.done} / ${progress.total}`}</div>
      <div className="hud-progress-track">
        <div className="hud-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

export function Hud({
  mode,
  editTarget,
  stats,
  selectedVertexCount,
  selectedEdgeCount,
  selectedFaceCount,
  selectedVertexId,
  selectedEdgeId,
  selectedVertexElevation,
  selectedVertexHubMetrics,
  previewProgress,
}: HudProps) {
  let selectionLine: string | null = null
  if (mode === 'edit') {
    if (editTarget === 'vertices' && selectedVertexCount > 0) {
      selectionLine =
        selectedVertexCount === 1 && selectedVertexElevation !== null
          ? `1 vertex selected — id ${selectedVertexId} — elevation ${formatMm(selectedVertexElevation)}`
          : `${selectedVertexCount} vertices selected`
    } else if (editTarget === 'edges' && selectedEdgeCount > 0) {
      selectionLine =
        selectedEdgeCount === 1 && selectedEdgeId !== null
          ? `1 edge selected — id ${selectedEdgeId}`
          : `${selectedEdgeCount} edges selected`
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
              <div key={m.edgeId}>{`#${i + 1} id ${m.edgeId} ${formatMm(m.thicknessMm)} — ${Math.round(m.angleToNextDeg)}° to next (${m.hasFaceToNextEdge ? 'face' : 'no face'}) — offset ${formatMm(m.offsetMm)}`}</div>
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
      {previewProgress && <PreviewProgressBar progress={previewProgress} />}
      <div>{`${formatMm(width)} × ${formatMm(depth)} × ${formatMm(height)}`}</div>
      <div>{`${stats.faceCount} faces, ${stats.edgeCount} edges`}</div>
    </div>
  )
}
