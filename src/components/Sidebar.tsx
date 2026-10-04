import type { StepExportSettings } from '../lib/stepExportSettings'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ChangeEvent, ReactNode, SyntheticEvent } from 'react'
import type { EditOrPreviewMode, EditTarget, ViewMode } from '../App'
import { LANGUAGES, useI18n } from '../lib/i18n'
import {
  PREVIEW_PART_KINDS,
  type PartVisibility,
  type PreviewPartKind,
} from '../lib/previewParts'
import type { DxfSheetSettings } from '../lib/dxfSheetSettings'
import {
  BRACE_PARAM_FIELDS,
  BRACE_PLATE_PARAM_FIELDS,
  sanitizeBraceParam,
  type BraceParams,
  type BracePlateParams,
} from '../lib/braces'
import { FLANGE_PARAM_FIELDS, FOOT_PARAM_FIELDS, type FlangeShapeParams, type FootParams } from '../lib/flangeGeometry'
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
  onDownloadSteps: () => void
  onDownloadStepAssembly: () => void
  onDownloadDxf: () => void
  exportBusy: boolean
  stepExportSettings: StepExportSettings
  onStepExportSettingsChange: (settings: StepExportSettings) => void
  dxfSheetSettings: DxfSheetSettings
  onDxfSheetSettingsChange: (settings: DxfSheetSettings) => void
  partIdLabelSize: number
  onPartIdLabelSizeChange: (size: number) => void
  connectedPartIdLabelSize: number
  onConnectedPartIdLabelSizeChange: (size: number) => void
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
  onAlignHorizontally: () => void
  onAlignVertically: () => void
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
  onResetAllVertexOverrides: () => void
  // Vertices marked as feet; the toggle marks/unmarks every selected vertex.
  footVertices: ReadonlySet<number>
  onFootVertexToggle: (isFoot: boolean) => void
  // The dimensions shared by every foot.
  footParams: FootParams
  onFootParamChange: (key: keyof FootParams, value: number) => void
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
  roundStrutBridge: boolean
  onRoundStrutBridgeChange: (value: boolean) => void
  toleranceLongitudinal: number
  onToleranceLongitudinalChange: (value: number) => void
  toleranceTransverse: number
  onToleranceTransverseChange: (value: number) => void
  centerHoleDiameter: number
  onCenterHoleDiameterChange: (value: number) => void
  sideHoleDiameterOuter: number
  onSideHoleDiameterOuterChange: (value: number) => void
  sideHoleDiameterInner: number
  onSideHoleDiameterInnerChange: (value: number) => void
  sideHoleDiameterOffset: number
  onSideHoleDiameterOffsetChange: (value: number) => void
  overshoot: number
  onOvershootChange: (value: number) => void
  minSide: number
  onMinSideChange: (value: number) => void
  flangeMillingDiameter: number
  onFlangeMillingDiameterChange: (value: number) => void
  // The plate properties every brace shares, applied with Redraw in Preview.
  bracePlateDraft: BracePlateParams
  onBracePlateParamChange: (key: keyof BracePlateParams, value: number) => void
  previewParamsDirty: boolean
  onApplyPreview: () => void
  // View-only visibility of each kind of part in Preview.
  partVisibility: PartVisibility
  onPartVisibilityChange: (kind: PreviewPartKind, visible: boolean) => void
  canUndo: boolean
  canRedo: boolean
  onDeleteSelected: () => void
  onUndo: () => void
  onRedo: () => void
  onEndHistoryGroup: () => void
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

function FieldLabel({ text }: { text: string }) {
  const match = /^(.*?)\s*\((?:(.+),\s*)?(mm|мм|%|Δ°)\)$/.exec(text)
  if (!match) return text
  const [, name, notation, unit] = match
  return <>{name}{notation ? ` (${notation})` : ''}, <em>{unit}</em></>
}

function SidebarSection({ id, title, children, defaultOpen = true }: { id: string; title: string; children: ReactNode; defaultOpen?: boolean }) {
  const storageKey = `dome-builder.sidebar.${id}`
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      return saved === null ? defaultOpen : saved === 'true'
    } catch {
      return defaultOpen
    }
  })
  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const isOpen = event.currentTarget.open
    setOpen(isOpen)
    try {
      localStorage.setItem(storageKey, String(isOpen))
    } catch {
      // The sidebar still works when browser storage is unavailable.
    }
  }
  return <details className="sidebar-section" open={open} onToggle={handleToggle}>
    <summary>{title}</summary>
    <div className="sidebar-section-content">{children}</div>
  </details>
}

function Help({ text }: { text: string }) {
  const id = useId()
  const [visible, setVisible] = useState(false)
  const marker = useRef<HTMLSpanElement>(null)
  const anchor = useRef<HTMLElement | null>(null)
  const tooltip = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const element = marker.current
    if (!element) return
    const field = element.closest('.transform-field')
    let previous = element.previousElementSibling
    while (previous?.matches('.field-help, .hint')) previous = previous.previousElementSibling
    const group = element.parentElement
    const fields = !field && previous?.matches('.transform-field')
      ? Array.from(group?.querySelectorAll<HTMLElement>('.transform-field') ?? [])
      : []
    const targets = field
      ? [field as HTMLElement]
      : fields.length > 1
        ? fields
        : previous instanceof HTMLElement ? [previous] : []

    const cleanups = targets.map((target) => {
      const show = () => { anchor.current = target; setVisible(true) }
      const hide = () => { if (anchor.current === target) setVisible(false) }
      const leave = () => { if (!target.contains(document.activeElement)) hide() }
      target.addEventListener('mouseenter', show)
      target.addEventListener('mouseleave', leave)
      target.addEventListener('focusin', show)
      target.addEventListener('focusout', hide)
      const focusable = target.matches('input, button') ? [target] : Array.from(target.querySelectorAll<HTMLElement>('input, button'))
      const describedBy = focusable.map((item) => [item, item.getAttribute('aria-describedby')] as const)
      focusable.forEach((item) => item.setAttribute('aria-describedby', [item.getAttribute('aria-describedby'), id].filter(Boolean).join(' ')))
      return () => {
        target.removeEventListener('mouseenter', show)
        target.removeEventListener('mouseleave', leave)
        target.removeEventListener('focusin', show)
        target.removeEventListener('focusout', hide)
        describedBy.forEach(([item, value]) => value === null ? item.removeAttribute('aria-describedby') : item.setAttribute('aria-describedby', value))
      }
    })
    return () => cleanups.forEach((cleanup) => cleanup())
  }, [id])

  useLayoutEffect(() => {
    if (!visible || !anchor.current || !tooltip.current) return
    const anchorRect = anchor.current.getBoundingClientRect()
    const box = tooltip.current.getBoundingClientRect()
    tooltip.current.style.left = `${Math.max(8, Math.min(anchorRect.left, window.innerWidth - box.width - 8))}px`
    tooltip.current.style.top = `${Math.max(8, anchorRect.bottom + box.height + 8 <= window.innerHeight
      ? anchorRect.bottom + 4
      : anchorRect.top - box.height - 4)}px`
  }, [visible, text])

  return <>
    <span ref={marker} className="field-help" hidden />
    {visible && createPortal(<span ref={tooltip} id={id} className="help-tooltip" role="tooltip">{text}</span>, document.body)}
  </>
}

export function Sidebar({
  onExportConfig,
  onImportConfig,
  onDownloadSteps,
  onDownloadStepAssembly,
  onDownloadDxf,
  exportBusy,
  stepExportSettings,
  onStepExportSettingsChange,
  dxfSheetSettings,
  onDxfSheetSettingsChange,
  partIdLabelSize,
  onPartIdLabelSizeChange,
  connectedPartIdLabelSize,
  onConnectedPartIdLabelSizeChange,
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
  onAlignHorizontally,
  onAlignVertically,
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
  onResetAllVertexOverrides,
  footVertices,
  onFootVertexToggle,
  footParams,
  onFootParamChange,
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
  roundStrutBridge,
  onRoundStrutBridgeChange,
  toleranceLongitudinal,
  onToleranceLongitudinalChange,
  toleranceTransverse,
  onToleranceTransverseChange,
  centerHoleDiameter,
  onCenterHoleDiameterChange,
  sideHoleDiameterOuter,
  onSideHoleDiameterOuterChange,
  sideHoleDiameterInner,
  onSideHoleDiameterInnerChange,
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
  partVisibility,
  onPartVisibilityChange,
  canUndo,
  canRedo,
  onDeleteSelected,
  onUndo,
  onRedo,
  onEndHistoryGroup,
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
    sideHoleDiameterOuter,
    sideHoleDiameterInner,
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

  const selectedFootCount = Array.from(selectedVertexIndices).filter((idx) => footVertices.has(idx)).length
  const allSelectedAreFeet = selectedVertexIndices.size > 0 && selectedFootCount === selectedVertexIndices.size
  const someSelectedAreFeet = selectedFootCount > 0 && !allSelectedAreFeet

  const importInputRef = useRef<HTMLInputElement>(null)
  const handleImportFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onImportConfig(file)
    e.target.value = ''
  }

  return (
    <aside className="sidebar" onBlurCapture={onEndHistoryGroup} onPointerUpCapture={onEndHistoryGroup}>
      <SidebarSection id="editor" title={t('Editor')}>
        <div className="button-row editor-actions">
          <button onClick={onOpenNew} disabled={mode === 'new'}>{t('New dome')}</button>
          <button onClick={onExportConfig}>{t('Save as')}</button>
          <button onClick={() => importInputRef.current?.click()}>{t('Load file')}</button>
        </div>
        <input ref={importInputRef} type="file" accept="application/json" hidden onChange={handleImportFileChange} />
        <div className="editor-tools-row">
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
          <div className="button-row history-actions">
            <span className="history-action">
              <button disabled={mode === 'new' || !canUndo} onClick={onUndo} aria-label={t('Undo')}>
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 14 4 9l5-5" />
                  <path d="M4 9h10a6 6 0 0 1 0 12h-2" />
                </svg>
              </button>
              <span className="history-action-tooltip" role="tooltip">{t('Undo')}</span>
            </span>
            <span className="history-action">
              <button disabled={mode === 'new' || !canRedo} onClick={onRedo} aria-label={t('Redo')}>
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 14 5-5-5-5" />
                  <path d="M20 9H10a6 6 0 0 0 0 12h2" />
                </svg>
              </button>
              <span className="history-action-tooltip" role="tooltip">{t('Redo')}</span>
            </span>
          </div>
        </div>


        {mode !== 'new' && <div className="segmented-control" role="group" aria-label={t('Mode')}>
          {EDIT_OR_PREVIEW_OPTIONS.map((opt) => <button key={opt.value} className={mode === opt.value ? 'active' : ''} onClick={() => onSwitchMode(opt.value)}>{t(opt.label)}</button>)}
        </div>}
      </SidebarSection>
      {mode === 'new' && <SidebarSection id="new-dome" title={t('New dome')}>
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
        <div className="button-row"><button onClick={onCreateNew}>{t('Create')}</button><button onClick={onCancelNew}>{t('Cancel')}</button></div>
      </SidebarSection>}
      {mode === 'edit' && <SidebarSection id="edit" title={t('Edit')}>
        {mode === 'edit' && (
          <section className="control-group">
            <h2>{t('Part type')}</h2>
            <div className="segmented-control" role="group" aria-label={t('Part type')}>
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

        {mode === 'edit' && editTarget === 'vertices' && (
          <section className="control-group">
            <h2>{t('Selection mode')}</h2>
            <div className="segmented-control selection-mode-control" role="group" aria-label={t('Selection mode')}>
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
            <div className="button-row">
              <button disabled={!canAddPoints} onClick={onAddPoints}>
                {t('Add Points')}
              </button>
            </div>
            {selectedCount > 0 && !canAddPoints && (
              <Help text={t('Select an even number of points to pair them up.')} />
            )}
            <div className="button-row">
              <button disabled={!canAddPoints} onClick={onConnectVertices}>
                {t('Connect Vertices')}
              </button>
            </div>
            <Help text={t(
              "Connect Vertices pairs them by nearest neighbor and joins each pair with a direct edge, skipping any pair that's already connected.",
            )} />
            <div className="button-row">
              <button disabled={selectedCount === 0} onClick={onDeleteSelected}>
                {t('Delete')}
              </button>
            </div>
          </section>
        )}

        {mode === 'edit' && editTarget === 'edges' && (
          <section className="control-group">
            <h2>{t('Selection mode')}</h2>
            <div className="segmented-control selection-mode-control" role="group" aria-label={t('Selection mode')}>
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
            <div className="button-row">
              <button disabled={selectedEdgeCount === 0} onClick={onDeleteSelectedEdges}>
                {t('Delete')}
              </button>
            </div>
            <Help text={t(
              'Also removes any face that had it as a side, and any vertex it leaves with no other edge.',
            )} />
            <div className="button-row">
              <button disabled={!canCreateFace} onClick={onCreateFace}>
                {t('Create Face')}
              </button>
            </div>
            <Help text={t('Turns every triangle hiding among the selected edges into a face.')} />
            <div className="button-row">
              <button disabled={!canAddBrace} onClick={onAddBrace}>
                {t('Add Brace')}
              </button>
            </div>
            <Help text={t(
              'Select exactly two edges that meet at the same vertex (use Point selection mode) to link them with a brace.',
            )} />
          </section>
        )}

        {mode === 'edit' && editTarget === 'edges' && selectedEdgeCount > 0 && (
          <section className="control-group">
            <h2>{t('Edge Thickness')}</h2>
            <div className="transform-field">
              <label><FieldLabel text={t('Thickness override (mm)')} /> <Help text={t('0 uses the global default thickness set in Preview.')} /></label>
              <NumberField
                value={edgeThicknessValue}
                step={5}
                min={0}
                placeholder={edgeThicknessValue === null ? t('Mixed') : undefined}
                clamp={(n) => Math.max(n, 0)}
                onCommit={onEdgeThicknessChange}
              />
            </div>
            <div className="button-row">
              <button disabled={!hasEdgeOverrides} onClick={onResetEdgeThickness}>
                {t('Reset Thickness')}
              </button>
            </div>
          </section>
        )}

        {mode === 'edit' && editTarget === 'faces' && (
          <section className="control-group">
            <h2>{t('Selection mode')}</h2>
            <div className="segmented-control selection-mode-control" role="group" aria-label={t('Selection mode')}>
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
            {selectedBraceCount === 0 && <p className="hint">{t('Click a brace to select it. Add braces from two edges in the Edges tab.')}</p>}
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
                <label><FieldLabel text={t(label)} /></label>
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
            <Help text={t(
              'Shift is where the brace meets each edge, measured from their shared vertex. The plate settings after the first two aren’t used yet.',
            )} />
          </section>
        )}

        {mode === 'edit' && editTarget === 'vertices' && selectedCount > 0 && (
          <section className="control-group">
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={allSelectedAreFeet}
                ref={(el) => {
                  if (el) el.indeterminate = someSelectedAreFeet
                }}
                onChange={(e) => onFootVertexToggle(e.target.checked)}
              />
              {t('Foot geometry')}
            </label>
            <Help text={t(
              'Marks the selected vertices as feet: their flange is built with the dimensions from the Foot section. Foot vertices are shown in purple.',
            )} />
          </section>
        )}

        {mode === 'edit' && editTarget === 'vertices' && selectedCount > 0 && (
          <SidebarSection id="edit-vertex-transform" title={t('Transform')} defaultOpen={false}>
          <section className="control-group">
            <div className="transform-field">
              <label><FieldLabel text={t('Radius (Δr, mm)')} /></label>
              <NumberField
                value={rValue}
                step={10}
                placeholder={rValue === null ? t('Mixed') : undefined}
                onCommit={(v) => onTransformChange('r', v)}
              />
            </div>
            <div className="transform-field">
              <label><FieldLabel text={t('Azimuth (Δ°)')} /></label>
              <NumberField
                value={azimuthValue === null ? null : Math.round(((azimuthValue * 180) / Math.PI) * 100) / 100}
                step={1}
                placeholder={azimuthValue === null ? t('Mixed') : undefined}
                onCommit={(deg) => onTransformChange('azimuth', (deg * Math.PI) / 180)}
              />
            </div>
            <div className="transform-field">
              <label><FieldLabel text={t('Elevation (Δ°)')} /></label>
              <NumberField
                value={elevationValue === null ? null : Math.round(((elevationValue * 180) / Math.PI) * 100) / 100}
                step={1}
                placeholder={elevationValue === null ? t('Mixed') : undefined}
                onCommit={(deg) => onTransformChange('elevation', (deg * Math.PI) / 180)}
              />
            </div>
            <Help text={t('Polar offsets from the default position, about the dome center. Radius moves the vertex toward/away from the center; azimuth rotates it around the vertical axis; elevation tilts it up/down along its meridian.')} />
            <div className="button-row">
              <button disabled={selectedCount < 2} onClick={onAlignHorizontally}>
                {t('Align horizontally')}
              </button>
              <button disabled={selectedCount < 2} onClick={onAlignVertically}>
                {t('Align vertically')}
              </button>
              <button disabled={!hasTransforms} onClick={onResetTransform}>
                {t('Reset Transform')}
              </button>
            </div>
          </section>
          </SidebarSection>
        )}

        {mode === 'edit' && editTarget === 'vertices' && selectedCount > 0 && (
          <SidebarSection id="edit-vertex-corner-flange" title={t('Overrides')} defaultOpen={false}>
          <section className="control-group">
            <div className="transform-field">
              <label><FieldLabel text={t('Corner length (mm)')} /> <Help text={t(
                'Applies to every strut end and flange at the selected vertices. 0 uses the global corner length set in Edge Curvature.',
              )} /></label>
              <span className="field-with-reset">
                <NumberField
                  value={vertexCornerLengthValue === 0 ? null : vertexCornerLengthValue}
                  step={5}
                  min={0}
                  placeholder={vertexCornerLengthValue === null ? t('Mixed')
                    : vertexCornerLengthValue === 0 ? t('{value} (default)', { value: cornerLength }) : undefined}
                  clamp={(n) => Math.max(n, 0)}
                  onCommit={onVertexCornerLengthChange}
                />
                <button className="reset-field" title={t('Use the global value')}
                  disabled={!hasVertexCornerLengthOverrides} onClick={onResetVertexCornerLength}>
                  &times;
                </button>
              </span>
            </div>
          </section>
          <section className="control-group">
            <h2>{t('Flange')}</h2>
            {FLANGE_PARAM_FIELDS.map(({ key, label }) => {
              const shared = sharedFlangeOverride(selectedVertexIndices, vertexFlangeParams, key)
              return (
                <div className="transform-field" key={key}>
                  <label><FieldLabel text={t(label)} /></label>
                  <span className="field-with-reset">
                    <NumberField
                      value={shared.value}
                      step={1}
                      min={key.startsWith('tolerance') ? undefined : 0}
                      placeholder={shared.mixed ? t('Mixed') : t('{value} (default)', { value: flangeDefaults[key] })}
                      clamp={key.startsWith('tolerance') ? undefined : (n) => Math.max(n, 0)}
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
            <Help text={t(
              "Overrides the Flange section's values for the flange at the selected vertices only. A blank field uses the global value (shown in grey); × goes back to it. Overridden vertices are shown in cyan.",
            )} />
          </section>
          <div className="button-row">
            <button disabled={!hasVertexCornerLengthOverrides && !hasVertexFlangeOverrides} onClick={onResetAllVertexOverrides}>
              {t('Reset all overrides')}
            </button>
          </div>
          </SidebarSection>
        )}

      </SidebarSection>}
      {mode === 'preview' && <SidebarSection id="preview" title={t('Preview')}>
        <div className="button-row">
          <button onClick={onApplyPreview} disabled={!previewParamsDirty}>{t('Redraw')}</button>
        </div>
        {previewParamsDirty && <p className="hint" role="status">{t('Unapplied geometry changes')}</p>}
        <Help text={t('Geometry changes take effect when you click Redraw.')} />
        <SidebarSection id="preview-parts-visibility" title={t('Parts visibility')} defaultOpen={false}>
          {PREVIEW_PART_KINDS.map(({ kind, label }) => <label className="checkbox-field" key={kind}>
            <input type="checkbox" checked={partVisibility[kind]} onChange={(e) => onPartVisibilityChange(kind, e.target.checked)} />{t(label)}
          </label>)}
        </SidebarSection>
      </SidebarSection>}
      {mode !== 'new' && <SidebarSection id="dome-geometry" title={t('Dome geometry')}>
        <SidebarSection id="geometry-general" title={t('General')} defaultOpen={false}>
          <section className="control-group">

            <div className="transform-field">
              <label><FieldLabel text={t('Sphere diameter (mm)')} /></label>
              <NumberField value={diameter} step={100} min={1} onCommit={onDiameterChange} />
            </div>
            <Help text={t('Resizes the whole dome around its center, keeping its shape.')} />
            <div className="transform-field">
              <label><FieldLabel text={t('Tolerance longitudinal (mm)')} /> <Help text={t('Tolerance applies wherever a tab fits into a hole. Positive values add clearance for a looser fit; negative values reduce clearance for a tighter fit.')} /></label>
              <NumberField value={toleranceLongitudinal} step={1} onCommit={onToleranceLongitudinalChange} />
            </div>
            <div className="transform-field">
              <label><FieldLabel text={t('Tolerance transverse (mm)')} /> <Help text={t('Tolerance applies wherever a tab fits into a hole. Positive values add clearance for a looser fit; negative values reduce clearance for a tighter fit.')} /></label>
              <NumberField value={toleranceTransverse} step={1} onCommit={onToleranceTransverseChange} />
            </div>
          </section>
        </SidebarSection>
        <>
          <SidebarSection id="geometry-struts" title={t('Struts')} defaultOpen={false}>
            {(mode === 'preview' || mode === 'edit') && (
              <section className="control-group">
                <div className="transform-field">
                  <label><FieldLabel text={t('Corner length (D, mm)')} /> <Help text={t(
                    "Corner length (D): straight lead-in at each end, tangent to the sphere and angled toward the other end - trimmed back from the vertex by that hub's own minimum offset (shown when a single vertex is selected in Edit mode), up to this budget. Meeting lead-ins form a sharp point; otherwise the gap between them is bridged by an arc centered on the sphere center.",
                  )} /></label>
                  <NumberField value={cornerLength} step={5} min={0} onCommit={onCornerLengthChange} />
                </div>
                <div className="transform-field">
                  <label><FieldLabel text={t('Offset modifier (mm)')} /> <Help text={t(
                    "Offset modifier: added to every edge end's own minimum offset before it's trimmed back from the vertex (still capped by the corner length budget). Positive pulls every strut end further in; negative pushes it back out, toward the vertex.",
                  )} /></label>
                  <NumberField value={offsetModifier} step={5} onCommit={onOffsetModifierChange} />
                </div>
                <div className="transform-field">
                  <label><FieldLabel text={t('Width (mm)')} /> <Help text={t(
                    "Width: extrudes each arc symmetrically toward/away from the sphere's center.",
                  )} /></label>
                  <NumberField value={extrudeDistance} step={5} min={0} onCommit={onExtrudeDistanceChange} />
                </div>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={roundStrutBridge}
                    onChange={(e) => onRoundStrutBridgeChange(e.target.checked)}
                  />
                  {t('Round bridge')}
                </label>
                <div className="transform-field">
                  <label><FieldLabel text={t('Thickness (mm)')} /> <Help text={t(
                    'Thickness: extrudes that ribbon symmetrically along its own surface normal, turning it into a solid beam.',
                  )} /></label>
                  <NumberField value={thickness} step={5} min={0} onCommit={onThicknessChange} />
                </div>
              </section>
            )}
            {(mode === 'preview' || mode === 'edit') && (
              <section className="control-group">
                <div className="transform-field">
                  <label><FieldLabel text={t('End groove length (%)')} /> <Help text={t(
                    "Each strut end forms a shouldered tenon: the end and mid groove percentages split the workable length (past the offset) into the shoulder, tenon, and far shoulder, cut back by groove depth. Chamfer length bevels the tenon's top corners; milling diameter sets a relief circle tucked into each of its concave base corners, clearing room for a square mating part to seat flush against a round cutting bit.",
                  )} /></label>
                  <NumberField
                    value={endGrooveLengthPercent}
                    step={5}
                    min={0}
                    onCommit={onEndGrooveLengthPercentChange}
                  />
                </div>
                <div className="transform-field">
                  <label><FieldLabel text={t('Mid groove length (%)')} /></label>
                  <NumberField
                    value={midGrooveLengthPercent}
                    step={5}
                    min={0}
                    onCommit={onMidGrooveLengthPercentChange}
                  />
                </div>
                <div className="transform-field">
                  <label><FieldLabel text={t('Groove depth (mm)')} /></label>
                  <NumberField value={grooveDepth} step={1} min={0} onCommit={onGrooveDepthChange} />
                </div>
                <div className="transform-field">
                  <label><FieldLabel text={t('Milling diameter (mm)')} /></label>
                  <NumberField value={millingDiameter} step={1} min={0} onCommit={onMillingDiameterChange} />
                </div>
                <div className="transform-field">
                  <label><FieldLabel text={t('Chamfer length (mm)')} /></label>
                  <NumberField value={chamferLength} step={1} min={0} onCommit={onChamferLengthChange} />
                </div>
              </section>
            )}
          </SidebarSection>
          <SidebarSection id="geometry-flanges" title={t('Flanges')} defaultOpen={false}>
            {(mode === 'preview' || mode === 'edit') && (
              <section className="control-group">
                <div className="transform-field">
                  <label><FieldLabel text={t('Center hole diameter (mm)')} /> <Help text={t(
                    "The flat connector plate pair at each hub vertex fills the wedges between struts that have no face of their own. Overshoot and min side set how far the plate reaches past a strut's corner and how narrow it may get; the side and center holes define its bolt pattern.",
                  )} /></label>
                  <NumberField
                    value={centerHoleDiameter}
                    step={1}
                    min={0}
                    onCommit={onCenterHoleDiameterChange}
                  />
                </div>
                <div className="transform-field">
                  <label><FieldLabel text={t('Side hole diameter outer (mm)')} /></label>
                  <NumberField
                    value={sideHoleDiameterOuter}
                    step={1}
                    min={0}
                    onCommit={onSideHoleDiameterOuterChange}
                  />
                </div>
                <div className="transform-field">
                  <label><FieldLabel text={t('Side hole diameter inner (mm)')} /></label>
                  <NumberField
                    value={sideHoleDiameterInner}
                    step={1}
                    min={0}
                    onCommit={onSideHoleDiameterInnerChange}
                  />
                </div>
                <div className="transform-field">
                  <label><FieldLabel text={t('Side hole diameter offset (mm)')} /></label>
                  <NumberField
                    value={sideHoleDiameterOffset}
                    step={1}
                    min={0}
                    onCommit={onSideHoleDiameterOffsetChange}
                  />
                </div>
                <div className="transform-field">
                  <label><FieldLabel text={t('Overshoot (mm)')} /></label>
                  <NumberField value={overshoot} step={1} min={0} onCommit={onOvershootChange} />
                </div>
                <div className="transform-field">
                  <label><FieldLabel text={t('Min side (mm)')} /></label>
                  <NumberField value={minSide} step={1} min={0} onCommit={onMinSideChange} />
                </div>
                <div className="transform-field">
                  <label><FieldLabel text={t('Flange milling diameter (mm)')} /></label>
                  <NumberField
                    value={flangeMillingDiameter}
                    step={1}
                    min={0}
                    onCommit={onFlangeMillingDiameterChange}
                  />
                </div>
              </section>
            )}
          </SidebarSection>
          <SidebarSection id="geometry-foot" title={t('Foot')} defaultOpen={false}>
            {(mode === 'preview' || mode === 'edit') && (
              <section className="control-group">
                {FOOT_PARAM_FIELDS.map(({ key, label }) => (
                  <div className="transform-field" key={key}>
                    <label><FieldLabel text={t(label)} /></label>
                    <NumberField
                      value={footParams[key]}
                      step={1}
                      min={0}
                      clamp={(n) => Math.max(n, 0)}
                      onCommit={(v) => onFootParamChange(key, v)}
                    />
                  </div>
                ))}
                <Help text={t(
                  'The same for every vertex marked as a foot (Edit → Vertices → Foot geometry checkbox), applied to the preview with Redraw.',
                )} />
              </section>
            )}
          </SidebarSection>
          <SidebarSection id="geometry-braces" title={t('Braces')} defaultOpen={false}>
            {(mode === 'preview' || mode === 'edit') && (
              <section className="control-group">
                {BRACE_PLATE_PARAM_FIELDS.map(({ key, label, step }) => (
                  <div className="transform-field" key={key}>
                    <label><FieldLabel text={t(label)} /></label>
                    <NumberField
                      value={bracePlateDraft[key]}
                      step={step}
                      min={0}
                      clamp={(n) => sanitizeBraceParam(key, n)}
                      onCommit={(value) => onBracePlateParamChange(key, value)}
                    />
                  </div>
                ))}
                <Help text={t(
                  'The same for every brace, and applied to all of them with Redraw (new braces start with these too). Where a brace sits (shift) is set per brace in Edit → Braces. The plate is extruded out from the strut’s side face, toward the brace’s other edge.',
                )} />
              </section>
            )}
          </SidebarSection>
        </>
      </SidebarSection>}
      {mode !== 'new' && <SidebarSection id="export" title={t('Export')}>
        <SidebarSection id="export-dxf" title={t('DXF')} defaultOpen={false}>
          <div className="transform-field">
            <label><FieldLabel text={t('Part ID label size (mm)')} /></label>
            <NumberField value={partIdLabelSize} step={0.5} min={0.1} onCommit={onPartIdLabelSizeChange} />
          </div>
          <div className="transform-field">
            <label><FieldLabel text={t('Connected part ID labels size (mm)')} /></label>
            <NumberField value={connectedPartIdLabelSize} step={0.5} min={0.1} onCommit={onConnectedPartIdLabelSizeChange} />
          </div>
          <label className="checkbox-field">
            <input type="checkbox" checked={dxfSheetSettings.arrangeOnSheet} disabled={exportBusy}
              onChange={(event) => onDxfSheetSettingsChange({ ...dxfSheetSettings, arrangeOnSheet: event.target.checked })} />
            {t('Arrange on a sheet')}
          </label>
          {dxfSheetSettings.arrangeOnSheet && <fieldset className="dxf-sheet-settings" disabled={exportBusy}>
            {([
              ['width', 'Sheet width (mm)', 1],
              ['height', 'Sheet height (mm)', 1],
              ['margin', 'Margin (mm)', 0],
              ['spacing', 'Spacing (mm)', 0],
            ] as const).map(([key, label, min]) => <div className="transform-field" key={key}>
              <label htmlFor={`dxf-sheet-${key}`}><FieldLabel text={t(label)} /></label>
              <input id={`dxf-sheet-${key}`} type="number" min={min} step="any" value={Number.isNaN(dxfSheetSettings[key]) ? '' : dxfSheetSettings[key]}
                onChange={(event) => onDxfSheetSettingsChange({ ...dxfSheetSettings, [key]: event.target.valueAsNumber })} />
            </div>)}
            <Help text={t('Dimensions are in exported millimeters. Margin is measured from the sheet border; spacing is the minimum gap between parts. Parts may rotate by 90°.')} />
          </fieldset>}
          <div className="button-row">
            <button onClick={onDownloadDxf} disabled={exportBusy}>{t('Download DXF')}</button>
          </div>
          <Help text={dxfSheetSettings.arrangeOnSheet
            ? t('The DXF arranges all parts across as many sheets as needed. Blue borders are on the SHEETS layer. Red and green labels stay with their parts.')
            : t('The DXF puts the flat outlines of all those parts on one sheet (same scale), each labeled with its numeric part ID in red. Green labels show matching numeric part IDs where parts connect.')} />

        </SidebarSection>
        <SidebarSection id="export-step-parts" title={t('STEP parts')} defaultOpen={false}>
          <label className="checkbox-field">
            <input type="checkbox" checked={stepExportSettings.addLabels} disabled={exportBusy}
              onChange={(event) => onStepExportSettingsChange({ ...stepExportSettings, addLabels: event.target.checked })} />
            {t('Add labels')}
          </label>
          {stepExportSettings.addLabels && <fieldset className="dxf-sheet-settings" disabled={exportBusy}>
            <div className="transform-field">
              <label><FieldLabel text={t('Part ID label size (mm)')} /></label>
              <NumberField value={stepExportSettings.partIdLabelSize} step={0.5} min={0.1}
                onCommit={(partIdLabelSize) => onStepExportSettingsChange({ ...stepExportSettings, partIdLabelSize })} />
            </div>
            <div className="transform-field">
              <label><FieldLabel text={t('Connected part ID labels size (mm)')} /></label>
              <NumberField value={stepExportSettings.connectedPartIdLabelSize} step={0.5} min={0.1}
                onCommit={(connectedPartIdLabelSize) => onStepExportSettingsChange({ ...stepExportSettings, connectedPartIdLabelSize })} />
            </div>
            <div className="transform-field">
              <label htmlFor="step-label-depth"><FieldLabel text={t('Depth (mm)')} /></label>
              <input id="step-label-depth" type="number" min={0.01} step="any"
                value={Number.isNaN(stepExportSettings.depth) ? '' : stepExportSettings.depth}
                onChange={(event) => onStepExportSettingsChange({ ...stepExportSettings, depth: event.target.valueAsNumber })} />
            </div>
            <Help text={t('Engraves bold part and connection labels. Depth is measured in exported millimeters.')} />
          </fieldset>}
          <Help text={t('Parts lie flat with their bottom at Z = 0 and labels facing up.')} />
          <div className="button-row"><button onClick={onDownloadSteps} disabled={exportBusy}>{t('Download STEP Archive')}</button></div>
        </SidebarSection>
        <SidebarSection id="export-step-assembly" title={t('STEP assembly')} defaultOpen={false}>
          <div className="button-row"><button onClick={onDownloadStepAssembly} disabled={exportBusy}>{t('Download STEP Assembly')}</button></div>
        </SidebarSection>
      </SidebarSection>}
    </aside>
  )
}
