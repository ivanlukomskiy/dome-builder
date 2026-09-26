import type { EditTarget, ViewMode } from '../App'
import type { PreviewProgress } from './DomeMesh'
import type { HubEdgeMetric, ModelStats } from '../lib/polyhedra'
import { useI18n, type Translator } from '../lib/i18n'

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
  selectedBraceCount: number
  selectedVertexId: number | null
  selectedEdgeId: number | null
  selectedVertexElevation: number | null
  selectedVertexHubMetrics: HudHubEdgeMetric[]
  previewProgress: PreviewProgress | null
}

function formatMm(value: number, t: Translator['t']): string {
  return t('{value} mm', { value: Math.round(value) })
}

const PREVIEW_PHASE_LABEL: Record<PreviewProgress['phase'], string> = {
  loading: 'Loading CAD engine…',
  struts: 'Building struts',
  flanges: 'Building flanges',
  foot: 'Building foot',
}

function PreviewProgressBar({ progress }: { progress: PreviewProgress }) {
  const { t } = useI18n()
  const label = t(PREVIEW_PHASE_LABEL[progress.phase])
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
  selectedBraceCount,
  selectedVertexId,
  selectedEdgeId,
  selectedVertexElevation,
  selectedVertexHubMetrics,
  previewProgress,
}: HudProps) {
  const { t, tn } = useI18n()
  let selectionLine: string | null = null
  if (mode === 'edit') {
    if (editTarget === 'vertices' && selectedVertexCount > 0) {
      selectionLine =
        selectedVertexCount === 1 && selectedVertexElevation !== null
          ? t('1 vertex selected — id {id} — elevation {elevation}', {
              id: selectedVertexId ?? '',
              elevation: formatMm(selectedVertexElevation, t),
            })
          : tn(selectedVertexCount, '{n} vertex selected', '{n} vertices selected')
    } else if (editTarget === 'edges' && selectedEdgeCount > 0) {
      selectionLine =
        selectedEdgeCount === 1 && selectedEdgeId !== null
          ? t('1 edge selected — id {id}', { id: selectedEdgeId })
          : tn(selectedEdgeCount, '{n} edge selected', '{n} edges selected')
    } else if (editTarget === 'faces' && selectedFaceCount > 0) {
      selectionLine = tn(selectedFaceCount, '{n} face selected', '{n} faces selected')
    } else if (editTarget === 'braces' && selectedBraceCount > 0) {
      selectionLine = tn(selectedBraceCount, '{n} brace selected', '{n} braces selected')
    }
  }

  if (selectionLine) {
    return (
      <div className="hud">
        <div>{selectionLine}</div>
        {selectedVertexHubMetrics.length > 0 && (
          <div className="hud-hub">
            <div>{tn(selectedVertexHubMetrics.length, 'hub — {n} edge', 'hub — {n} edges')}</div>
            {selectedVertexHubMetrics.map((m, i) => (
              <div key={m.edgeId}>
                {t('#{index} id {id} {thickness} — {angle}° to next ({face}) — offset {offset}', {
                  index: i + 1,
                  id: m.edgeId,
                  thickness: formatMm(m.thicknessMm, t),
                  angle: Math.round(m.angleToNextDeg),
                  face: m.hasFaceToNextEdge ? t('face') : t('no face'),
                  offset: formatMm(m.offsetMm, t),
                })}
              </div>
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
      <div>{`${formatMm(width, t)} × ${formatMm(depth, t)} × ${formatMm(height, t)}`}</div>
      <div>{t('{faces}, {edges}', { faces: tn(stats.faceCount, '{n} face', '{n} faces'), edges: tn(stats.edgeCount, '{n} edge', '{n} edges') })}</div>
    </div>
  )
}
