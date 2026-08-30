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
}

const SUBDIVISION_OPTIONS = Array.from(
  { length: MAX_SUBDIVISIONS - MIN_SUBDIVISIONS + 1 },
  (_, i) => MIN_SUBDIVISIONS + i,
)

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
        {SUBDIVISION_OPTIONS.map((n) => (
          <label key={n} className="radio-row">
            <input
              type="radio"
              name="subdivisions"
              checked={subdivisions === n}
              onChange={() => onSubdivisionsChange(n)}
            />
            {n}
          </label>
        ))}
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
        <ul className="layer-list">
          {data.layers.map((layer, i) => (
            <li key={i} className={i < layerCount ? 'kept' : 'dropped'}>
              Layer {i + 1}: {layer.vertexIndices.length} pt
              {layer.vertexIndices.length !== 1 ? 's' : ''}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}
