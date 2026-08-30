import type { AxisType, PolyhedronData, ShapeType } from '../lib/polyhedra'
import { MAX_SUBDIVISIONS, MIN_SUBDIVISIONS, SHAPE_AXES, SHAPE_LABELS } from '../lib/polyhedra'

interface SidebarProps {
  shape: ShapeType
  onShapeChange: (shape: ShapeType) => void
  axis: AxisType
  onAxisChange: (axis: AxisType) => void
  subdivisions: number
  onSubdivisionsChange: (subdivisions: number) => void
  layerCount: number
  onLayerCountChange: (count: number) => void
  data: PolyhedronData
  selectedCount: number
  canUndo: boolean
  canRedo: boolean
  onDeleteSelected: () => void
  onUndo: () => void
  onRedo: () => void
  onCancelAll: () => void
}

export function Sidebar({
  shape,
  onShapeChange,
  axis,
  onAxisChange,
  subdivisions,
  onSubdivisionsChange,
  layerCount,
  onLayerCountChange,
  data,
  selectedCount,
  canUndo,
  canRedo,
  onDeleteSelected,
  onUndo,
  onRedo,
  onCancelAll,
}: SidebarProps) {
  const axisOptions = SHAPE_AXES[shape]
  const maxLayers = data.layers.length

  return (
    <aside className="sidebar">
      <h1>Dome Builder</h1>

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

      <section className="control-group">
        <h2>Edit vertices</h2>
        <p className="hint">
          {selectedCount > 0
            ? `${selectedCount} ${selectedCount !== 1 ? 'vertices' : 'vertex'} selected`
            : 'Click a vertex to select it'}
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
      </section>
    </aside>
  )
}
