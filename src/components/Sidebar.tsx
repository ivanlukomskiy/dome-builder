import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { EditOrPreviewMode, EditTarget, ViewMode } from '../App'
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

const EDIT_OR_PREVIEW_OPTIONS: { value: EditOrPreviewMode; label: string }[] = [
  { value: 'edit', label: 'Edit' },
  { value: 'preview', label: 'Preview' },
]

const EDIT_TARGET_OPTIONS: { value: EditTarget; label: string }[] = [
  { value: 'vertices', label: 'Vertices' },
  { value: 'edges', label: 'Edges' },
  { value: 'faces', label: 'Faces' },
]

interface SidebarProps {
  onExportConfig: () => void
  onImportConfig: (file: File) => void
  onGetEdgesInfo: () => void
  mode: ViewMode
  onOpenNew: () => void
  onCreateNew: () => void
  onCancelNew: () => void
  onSwitchMode: (mode: EditOrPreviewMode) => void
  shape: ShapeType
  onShapeChange: (shape: ShapeType) => void
  axis: AxisType
  onAxisChange: (axis: AxisType) => void
  subdivisions: number
  onSubdivisionsChange: (subdivisions: number) => void
  diameter: number
  onDiameterChange: (diameter: number) => void
  layerCount: number
  onLayerCountChange: (count: number) => void
  data: PolyhedronData
  editTarget: EditTarget
  onEditTargetChange: (target: EditTarget) => void
  selectionMode: SelectionMode
  onSelectionModeChange: (mode: SelectionMode) => void
  selectedCount: number
  selectedVertexIndices: ReadonlySet<number>
  vertexTransforms: ReadonlyMap<number, VertexTransform>
  onTransformChange: (field: keyof VertexTransform, value: number) => void
  onResetTransform: () => void
  canAddPoints: boolean
  onAddPoints: () => void
  onConnectVertices: () => void
  onAdjustToSphere: () => void
  selectedEdgeCount: number
  selectedEdgeIndices: ReadonlySet<number>
  onDeleteSelectedEdges: () => void
  edgeThickness: ReadonlyMap<number, number>
  onEdgeThicknessChange: (value: number) => void
  onResetEdgeThickness: () => void
  canCreateFace: boolean
  onCreateFace: () => void
  selectedFaceCount: number
  onDeleteSelectedFaces: () => void
  centerZ: number
  onCenterZChange: (value: number) => void
  onGroundCenter: () => void
  extrudeDistance: number
  onExtrudeDistanceChange: (value: number) => void
  thickness: number
  onThicknessChange: (value: number) => void
  cornerLength: number
  onCornerLengthChange: (value: number) => void
  offsetModifier: number
  onOffsetModifierChange: (value: number) => void
  endGrooveLengthPercent: number
  onEndGrooveLengthPercentChange: (value: number) => void
  midGrooveLengthPercent: number
  onMidGrooveLengthPercentChange: (value: number) => void
  grooveDepth: number
  onGrooveDepthChange: (value: number) => void
  millingDiameter: number
  onMillingDiameterChange: (value: number) => void
  chamferLength: number
  onChamferLengthChange: (value: number) => void
  toleranceLongitudinal: number
  onToleranceLongitudinalChange: (value: number) => void
  toleranceTransverse: number
  onToleranceTransverseChange: (value: number) => void
  centerHoleDiameter: number
  onCenterHoleDiameterChange: (value: number) => void
  sideHoleDiameter: number
  onSideHoleDiameterChange: (value: number) => void
  sideHoleDiameterOffset: number
  onSideHoleDiameterOffsetChange: (value: number) => void
  overshoot: number
  onOvershootChange: (value: number) => void
  minSide: number
  onMinSideChange: (value: number) => void
  flangeMillingDiameter: number
  onFlangeMillingDiameterChange: (value: number) => void
  previewParamsDirty: boolean
  onApplyPreview: () => void
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

// null return means the selected edges don't all share the same override (an edge without one
// counts as 0, i.e. "use the default thickness").
function sharedEdgeThicknessValue(
  selected: ReadonlySet<number>,
  overrides: ReadonlyMap<number, number>,
): number | null {
  let value: number | null = null
  let first = true
  for (const idx of selected) {
    const v = overrides.get(idx) ?? 0
    if (first) {
      value = v
      first = false
    } else if (v !== value) {
      return null
    }
  }
  return value
}

export interface NumberFieldProps {
  value: number | null
  onCommit: (value: number) => void
  step?: number
  min?: number
  placeholder?: string
  clamp?: (value: number) => number
}

// A numeric text input that tracks its own typed text separately from the committed value, so
// clearing the field to type a fresh number doesn't get fought by a controlled value snapping
// back on each intermediate (empty, "-", ...) keystroke. Any keystroke that leaves a valid
// number commits it live, so the model updates as you type; an invalid/empty in-progress value
// is simply left uncommitted, and blurring reverts the field's own display back to whatever was
// last actually committed (or "Mixed", if the current selection doesn't share one).
export function NumberField({ value, onCommit, step, min, placeholder, clamp }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)

  const handleChange = (raw: string) => {
    setDraft(raw)
    const trimmed = raw.trim()
    if (trimmed === '') return
    const num = Number(trimmed)
    if (!Number.isNaN(num)) onCommit(clamp ? clamp(num) : num)
  }

  return (
    <input
      type="number"
      step={step}
      min={min}
      value={draft ?? (value === null ? '' : value)}
      placeholder={placeholder}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

export function Sidebar({
  onExportConfig,
  onImportConfig,
  onGetEdgesInfo,
  mode,
  onOpenNew,
  onCreateNew,
  onCancelNew,
  onSwitchMode,
  shape,
  onShapeChange,
  axis,
  onAxisChange,
  subdivisions,
  onSubdivisionsChange,
  diameter,
  onDiameterChange,
  layerCount,
  onLayerCountChange,
  data,
  editTarget,
  onEditTargetChange,
  selectionMode,
  onSelectionModeChange,
  selectedCount,
  selectedVertexIndices,
  vertexTransforms,
  onTransformChange,
  onResetTransform,
  canAddPoints,
  onAddPoints,
  onConnectVertices,
  onAdjustToSphere,
  selectedEdgeCount,
  selectedEdgeIndices,
  onDeleteSelectedEdges,
  edgeThickness,
  onEdgeThicknessChange,
  onResetEdgeThickness,
  canCreateFace,
  onCreateFace,
  selectedFaceCount,
  onDeleteSelectedFaces,
  centerZ,
  onCenterZChange,
  onGroundCenter,
  extrudeDistance,
  onExtrudeDistanceChange,
  thickness,
  onThicknessChange,
  cornerLength,
  onCornerLengthChange,
  offsetModifier,
  onOffsetModifierChange,
  endGrooveLengthPercent,
  onEndGrooveLengthPercentChange,
  midGrooveLengthPercent,
  onMidGrooveLengthPercentChange,
  grooveDepth,
  onGrooveDepthChange,
  millingDiameter,
  onMillingDiameterChange,
  chamferLength,
  onChamferLengthChange,
  toleranceLongitudinal,
  onToleranceLongitudinalChange,
  toleranceTransverse,
  onToleranceTransverseChange,
  centerHoleDiameter,
  onCenterHoleDiameterChange,
  sideHoleDiameter,
  onSideHoleDiameterChange,
  sideHoleDiameterOffset,
  onSideHoleDiameterOffsetChange,
  overshoot,
  onOvershootChange,
  minSide,
  onMinSideChange,
  flangeMillingDiameter,
  onFlangeMillingDiameterChange,
  previewParamsDirty,
  onApplyPreview,
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

  const edgeThicknessValue = sharedEdgeThicknessValue(selectedEdgeIndices, edgeThickness)
  const hasEdgeOverrides = Array.from(selectedEdgeIndices).some((idx) => edgeThickness.has(idx))

  const importInputRef = useRef<HTMLInputElement>(null)

  const handleImportFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onImportConfig(file)
    e.target.value = ''
  }

  return (
    <aside className="sidebar">
      <h1>Dome Builder</h1>

      <section className="control-group">
        <div className="button-row">
          <a href={`${import.meta.env.BASE_URL}edge-sketch`}>Edge Sketch Debug</a>
        </div>
      </section>

      {mode !== 'new' && (
        <section className="control-group">
          <div className="button-row">
            <button onClick={onExportConfig}>Export</button>
            <button onClick={() => importInputRef.current?.click()}>Import</button>
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={handleImportFileChange}
          />
        </section>
      )}

      {mode === 'new' ? (
        <section className="control-group">
          <div className="button-row">
            <button onClick={onCreateNew}>Create</button>
            <button onClick={onCancelNew}>Cancel</button>
          </div>
        </section>
      ) : (
        <>
          <section className="control-group">
            <div className="button-row">
              <button onClick={onOpenNew}>New</button>
            </div>
          </section>
          <section className="control-group">
            <div className="segmented-control">
              {EDIT_OR_PREVIEW_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={mode === opt.value ? 'active' : ''}
                  onClick={() => onSwitchMode(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      {(mode === 'new' || mode === 'edit') && (
        <section className="control-group">
          <h2>Diameter</h2>
          <div className="transform-field">
            <label>Diameter (mm)</label>
            <NumberField value={diameter} step={100} min={1} onCommit={onDiameterChange} />
          </div>
          {mode === 'edit' && (
            <p className="hint">The target size &ldquo;Adjust to a Sphere&rdquo; snaps onto.</p>
          )}
        </section>
      )}

      {mode === 'new' && (
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

      {mode === 'new' && (
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

      {mode === 'new' && (
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

      {mode === 'new' && (
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

      {mode !== 'new' && (
        <section className="control-group">
          <h2>Center</h2>
          <div className="transform-field">
            <label>Center (z, mm)</label>
            <NumberField value={centerZ} step={10} onCommit={onCenterZChange} />
          </div>
          <div className="button-row">
            <button onClick={onGroundCenter}>Ground the Center</button>
          </div>
          <p className="hint">Sets the center&rsquo;s height to match the lowest visible vertex.</p>
        </section>
      )}

      {mode === 'preview' && (
        <section className="control-group">
          <div className="button-row">
            <button onClick={onApplyPreview} disabled={!previewParamsDirty}>
              Apply
            </button>
          </div>
          <p className="hint">
            {previewParamsDirty
              ? 'Unapplied changes below - click Apply to regenerate the preview.'
              : 'Rebuilding every strut solid is slow, so changes to the fields below only take effect once you click Apply.'}
          </p>
        </section>
      )}

      {mode === 'preview' && (
        <section className="control-group">
          <h2>Edge Curvature</h2>
          <div className="transform-field">
            <label>Corner length (D, mm)</label>
            <NumberField value={cornerLength} step={5} min={0} onCommit={onCornerLengthChange} />
          </div>
          <p className="hint">
            Corner length (D): straight lead-in at each end, tangent to the sphere and angled
            toward the other end - trimmed back from the vertex by that hub's own minimum offset
            (shown when a single vertex is selected in Edit mode), up to this budget. Meeting
            lead-ins form a sharp point; otherwise the gap between them is bridged by an arc
            centered on the gravity center.
          </p>
          <div className="transform-field">
            <label>Offset modifier (mm)</label>
            <NumberField value={offsetModifier} step={5} onCommit={onOffsetModifierChange} />
          </div>
          <p className="hint">
            Offset modifier: added to every edge end's own minimum offset before it's trimmed
            back from the vertex (still capped by the corner length budget). Positive pulls every
            strut end further in; negative pushes it back out, toward the vertex.
          </p>
          <div className="transform-field">
            <label>Width (mm)</label>
            <NumberField value={extrudeDistance} step={5} min={0} onCommit={onExtrudeDistanceChange} />
          </div>
          <p className="hint">
            Width: extrudes each arc symmetrically toward/away from the sphere's center.
          </p>
          <div className="transform-field">
            <label>Thickness (mm)</label>
            <NumberField value={thickness} step={5} min={0} onCommit={onThicknessChange} />
          </div>
          <p className="hint">
            Thickness: extrudes that ribbon symmetrically along its own surface normal, turning
            it into a solid beam.
          </p>
        </section>
      )}

      {mode === 'preview' && (
        <section className="control-group">
          <h2>Grooves</h2>
          <div className="transform-field">
            <label>End groove length (%)</label>
            <NumberField
              value={endGrooveLengthPercent}
              step={5}
              min={0}
              onCommit={onEndGrooveLengthPercentChange}
            />
          </div>
          <div className="transform-field">
            <label>Mid groove length (%)</label>
            <NumberField
              value={midGrooveLengthPercent}
              step={5}
              min={0}
              onCommit={onMidGrooveLengthPercentChange}
            />
          </div>
          <div className="transform-field">
            <label>Groove depth (mm)</label>
            <NumberField value={grooveDepth} step={1} min={0} onCommit={onGrooveDepthChange} />
          </div>
          <div className="transform-field">
            <label>Milling diameter (mm)</label>
            <NumberField value={millingDiameter} step={1} min={0} onCommit={onMillingDiameterChange} />
          </div>
          <div className="transform-field">
            <label>Chamfer length (mm)</label>
            <NumberField value={chamferLength} step={1} min={0} onCommit={onChamferLengthChange} />
          </div>
          <p className="hint">
            Each strut end forms a shouldered tenon: the end and mid groove percentages split the
            workable length (past the offset) into the shoulder, tenon, and far shoulder, cut back
            by groove depth. Chamfer length bevels the tenon's top corners; milling diameter sets
            a relief circle tucked into each of its concave base corners, clearing room for a
            square mating part to seat flush against a round cutting bit.
          </p>
        </section>
      )}

      {mode === 'preview' && (
        <section className="control-group">
          <h2>Flange</h2>
          <div className="transform-field">
            <label>Tolerance longitudinal (mm)</label>
            <NumberField
              value={toleranceLongitudinal}
              step={1}
              min={0}
              onCommit={onToleranceLongitudinalChange}
            />
          </div>
          <div className="transform-field">
            <label>Tolerance transverse (mm)</label>
            <NumberField
              value={toleranceTransverse}
              step={1}
              min={0}
              onCommit={onToleranceTransverseChange}
            />
          </div>
          <div className="transform-field">
            <label>Center hole diameter (mm)</label>
            <NumberField
              value={centerHoleDiameter}
              step={1}
              min={0}
              onCommit={onCenterHoleDiameterChange}
            />
          </div>
          <div className="transform-field">
            <label>Side hole diameter (mm)</label>
            <NumberField
              value={sideHoleDiameter}
              step={1}
              min={0}
              onCommit={onSideHoleDiameterChange}
            />
          </div>
          <div className="transform-field">
            <label>Side hole diameter offset (mm)</label>
            <NumberField
              value={sideHoleDiameterOffset}
              step={1}
              min={0}
              onCommit={onSideHoleDiameterOffsetChange}
            />
          </div>
          <div className="transform-field">
            <label>Overshoot (mm)</label>
            <NumberField value={overshoot} step={1} min={0} onCommit={onOvershootChange} />
          </div>
          <div className="transform-field">
            <label>Min side (mm)</label>
            <NumberField value={minSide} step={1} min={0} onCommit={onMinSideChange} />
          </div>
          <div className="transform-field">
            <label>Flange milling diameter (mm)</label>
            <NumberField
              value={flangeMillingDiameter}
              step={1}
              min={0}
              onCommit={onFlangeMillingDiameterChange}
            />
          </div>
          <p className="hint">
            The flat connector plate pair at each hub vertex, filling the wedges between struts
            that have no face of their own - a plate on each face of the strut ends, seated in the
            groove notch cut into them (see Groove depth above). Tolerances loosen the fit
            lengthwise/across each strut arm; overshoot and min side set how far the plate reaches
            past a strut's own corner and how narrow it's allowed to pinch; the side/center holes
            and their offsets are the plate's own bolt pattern.
          </p>
        </section>
      )}

      {mode === 'preview' && (
        <section className="control-group">
          <div className="button-row">
            <button onClick={onApplyPreview} disabled={!previewParamsDirty}>
              Apply
            </button>
            <button onClick={onGetEdgesInfo}>Get Edges Info</button>
          </div>
          <p className="hint">
            Downloads a JSON file with, for every visible vertex: each edge going into it, its
            precalculated strut-end measurements (offset, tenon, chamfer, milling), which
            neighboring edges have a face between them and which don&rsquo;t, and the tangent
            plane those edges were projected onto to work that out.
          </p>
        </section>
      )}

      {mode === 'edit' && (
        <section className="control-group">
          <h2>Edit</h2>
          <div className="segmented-control">
            {EDIT_TARGET_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={editTarget === opt.value ? 'active' : ''}
                onClick={() => onEditTargetChange(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {mode === 'edit' && editTarget === 'vertices' && (
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
            <button disabled={!canAddPoints} onClick={onConnectVertices}>
              Connect Vertices
            </button>
          </div>
          {selectedCount > 0 && !canAddPoints && (
            <p className="hint">Select an even number of points to pair them up.</p>
          )}
          <p className="hint">
            Connect Vertices pairs them by nearest neighbor and joins each pair with a direct
            edge, skipping any pair that's already connected.
          </p>
          <div className="button-row">
            <button onClick={onAdjustToSphere}>Adjust to a Sphere</button>
          </div>
          <p className="hint">
            Moves every vertex along its own line from the gravity center out to the sphere of
            the diameter set above.
          </p>
        </section>
      )}

      {mode === 'edit' && editTarget === 'edges' && (
        <section className="control-group">
          <h2>Edit edges</h2>
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
            {selectedEdgeCount > 0
              ? `${selectedEdgeCount} ${selectedEdgeCount !== 1 ? 'edges' : 'edge'} selected`
              : SELECTION_MODE_OPTIONS.find((opt) => opt.value === selectionMode)!.hint}
          </p>
          <div className="button-row">
            <button disabled={selectedEdgeCount === 0} onClick={onDeleteSelectedEdges}>
              Delete
            </button>
          </div>
          <p className="hint">
            Also removes any face that had it as a side, and any vertex it leaves with no other
            edge.
          </p>
          <div className="button-row">
            <button disabled={!canCreateFace} onClick={onCreateFace}>
              Create Face
            </button>
          </div>
          <p className="hint">
            Turns every triangle hiding among the selected edges into a face.
          </p>
        </section>
      )}

      {mode === 'edit' && editTarget === 'edges' && selectedEdgeCount > 0 && (
        <section className="control-group">
          <h2>Edge Thickness</h2>
          <div className="transform-field">
            <label>Thickness override (mm)</label>
            <NumberField
              value={edgeThicknessValue}
              step={5}
              min={0}
              placeholder={edgeThicknessValue === null ? 'Mixed' : undefined}
              clamp={(n) => Math.max(n, 0)}
              onCommit={onEdgeThicknessChange}
            />
          </div>
          <p className="hint">0 uses the global default thickness set in Preview.</p>
          <div className="button-row">
            <button disabled={!hasEdgeOverrides} onClick={onResetEdgeThickness}>
              Reset Thickness
            </button>
          </div>
        </section>
      )}

      {mode === 'edit' && editTarget === 'faces' && (
        <section className="control-group">
          <h2>Edit faces</h2>
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
            {selectedFaceCount > 0
              ? `${selectedFaceCount} ${selectedFaceCount !== 1 ? 'faces' : 'face'} selected`
              : SELECTION_MODE_OPTIONS.find((opt) => opt.value === selectionMode)!.hint}
          </p>
          <div className="button-row">
            <button disabled={selectedFaceCount === 0} onClick={onDeleteSelectedFaces}>
              Delete
            </button>
          </div>
        </section>
      )}

      {mode === 'edit' && editTarget === 'vertices' && selectedCount > 0 && (
        <section className="control-group">
          <h2>Transform</h2>
          <div className="transform-field">
            <label>Elevation (z, mm)</label>
            <NumberField
              value={zValue}
              step={10}
              placeholder={zValue === null ? 'Mixed' : undefined}
              onCommit={(v) => onTransformChange('z', v)}
            />
          </div>
          <div className="transform-field">
            <label>Radius (r, mm)</label>
            <NumberField
              value={rValue}
              step={10}
              placeholder={rValue === null ? 'Mixed' : undefined}
              onCommit={(v) => onTransformChange('r', v)}
            />
          </div>
          <div className="transform-field">
            <label>Angle (&theta;&deg;)</label>
            <NumberField
              value={thetaValue === null ? null : Math.round(((thetaValue * 180) / Math.PI) * 100) / 100}
              step={1}
              placeholder={thetaValue === null ? 'Mixed' : undefined}
              onCommit={(deg) => onTransformChange('theta', (deg * Math.PI) / 180)}
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
