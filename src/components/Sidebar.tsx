import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { EditOrPreviewMode, EditTarget, ViewMode } from '../App'
import { LANGUAGES, useI18n } from '../lib/i18n'
import type { StepExportProgress } from '../lib/stepExportRunner'
import type { DxfExportProgress } from '../lib/dxfExportRunner'
import {
  BRACE_PARAM_FIELDS,
  BRACE_PLATE_PARAM_FIELDS,
  sanitizeBraceParam,
  type BraceParams,
  type BracePlateParams,
} from '../lib/braces'
import { FLANGE_PARAM_FIELDS, type FlangeShapeParams } from '../lib/flangeGeometry'
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
  { value: 'braces', label: 'Braces' },
]

interface SidebarProps {
  onExportConfig: () => void
  onImportConfig: (file: File) => void
  onGetEdgesInfo: () => void
  onDownloadSteps: () => void
  onDownloadDxf: () => void
  dxfExportProgress: DxfExportProgress | null
  stepExportProgress: StepExportProgress | null
  stepExportScale: number
  onStepExportScaleChange: (scale: number) => void
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
  selectedEdgeCount: number
  selectedEdgeIndices: ReadonlySet<number>
  onDeleteSelectedEdges: () => void
  edgeThickness: ReadonlyMap<number, number>
  onEdgeThicknessChange: (value: number) => void
  onResetEdgeThickness: () => void
  vertexCornerLength: ReadonlyMap<number, number>
  onVertexCornerLengthChange: (value: number) => void
  onResetVertexCornerLength: () => void
  vertexFlangeParams: ReadonlyMap<number, Partial<FlangeShapeParams>>
  onVertexFlangeParamChange: (key: keyof FlangeShapeParams, value: number) => void
  onResetVertexFlangeParam: (key: keyof FlangeShapeParams) => void
  onResetVertexFlangeParams: () => void
  canCreateFace: boolean
  onCreateFace: () => void
  canAddBrace: boolean
  onAddBrace: () => void
  selectedBraceCount: number
  // Each brace property's value if all the selected braces share it, else null.
  braceParamValues: Record<keyof BraceParams, number | null>
  onBraceParamChange: (key: keyof BraceParams, value: number) => void
  onDeleteSelectedBraces: () => void
  selectedFaceCount: number
  onDeleteSelectedFaces: () => void
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
  // The plate properties every brace shares, edited in Preview (applied with the Apply button).
  bracePlateDraft: BracePlateParams
  onBracePlateParamChange: (key: keyof BracePlateParams, value: number) => void
  previewParamsDirty: boolean
  onApplyPreview: () => void
  canUndo: boolean
  canRedo: boolean
  onDeleteSelected: () => void
  onUndo: () => void
  onRedo: () => void
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

// null return means the selected items don't all share the same override (one without an
// override counts as 0, i.e. "use the global default").
function sharedOverrideValue(
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

// How one flange parameter's per-vertex override looks across the selected vertices: `value` is
// the override if every selected vertex has the same one (null if none has one), `mixed` if they
// differ (some overridden differently, or only some overridden), `any` if at least one has one.
function sharedFlangeOverride(
  selected: ReadonlySet<number>,
  overrides: ReadonlyMap<number, Partial<FlangeShapeParams>>,
  key: keyof FlangeShapeParams,
): { value: number | null; mixed: boolean; any: boolean } {
  let first = true
  let value: number | undefined
  let mixed = false
  let any = false
  for (const idx of selected) {
    const v = overrides.get(idx)?.[key]
    if (v !== undefined) any = true
    if (first) {
      value = v
      first = false
    } else if (v !== value) {
      mixed = true
    }
  }
  return { value: mixed ? null : (value ?? null), mixed, any }
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
  onDownloadSteps,
  onDownloadDxf,
  dxfExportProgress,
  stepExportProgress,
  stepExportScale,
  onStepExportScaleChange,
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
  selectedEdgeCount,
  selectedEdgeIndices,
  onDeleteSelectedEdges,
  edgeThickness,
  onEdgeThicknessChange,
  onResetEdgeThickness,
  vertexCornerLength,
  onVertexCornerLengthChange,
  onResetVertexCornerLength,
  vertexFlangeParams,
  onVertexFlangeParamChange,
  onResetVertexFlangeParam,
  onResetVertexFlangeParams,
  canCreateFace,
  onCreateFace,
  canAddBrace,
  onAddBrace,
  selectedBraceCount,
  braceParamValues,
  onBraceParamChange,
  onDeleteSelectedBraces,
  selectedFaceCount,
  onDeleteSelectedFaces,
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
  bracePlateDraft,
  onBracePlateParamChange,
  previewParamsDirty,
  onApplyPreview,
  canUndo,
  canRedo,
  onDeleteSelected,
  onUndo,
  onRedo,
}: SidebarProps) {
  const { t, tn, lang, setLang } = useI18n()
  const axisOptions = SHAPE_AXES[shape]
  const maxLayers = data.layers.length

  const rValue = sharedTransformValue(selectedVertexIndices, vertexTransforms, 'r')
  const azimuthValue = sharedTransformValue(selectedVertexIndices, vertexTransforms, 'azimuth')
  const elevationValue = sharedTransformValue(selectedVertexIndices, vertexTransforms, 'elevation')
  const hasTransforms = Array.from(selectedVertexIndices).some((idx) => vertexTransforms.has(idx))

  const edgeThicknessValue = sharedOverrideValue(selectedEdgeIndices, edgeThickness)
  const hasEdgeOverrides = Array.from(selectedEdgeIndices).some((idx) => edgeThickness.has(idx))

  const flangeDefaults: FlangeShapeParams = {
    toleranceLongitudinal,
    toleranceTransverse,
    centerHoleDiameter,
    sideHoleDiameter,
    sideHoleDiameterOffset,
    overshoot,
    minSide,
    millingDiameter: flangeMillingDiameter,
  }
  const hasVertexFlangeOverrides = Array.from(selectedVertexIndices).some((idx) =>
    vertexFlangeParams.has(idx),
  )

  const vertexCornerLengthValue = sharedOverrideValue(selectedVertexIndices, vertexCornerLength)
  const hasVertexCornerLengthOverrides = Array.from(selectedVertexIndices).some((idx) =>
    vertexCornerLength.has(idx),
  )

  const importInputRef = useRef<HTMLInputElement>(null)

  const handleImportFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onImportConfig(file)
    e.target.value = ''
  }

  return (
    <aside className="sidebar">
      <div className="segmented-control lang-switch" role="group" aria-label={t('Language')}>
        {LANGUAGES.map((opt) => (
          <button
            key={opt.value}
            className={lang === opt.value ? 'active' : ''}
            onClick={() => setLang(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <h1>{t('Dome Builder')}</h1>

      {mode !== 'new' && (
        <section className="control-group">
          <div className="button-row">
            <button onClick={onExportConfig}>{t('Save as')}</button>
            <button onClick={() => importInputRef.current?.click()}>{t('Load file')}</button>
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
            <button onClick={onCreateNew}>{t('Create')}</button>
            <button onClick={onCancelNew}>{t('Cancel')}</button>
          </div>
        </section>
      ) : (
        <>
          <section className="control-group">
            <div className="button-row">
              <button onClick={onOpenNew}>{t('New dome')}</button>
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
                  {t(opt.label)}
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      <section className="control-group">
        <h2>{t('Diameter')}</h2>
        <div className="transform-field">
          <label>{t('Diameter (mm)')}</label>
          <NumberField value={diameter} step={100} min={1} onCommit={onDiameterChange} />
        </div>
        {mode !== 'new' && (
          <p className="hint">
            {t('Resizes the whole dome around its center, keeping its shape.')}
          </p>
        )}
      </section>

      {mode === 'new' && (
        <section className="control-group">
          <h2>{t('Shape')}</h2>
          {(Object.keys(SHAPE_LABELS) as ShapeType[]).map((s) => (
            <label key={s} className="radio-row">
              <input
                type="radio"
                name="shape"
                checked={shape === s}
                onChange={() => onShapeChange(s)}
              />
              {t(SHAPE_LABELS[s])}
            </label>
          ))}
        </section>
      )}

      {mode === 'new' && (
        <section className="control-group">
          <h2>{t('Main axis')}</h2>
          {axisOptions.map((opt) => (
            <label key={opt.value} className="radio-row">
              <input
                type="radio"
                name="axis"
                checked={axis === opt.value}
                onChange={() => onAxisChange(opt.value)}
              />
              <span>
                {t(opt.label)}
                <span className="hint">
                  {tn(opt.axisCount, '{n} axis', '{n} axes')} &middot; {t('{fold}-fold', { fold: opt.fold })}
                </span>
              </span>
            </label>
          ))}
        </section>
      )}

      {mode === 'new' && (
        <section className="control-group">
          <h2>{t('Subdivisions')}</h2>
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
          <h2>{t('Layers')}</h2>
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

      {(mode === 'preview' || mode === 'edit') && (
        <section className="control-group">
          <div className="button-row">
            <button onClick={onApplyPreview} disabled={!previewParamsDirty}>
              {t('Apply')}
            </button>
          </div>
          <p className="hint">
            {previewParamsDirty
              ? t('Unapplied changes below - click Apply to regenerate the preview.')
              : t('Rebuilding every strut solid is slow, so changes to the fields below only take effect once you click Apply.')}
          </p>
        </section>
      )}

      {(mode === 'preview' || mode === 'edit') && (
        <section className="control-group">
          <h2>{t('Edge Curvature')}</h2>
          <div className="transform-field">
            <label>{t('Corner length (D, mm)')}</label>
            <NumberField value={cornerLength} step={5} min={0} onCommit={onCornerLengthChange} />
          </div>
          <p className="hint">
            {t(
              "Corner length (D): straight lead-in at each end, tangent to the sphere and angled toward the other end - trimmed back from the vertex by that hub's own minimum offset (shown when a single vertex is selected in Edit mode), up to this budget. Meeting lead-ins form a sharp point; otherwise the gap between them is bridged by an arc centered on the sphere center.",
            )}
          </p>
          <div className="transform-field">
            <label>{t('Offset modifier (mm)')}</label>
            <NumberField value={offsetModifier} step={5} onCommit={onOffsetModifierChange} />
          </div>
          <p className="hint">
            {t(
              "Offset modifier: added to every edge end's own minimum offset before it's trimmed back from the vertex (still capped by the corner length budget). Positive pulls every strut end further in; negative pushes it back out, toward the vertex.",
            )}
          </p>
          <div className="transform-field">
            <label>{t('Width (mm)')}</label>
            <NumberField value={extrudeDistance} step={5} min={0} onCommit={onExtrudeDistanceChange} />
          </div>
          <p className="hint">
            {t(
              "Width: extrudes each arc symmetrically toward/away from the sphere's center.",
            )}
          </p>
          <div className="transform-field">
            <label>{t('Thickness (mm)')}</label>
            <NumberField value={thickness} step={5} min={0} onCommit={onThicknessChange} />
          </div>
          <p className="hint">
            {t(
              'Thickness: extrudes that ribbon symmetrically along its own surface normal, turning it into a solid beam.',
            )}
          </p>
        </section>
      )}

      {(mode === 'preview' || mode === 'edit') && (
        <section className="control-group">
          <h2>{t('Grooves')}</h2>
          <div className="transform-field">
            <label>{t('End groove length (%)')}</label>
            <NumberField
              value={endGrooveLengthPercent}
              step={5}
              min={0}
              onCommit={onEndGrooveLengthPercentChange}
            />
          </div>
          <div className="transform-field">
            <label>{t('Mid groove length (%)')}</label>
            <NumberField
              value={midGrooveLengthPercent}
              step={5}
              min={0}
              onCommit={onMidGrooveLengthPercentChange}
            />
          </div>
          <div className="transform-field">
            <label>{t('Groove depth (mm)')}</label>
            <NumberField value={grooveDepth} step={1} min={0} onCommit={onGrooveDepthChange} />
          </div>
          <div className="transform-field">
            <label>{t('Milling diameter (mm)')}</label>
            <NumberField value={millingDiameter} step={1} min={0} onCommit={onMillingDiameterChange} />
          </div>
          <div className="transform-field">
            <label>{t('Chamfer length (mm)')}</label>
            <NumberField value={chamferLength} step={1} min={0} onCommit={onChamferLengthChange} />
          </div>
          <p className="hint">
            {t(
              "Each strut end forms a shouldered tenon: the end and mid groove percentages split the workable length (past the offset) into the shoulder, tenon, and far shoulder, cut back by groove depth. Chamfer length bevels the tenon's top corners; milling diameter sets a relief circle tucked into each of its concave base corners, clearing room for a square mating part to seat flush against a round cutting bit.",
            )}
          </p>
        </section>
      )}

      {(mode === 'preview' || mode === 'edit') && (
        <section className="control-group">
          <h2>{t('Flange')}</h2>
          <div className="transform-field">
            <label>{t('Tolerance longitudinal (mm)')}</label>
            <NumberField
              value={toleranceLongitudinal}
              step={1}
              min={0}
              onCommit={onToleranceLongitudinalChange}
            />
          </div>
          <div className="transform-field">
            <label>{t('Tolerance transverse (mm)')}</label>
            <NumberField
              value={toleranceTransverse}
              step={1}
              min={0}
              onCommit={onToleranceTransverseChange}
            />
          </div>
          <div className="transform-field">
            <label>{t('Center hole diameter (mm)')}</label>
            <NumberField
              value={centerHoleDiameter}
              step={1}
              min={0}
              onCommit={onCenterHoleDiameterChange}
            />
          </div>
          <div className="transform-field">
            <label>{t('Side hole diameter (mm)')}</label>
            <NumberField
              value={sideHoleDiameter}
              step={1}
              min={0}
              onCommit={onSideHoleDiameterChange}
            />
          </div>
          <div className="transform-field">
            <label>{t('Side hole diameter offset (mm)')}</label>
            <NumberField
              value={sideHoleDiameterOffset}
              step={1}
              min={0}
              onCommit={onSideHoleDiameterOffsetChange}
            />
          </div>
          <div className="transform-field">
            <label>{t('Overshoot (mm)')}</label>
            <NumberField value={overshoot} step={1} min={0} onCommit={onOvershootChange} />
          </div>
          <div className="transform-field">
            <label>{t('Min side (mm)')}</label>
            <NumberField value={minSide} step={1} min={0} onCommit={onMinSideChange} />
          </div>
          <div className="transform-field">
            <label>{t('Flange milling diameter (mm)')}</label>
            <NumberField
              value={flangeMillingDiameter}
              step={1}
              min={0}
              onCommit={onFlangeMillingDiameterChange}
            />
          </div>
          <p className="hint">
            {t(
              "The flat connector plate pair at each hub vertex, filling the wedges between struts that have no face of their own - a plate on each face of the strut ends, seated in the groove notch cut into them (see Groove depth above). Tolerances loosen the fit lengthwise/across each strut arm; overshoot and min side set how far the plate reaches past a strut's own corner and how narrow it's allowed to pinch; the side/center holes and their offsets are the plate's own bolt pattern.",
            )}
          </p>
        </section>
      )}

      {(mode === 'preview' || mode === 'edit') && (
        <section className="control-group">
          <h2>{t('Braces')}</h2>
          {BRACE_PLATE_PARAM_FIELDS.map(({ key, label, step }) => (
            <div className="transform-field" key={key}>
              <label>{t(label)}</label>
              <NumberField
                value={bracePlateDraft[key]}
                step={step}
                min={0}
                clamp={(n) => sanitizeBraceParam(key, n)}
                onCommit={(value) => onBracePlateParamChange(key, value)}
              />
            </div>
          ))}
          <p className="hint">
            {t(
              'The same for every brace, and applied to all of them with Apply (new braces start with these too). Where a brace sits (shift) is set per brace in Edit → Braces. The plate is extruded out from the strut’s side face, toward the brace’s other edge.',
            )}
          </p>
        </section>
      )}

      {mode === 'preview' && (
        <section className="control-group">
          <div className="button-row">
            <button onClick={onApplyPreview} disabled={!previewParamsDirty}>
              {t('Apply')}
            </button>
            <button onClick={onGetEdgesInfo}>{t('Get Edges Info')}</button>
          </div>
          <p className="hint">
            {t(
              'Downloads a JSON file with, for every visible vertex: each edge going into it, its precalculated strut-end measurements (offset, tenon, chamfer, milling), which neighboring edges have a face between them and which don’t, and the tangent plane those edges were projected onto to work that out.',
            )}
          </p>
        </section>
      )}

      {mode === 'preview' && (
        <section className="control-group">
          <div className="transform-field">
            <label>{t('Scale')}</label>
            <NumberField
              value={stepExportScale}
              step={0.1}
              min={0.01}
              onCommit={onStepExportScaleChange}
            />
          </div>
          <div className="button-row">
            <button onClick={onDownloadSteps} disabled={stepExportProgress !== null}>
              {t('Download STEP Archive')}
            </button>
            <button onClick={onDownloadDxf} disabled={dxfExportProgress !== null}>
              {t('Download DXF')}
            </button>
          </div>
          <p className="hint">
            {stepExportProgress
              ? stepExportProgress.phase === 'zipping'
                ? t('Zipping…')
                : t('Building {phase} — {done} / {total}', { phase: t(stepExportProgress.phase), done: stepExportProgress.done, total: stepExportProgress.total })
              : t(
                stepExportScale !== 1
                  ? 'Exports every visible strut, flange plate, brace plate and brace as its own STEP file (same shapes as this Preview, scaled {scale}x), zipped into one archive.'
                  : 'Exports every visible strut, flange plate, brace plate and brace as its own STEP file (same shapes as this Preview), zipped into one archive.',
                { scale: stepExportScale },
              )}
          </p>
          <p className="hint">
            {dxfExportProgress
              ? dxfExportProgress.phase === 'writing'
                ? t('Writing DXF…')
                : t('DXF: building {phase} — {done} / {total}', { phase: t(dxfExportProgress.phase), done: dxfExportProgress.done, total: dxfExportProgress.total })
              : t('The DXF puts the flat outlines of all those parts on one sheet (same scale), each labeled with its ID in red. Green labels show how parts connect: on flanges the strut (S) in each hole, on struts the vertex (V) at each end and the brace (B) at its center, on braces the struts (S) at each end.')}
          </p>
        </section>
      )}

      {mode === 'edit' && (
        <section className="control-group">
          <h2>{t('Edit')}</h2>
          <div className="segmented-control">
            {EDIT_TARGET_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={editTarget === opt.value ? 'active' : ''}
                onClick={() => onEditTargetChange(opt.value)}
              >
                {t(opt.label)}
              </button>
            ))}
          </div>
        </section>
      )}

      {mode === 'edit' && (
        <section className="control-group">
          <div className="button-row">
            <button onClick={onGetEdgesInfo}>{t('Get Edges Info')}</button>
          </div>
          <p className="hint">
            {t(
              'Downloads a JSON file with, for every visible vertex: each edge going into it, its precalculated strut-end measurements (offset, tenon, chamfer, milling), which neighboring edges have a face between them and which don’t, and the tangent plane those edges were projected onto to work that out.',
            )}
          </p>
        </section>
      )}

      {mode === 'edit' && editTarget === 'vertices' && (
        <section className="control-group">
          <h2>{t('Edit vertices')}</h2>
          <div className="segmented-control">
            {SELECTION_MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={selectionMode === opt.value ? 'active' : ''}
                onClick={() => onSelectionModeChange(opt.value)}
              >
                {t(opt.label)}
              </button>
            ))}
          </div>
          <p className="hint">
            {selectedCount > 0
              ? tn(selectedCount, '{n} vertex selected', '{n} vertices selected')
              : t(SELECTION_MODE_OPTIONS.find((opt) => opt.value === selectionMode)!.hint)}
          </p>
          <div className="button-row">
            <button disabled={selectedCount === 0} onClick={onDeleteSelected}>
              {t('Delete')}
            </button>
            <button disabled={!canUndo} onClick={onUndo}>
              {t('Undo')}
            </button>
            <button disabled={!canRedo} onClick={onRedo}>
              {t('Redo')}
            </button>
          </div>
          <div className="button-row">
            <button disabled={!canAddPoints} onClick={onAddPoints}>
              {t('Add Points')}
            </button>
            <button disabled={!canAddPoints} onClick={onConnectVertices}>
              {t('Connect Vertices')}
            </button>
          </div>
          {selectedCount > 0 && !canAddPoints && (
            <p className="hint">{t('Select an even number of points to pair them up.')}</p>
          )}
          <p className="hint">
            {t(
              "Connect Vertices pairs them by nearest neighbor and joins each pair with a direct edge, skipping any pair that's already connected.",
            )}
          </p>
        </section>
      )}

      {mode === 'edit' && editTarget === 'edges' && (
        <section className="control-group">
          <h2>{t('Edit edges')}</h2>
          <div className="segmented-control">
            {SELECTION_MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={selectionMode === opt.value ? 'active' : ''}
                onClick={() => onSelectionModeChange(opt.value)}
              >
                {t(opt.label)}
              </button>
            ))}
          </div>
          <p className="hint">
            {selectedEdgeCount > 0
              ? tn(selectedEdgeCount, '{n} edge selected', '{n} edges selected')
              : t(SELECTION_MODE_OPTIONS.find((opt) => opt.value === selectionMode)!.hint)}
          </p>
          <div className="button-row">
            <button disabled={selectedEdgeCount === 0} onClick={onDeleteSelectedEdges}>
              {t('Delete')}
            </button>
          </div>
          <p className="hint">
            {t(
              'Also removes any face that had it as a side, and any vertex it leaves with no other edge.',
            )}
          </p>
          <div className="button-row">
            <button disabled={!canCreateFace} onClick={onCreateFace}>
              {t('Create Face')}
            </button>
          </div>
          <p className="hint">
            {t('Turns every triangle hiding among the selected edges into a face.')}
          </p>
          <div className="button-row">
            <button disabled={!canAddBrace} onClick={onAddBrace}>
              {t('Add Brace')}
            </button>
          </div>
          <p className="hint">
            {t(
              'Select exactly two edges that meet at the same vertex (use Point selection mode) to link them with a brace.',
            )}
          </p>
        </section>
      )}

      {mode === 'edit' && editTarget === 'edges' && selectedEdgeCount > 0 && (
        <section className="control-group">
          <h2>{t('Edge Thickness')}</h2>
          <div className="transform-field">
            <label>{t('Thickness override (mm)')}</label>
            <NumberField
              value={edgeThicknessValue}
              step={5}
              min={0}
              placeholder={edgeThicknessValue === null ? t('Mixed') : undefined}
              clamp={(n) => Math.max(n, 0)}
              onCommit={onEdgeThicknessChange}
            />
          </div>
          <p className="hint">{t('0 uses the global default thickness set in Preview.')}</p>
          <div className="button-row">
            <button disabled={!hasEdgeOverrides} onClick={onResetEdgeThickness}>
              {t('Reset Thickness')}
            </button>
          </div>
        </section>
      )}

      {mode === 'edit' && editTarget === 'faces' && (
        <section className="control-group">
          <h2>{t('Edit faces')}</h2>
          <div className="segmented-control">
            {SELECTION_MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={selectionMode === opt.value ? 'active' : ''}
                onClick={() => onSelectionModeChange(opt.value)}
              >
                {t(opt.label)}
              </button>
            ))}
          </div>
          <p className="hint">
            {selectedFaceCount > 0
              ? tn(selectedFaceCount, '{n} face selected', '{n} faces selected')
              : t(SELECTION_MODE_OPTIONS.find((opt) => opt.value === selectionMode)!.hint)}
          </p>
          <div className="button-row">
            <button disabled={selectedFaceCount === 0} onClick={onDeleteSelectedFaces}>
              {t('Delete')}
            </button>
          </div>
        </section>
      )}

      {mode === 'edit' && editTarget === 'braces' && (
        <section className="control-group">
          <h2>{t('Edit braces')}</h2>
          <p className="hint">
            {selectedBraceCount > 0
              ? tn(selectedBraceCount, '{n} brace selected', '{n} braces selected')
              : t('Click a brace to select it. Add braces from two edges in the Edges tab.')}
          </p>
          <div className="button-row">
            <button disabled={selectedBraceCount === 0} onClick={onDeleteSelectedBraces}>
              {t('Delete')}
            </button>
          </div>
        </section>
      )}

      {mode === 'edit' && editTarget === 'braces' && selectedBraceCount > 0 && (
        <section className="control-group">
          <h2>{t('Brace Properties')}</h2>
          {BRACE_PARAM_FIELDS.map(({ key, label, step }) => (
            <div className="transform-field" key={key}>
              <label>{t(label)}</label>
              <NumberField
                value={braceParamValues[key]}
                step={step}
                min={0}
                placeholder={braceParamValues[key] === null ? t('Mixed') : undefined}
                clamp={(n) => sanitizeBraceParam(key, n)}
                onCommit={(value) => onBraceParamChange(key, value)}
              />
            </div>
          ))}
          <p className="hint">
            {t(
              'Shift is where the brace meets each edge, measured from their shared vertex. The plate settings after the first two aren’t used yet.',
            )}
          </p>
        </section>
      )}

      {mode === 'edit' && editTarget === 'vertices' && selectedCount > 0 && (
        <section className="control-group">
          <h2>{t('Corner Length')}</h2>
          <div className="transform-field">
            <label>{t('Corner length override (mm)')}</label>
            <NumberField
              value={vertexCornerLengthValue}
              step={5}
              min={0}
              placeholder={vertexCornerLengthValue === null ? t('Mixed') : undefined}
              clamp={(n) => Math.max(n, 0)}
              onCommit={onVertexCornerLengthChange}
            />
          </div>
          <p className="hint">
            {t(
              'Applies to every strut end and flange at the selected vertices. 0 uses the global corner length set in Edge Curvature.',
            )}
          </p>
          <div className="button-row">
            <button disabled={!hasVertexCornerLengthOverrides} onClick={onResetVertexCornerLength}>
              {t('Reset Corner Length')}
            </button>
          </div>
        </section>
      )}

      {mode === 'edit' && editTarget === 'vertices' && selectedCount > 0 && (
        <section className="control-group">
          <h2>{t('Flange Overrides')}</h2>
          {FLANGE_PARAM_FIELDS.map(({ key, label }) => {
            const shared = sharedFlangeOverride(selectedVertexIndices, vertexFlangeParams, key)
            return (
              <div className="transform-field" key={key}>
                <label>{t(label)}</label>
                <span className="field-with-reset">
                  <NumberField
                    value={shared.value}
                    step={1}
                    min={0}
                    placeholder={shared.mixed ? t('Mixed') : t('{value} (default)', { value: flangeDefaults[key] })}
                    clamp={(n) => Math.max(n, 0)}
                    onCommit={(v) => onVertexFlangeParamChange(key, v)}
                  />
                  <button
                    className="reset-field"
                    title={t('Use the global value')}
                    disabled={!shared.any}
                    onClick={() => onResetVertexFlangeParam(key)}
                  >
                    &times;
                  </button>
                </span>
              </div>
            )
          })}
          <p className="hint">
            {t(
              "Overrides the Flange section's values for the flange at the selected vertices only. A blank field uses the global value (shown in grey); × goes back to it. Overridden vertices are shown in cyan.",
            )}
          </p>
          <div className="button-row">
            <button disabled={!hasVertexFlangeOverrides} onClick={onResetVertexFlangeParams}>
              {t('Reset Flange Overrides')}
            </button>
          </div>
        </section>
      )}

      {mode === 'edit' && editTarget === 'vertices' && selectedCount > 0 && (
        <section className="control-group">
          <h2>{t('Transform')}</h2>
          <div className="transform-field">
            <label>{t('Radius (Δr, mm)')}</label>
            <NumberField
              value={rValue}
              step={10}
              placeholder={rValue === null ? t('Mixed') : undefined}
              onCommit={(v) => onTransformChange('r', v)}
            />
          </div>
          <div className="transform-field">
            <label>{t('Azimuth (Δ°)')}</label>
            <NumberField
              value={azimuthValue === null ? null : Math.round(((azimuthValue * 180) / Math.PI) * 100) / 100}
              step={1}
              placeholder={azimuthValue === null ? t('Mixed') : undefined}
              onCommit={(deg) => onTransformChange('azimuth', (deg * Math.PI) / 180)}
            />
          </div>
          <div className="transform-field">
            <label>{t('Elevation (Δ°)')}</label>
            <NumberField
              value={elevationValue === null ? null : Math.round(((elevationValue * 180) / Math.PI) * 100) / 100}
              step={1}
              placeholder={elevationValue === null ? t('Mixed') : undefined}
              onCommit={(deg) => onTransformChange('elevation', (deg * Math.PI) / 180)}
            />
          </div>
          <p className="hint">
            {rValue === 0 && azimuthValue === 0 && elevationValue === 0
              ? t('Default position (0, 0, 0)')
              : t('Polar offsets from the default position, about the dome center. Radius moves the vertex toward/away from the center; azimuth rotates it around the vertical axis; elevation tilts it up/down along its meridian.')}
          </p>
          <div className="button-row">
            <button disabled={!hasTransforms} onClick={onResetTransform}>
              {t('Reset Transform')}
            </button>
          </div>
        </section>
      )}
    </aside>
  )
}
