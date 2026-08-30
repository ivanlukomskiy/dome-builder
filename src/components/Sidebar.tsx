import type { ViewMode } from '../App'
import type {
  AxisType,
  PolyhedronData,
  SelectionMode,
  ShapeType,
  VertexTransform,
} from '../lib/polyhedra'
import {
  DEFAULT_VERTEX_TRANSFORM,
  MAX_SUBDIVISIONS,
  MIN_SUBDIVISIONS,
  SELECTION_MODE_OPTIONS,
  SHAPE_AXES,
  SHAPE_LABELS,
} from '../lib/polyhedra'

const VIEW_MODE_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: 'edit', label: 'Edit' },
  { value: 'preview', label: 'Preview' },
]

interface SidebarProps {
  mode: ViewMode
  onModeChange: (mode: ViewMode) => void
  shape: ShapeType
  onShapeChange: (shape: ShapeType) => void
  axis: AxisType
  onAxisChange: (axis: AxisType) => void
  subdivisions: number
  onSubdivisionsChange: (subdivisions: number) => void
  layerCount: number
  onLayerCountChange: (count: number) => void
  data: PolyhedronData
  selectionMode: SelectionMode
  onSelectionModeChange: (mode: SelectionMode) => void
  selectedCount: number
  selectedVertexIndices: ReadonlySet<number>
  vertexTransforms: ReadonlyMap<number, VertexTransform>
  onTransformChange: (field: keyof VertexTransform, value: number) => void
  onResetTransform: () => void
  canAddPoints: boolean
  onAddPoints: () => void
  centerZ: number
  onCenterZChange: (value: number) => void
  edgeSegments: number
  onEdgeSegmentsChange: (value: number) => void
  bendDistance: number
  onBendDistanceChange: (value: number) => void
  extrudeDistance: number
  onExtrudeDistanceChange: (value: number) => void
  thickness: number
  onThicknessChange: (value: number) => void
  canUndo: boolean
  canRedo: boolean
  onDeleteSelected: () => void
  onUndo: () => void
  onRedo: () => void
  onCancelAll: () => void
}

// null return means the selected vertices don't all share the same value for this field.
function sharedTransformValue(
  selected: ReadonlySet<number>,
  transforms: ReadonlyMap<number, VertexTransform>,
  field: keyof VertexTransform,
): number | null {
  let value: number | null = null
  let first = true
  for (const idx of selected) {
    const v = (transforms.get(idx) ?? DEFAULT_VERTEX_TRANSFORM)[field]
    if (first) {
      value = v
      first = false
    } else if (v !== value) {
      return null
    }
  }
  return value
}

export function Sidebar({
  mode,
  onModeChange,
  shape,
  onShapeChange,
  axis,
  onAxisChange,
  subdivisions,
  onSubdivisionsChange,
  layerCount,
  onLayerCountChange,
  data,
  selectionMode,
  onSelectionModeChange,
  selectedCount,
  selectedVertexIndices,
  vertexTransforms,
  onTransformChange,
  onResetTransform,
  canAddPoints,
  onAddPoints,
  centerZ,
  onCenterZChange,
  edgeSegments,
  onEdgeSegmentsChange,
  bendDistance,
  onBendDistanceChange,
  extrudeDistance,
  onExtrudeDistanceChange,
  thickness,
  onThicknessChange,
  canUndo,
  canRedo,
  onDeleteSelected,
  onUndo,
  onRedo,
  onCancelAll,
}: SidebarProps) {
  const axisOptions = SHAPE_AXES[shape]
  const maxLayers = data.layers.length

  const zValue = sharedTransformValue(selectedVertexIndices, vertexTransforms, 'z')
  const rValue = sharedTransformValue(selectedVertexIndices, vertexTransforms, 'r')
  const thetaValue = sharedTransformValue(selectedVertexIndices, vertexTransforms, 'theta')
  const hasTransforms = Array.from(selectedVertexIndices).some((idx) => vertexTransforms.has(idx))

  const handleFieldChange = (field: keyof VertexTransform, raw: string, toRadians = false) => {
    if (raw === '' || raw === '-') return
    const num = Number(raw)
    if (Number.isNaN(num)) return
    onTransformChange(field, toRadians ? (num * Math.PI) / 180 : num)
  }

  const handleNumberChange = (onChange: (value: number) => void, raw: string) => {
    if (raw === '' || raw === '-') return
    const num = Number(raw)
    if (Number.isNaN(num)) return
    onChange(num)
  }

  return (
    <aside className="sidebar">
      <h1>Dome Builder</h1>

      <section className="control-group">
        <div className="segmented-control">
          {VIEW_MODE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={mode === opt.value ? 'active' : ''}
              onClick={() => onModeChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {mode === 'edit' && (
        <section className="control-group">
          <h2>Shape</h2>
          {(Object.keys(SHAPE_LABELS) as ShapeType[]).map((s) => (
            <label key={s} className="radio-row">
              <input
                type="radio"
                name="shape"
                checked={shape === s}
                onChange={() => onShapeChange(s)}
              />
              {SHAPE_LABELS[s]}
            </label>
          ))}
        </section>
      )}

      {mode === 'edit' && (
        <section className="control-group">
          <h2>Main axis</h2>
          {axisOptions.map((opt) => (
            <label key={opt.value} className="radio-row">
              <input
                type="radio"
                name="axis"
                checked={axis === opt.value}
                onChange={() => onAxisChange(opt.value)}
              />
              <span>
                {opt.label}
                <span className="hint">
                  {opt.axisCount} axes &middot; {opt.fold}-fold
                </span>
              </span>
            </label>
          ))}
        </section>
      )}

      {mode === 'edit' && (
        <section className="control-group">
          <h2>Subdivisions</h2>
          <div className="layer-slider-row">
            <input
              type="range"
              min={MIN_SUBDIVISIONS}
              max={MAX_SUBDIVISIONS}
              value={subdivisions}
              onChange={(e) => onSubdivisionsChange(Number(e.target.value))}
            />
            <span className="layer-count">
              {subdivisions} / {MAX_SUBDIVISIONS}
            </span>
          </div>
        </section>
      )}

      {mode === 'edit' && (
        <section className="control-group">
          <h2>Layers</h2>
          <div className="layer-slider-row">
            <input
              type="range"
              min={1}
              max={maxLayers}
              value={layerCount}
              onChange={(e) => onLayerCountChange(Number(e.target.value))}
            />
            <span className="layer-count">
              {layerCount} / {maxLayers}
            </span>
          </div>
        </section>
      )}

      {mode === 'preview' && (
        <section className="control-group">
          <h2>Center Point</h2>
          <div className="transform-field">
            <label>Center (z)</label>
            <input
              type="number"
              step={0.05}
              value={centerZ}
              onChange={(e) => handleNumberChange(onCenterZChange, e.target.value)}
            />
          </div>
          <p className="hint">
            A single point on the main axis that every edge bends and extrudes around.
          </p>
        </section>
      )}

      {mode === 'preview' && (
        <section className="control-group">
          <h2>Edge Curvature</h2>
          <div className="layer-slider-row">
            <input
              type="range"
              min={1}
              max={32}
              value={edgeSegments}
              onChange={(e) => onEdgeSegmentsChange(Number(e.target.value))}
            />
            <span className="layer-count">{edgeSegments} segments</span>
          </div>
          <p className="hint">
            Each edge bends around the center point, then is smoothed with a Bezier curve (or cut
            straight, if the bend is sharp enough that smoothing isn't needed).
          </p>
          <div className="layer-slider-row">
            <input
              type="range"
              min={0}
              max={0.4}
              step={0.005}
              value={bendDistance}
              onChange={(e) => onBendDistanceChange(Number(e.target.value))}
            />
            <span className="layer-count">{bendDistance.toFixed(3)}</span>
          </div>
          <p className="hint">
            Bend: how far each endpoint leads out, perpendicular to its radius from the center,
            before the smoothing curve takes over.
          </p>
          <div className="layer-slider-row">
            <input
              type="range"
              min={0}
              max={0.3}
              step={0.005}
              value={extrudeDistance}
              onChange={(e) => onExtrudeDistanceChange(Number(e.target.value))}
            />
            <span className="layer-count">{extrudeDistance.toFixed(3)}</span>
          </div>
          <p className="hint">
            Width: extrudes each point symmetrically toward/away from the center point.
          </p>
          <div className="layer-slider-row">
            <input
              type="range"
              min={0}
              max={0.15}
              step={0.0025}
              value={thickness}
              onChange={(e) => onThicknessChange(Number(e.target.value))}
            />
            <span className="layer-count">{thickness.toFixed(4)}</span>
          </div>
          <p className="hint">
            Thickness: extrudes that ribbon symmetrically along its own surface normal, turning
            it into a solid beam.
          </p>
        </section>
      )}

      {mode === 'edit' && (
        <section className="control-group">
          <h2>Edit vertices</h2>
          <div className="segmented-control">
            {SELECTION_MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={selectionMode === opt.value ? 'active' : ''}
                onClick={() => onSelectionModeChange(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="hint">
            {selectedCount > 0
              ? `${selectedCount} ${selectedCount !== 1 ? 'vertices' : 'vertex'} selected`
              : SELECTION_MODE_OPTIONS.find((opt) => opt.value === selectionMode)!.hint}
          </p>
          <div className="button-row">
            <button disabled={selectedCount === 0} onClick={onDeleteSelected}>
              Delete
            </button>
            <button disabled={!canUndo} onClick={onUndo}>
              Undo
            </button>
            <button disabled={!canRedo} onClick={onRedo}>
              Redo
            </button>
            <button
              disabled={!canUndo && !canRedo && selectedCount === 0}
              onClick={onCancelAll}
            >
              Cancel All
            </button>
          </div>
          <div className="button-row">
            <button disabled={!canAddPoints} onClick={onAddPoints}>
              Add Points
            </button>
          </div>
          {selectedCount > 0 && !canAddPoints && (
            <p className="hint">Select an even number of points to pair them up.</p>
          )}
        </section>
      )}

      {mode === 'edit' && selectedCount > 0 && (
        <section className="control-group">
          <h2>Transform</h2>
          <div className="transform-field">
            <label>Elevation (z)</label>
            <input
              type="number"
              step={0.05}
              value={zValue ?? ''}
              placeholder={zValue === null ? 'Mixed' : undefined}
              onChange={(e) => handleFieldChange('z', e.target.value)}
            />
          </div>
          <div className="transform-field">
            <label>Radius (r)</label>
            <input
              type="number"
              step={0.05}
              value={rValue ?? ''}
              placeholder={rValue === null ? 'Mixed' : undefined}
              onChange={(e) => handleFieldChange('r', e.target.value)}
            />
          </div>
          <div className="transform-field">
            <label>Angle (&theta;&deg;)</label>
            <input
              type="number"
              step={1}
              value={thetaValue === null ? '' : Math.round((thetaValue * 180) / Math.PI * 100) / 100}
              placeholder={thetaValue === null ? 'Mixed' : undefined}
              onChange={(e) => handleFieldChange('theta', e.target.value, true)}
            />
          </div>
          <p className="hint">
            {zValue === 0 && rValue === 0 && thetaValue === 0
              ? 'Default position (0, 0, 0)'
              : 'Values are relative to the default position'}
          </p>
          <div className="button-row">
            <button disabled={!hasTransforms} onClick={onResetTransform}>
              Reset Transform
            </button>
          </div>
        </section>
      )}
    </aside>
  )
}
