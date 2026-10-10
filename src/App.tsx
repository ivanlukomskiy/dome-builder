import { ShellWorkspace, type ShellWorkspaceActions } from './components/ShellWorkspace'
import { DEFAULT_STEP_EXPORT_SETTINGS } from './lib/stepExportSettings'
import { DEFAULT_DXF_LABEL_SETTINGS } from './lib/dxfLabelSettings'
import { DEFAULT_DXF_SHEET_SETTINGS } from './lib/dxfSheetSettings'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AxisType, Edge, Face, SelectionMode, ShapeType, VertexTransform } from './lib/polyhedra'
import {
  addFaces,
  addMidpointsBetween,
  applyVertexTransforms,
  alignVerticesVertically,
  computePolyhedron,
  connectVertexPairs,
  DEFAULT_DIAMETER_MM,
  DEFAULT_VERTEX_TRANSFORM,
  deleteEdges,
  deleteFaces,
  deleteVertices,
  edgeMidpoint,
  faceCentroid,
  findEdgeTriangles,
  findLayerGroup,
  findRotationalSymmetryGroup,
  isDefaultVertexTransform,
  pruneToLayerCount,
  scaleSceneDiameter,
  SHAPE_AXES,
} from './lib/polyhedra'
import {
  addBrace,
  applyBracePlateParams,
  BRACE_PARAM_FIELDS,
  bracePlateParamsDiffer,
  deleteBraces,
  firstBracePlateParams,
  resolveBracePair,
  sanitizeBraceParam,
  setBraceParam,
  type BraceParams,
  type BracePlateParams,
} from './lib/braces'
import { Sidebar } from './components/Sidebar'
import { ExportProgressModal, type ExportKind, type ExportSession } from './components/ExportProgressModal'
import { Viewport } from './components/Viewport'
import type { DomeConfig, DomeState } from './lib/config'
import {
  deserializeConfig,
  downloadConfigAsJson,
  loadInitialState,
  readConfigFromFile,
  saveConfigToLocalStorage,
  serializeConfig,
} from './lib/config'
import { downloadBlob } from './lib/download'
import {
  DEFAULT_FLANGE_SHAPE_PARAMS,
  DEFAULT_FOOT_PARAMS,
  footParamsEqual,
  type FlangeShapeParams,
  type FootParams,
} from './lib/flangeGeometry'
import { runStepAssemblyExport, runStepDebugExport, runStepExport, type RunStepExportParams, type StepDebugPartKind, type StepExportProgress } from './lib/stepExportRunner'
import { runDxfExport, type DxfExportProgress } from './lib/dxfExportRunner'
import { useHistory } from './lib/useHistory'
import {
  DEFAULT_PART_VISIBILITY,
  type PartVisibility,
  type PreviewPartKind,
} from './lib/previewParts'

export type ViewMode = 'new' | 'edit' | 'preview' | 'shell'
export type EditOrPreviewMode = 'edit' | 'preview' | 'shell'
export type EditTarget = 'vertices' | 'edges' | 'faces' | 'braces'

// The strut-shape fields in the Sidebar's "Edge Curvature" and "Grooves" sections - the only
// preview settings, since rebuilding every strut solid via replicad/opencascade.js is slow.
// Kept separate from the live (draft) state below: the Viewport only ever sees this applied
// snapshot, so editing these fields doesn't retrigger that rebuild until Redraw is clicked.
export interface PreviewShapeParams {
  extrudeDistance: number
  thickness: number
  cornerLength: number
  offsetModifier: number
  endGrooveLengthPercent: number
  midGrooveLengthPercent: number
  grooveDepth: number
  millingDiameter: number
  chamferLength: number
  shellEnabled: boolean
  shellThickness: number
  roundStrutBridge: boolean
  toleranceLongitudinal: number
  toleranceTransverse: number
  centerHoleDiameter: number
  sideHoleDiameterOuter: number
  sideHoleDiameterInner: number
  sideHoleDiameterOffset: number
  overshoot: number
  minSide: number
  flangeMillingDiameter: number
  footParams: FootParams
}

// Shared by both vertex and edge selection: toggles a whole group (an individual pick, a
// layer, or a symmetric orbit) on or off together, based on whether it was already fully
// selected.
function toggleGroupSelection(prev: ReadonlySet<number>, group: number[]): Set<number> {
  const next = new Set(prev)
  const allSelected = group.every((i) => next.has(i))
  for (const i of group) {
    if (allSelected) next.delete(i)
    else next.add(i)
  }
  return next
}

const DEFAULT_SHAPE: ShapeType = 'octahedron'
const DEFAULT_AXIS: AxisType = 'vertex'
const DEFAULT_SUBDIVISIONS = 3
const DEFAULT_SHAPE_DATA = computePolyhedron(
  DEFAULT_SHAPE,
  DEFAULT_AXIS,
  DEFAULT_SUBDIVISIONS,
  DEFAULT_DIAMETER_MM,
)
const DEFAULT_LAYER_COUNT = Math.ceil(DEFAULT_SHAPE_DATA.layers.length / 2)
const DEFAULT_SCENE_DATA = pruneToLayerCount(DEFAULT_SHAPE_DATA, DEFAULT_LAYER_COUNT)

const DEFAULT_EXTRUDE_DISTANCE = 125
const DEFAULT_THICKNESS = 30
const DEFAULT_CORNER_LENGTH = 200
const DEFAULT_OFFSET_MODIFIER = 0
// See the "Grooves" section in Sidebar and computeStrutBoundary's shoulder/tenon params.
const DEFAULT_END_GROOVE_LENGTH_PERCENT = 15
const DEFAULT_MID_GROOVE_LENGTH_PERCENT = 15
const DEFAULT_GROOVE_DEPTH = 30
const DEFAULT_MILLING_DIAMETER = 5
const DEFAULT_CHAMFER_LENGTH = 6
const DEFAULT_ROUND_STRUT_BRIDGE = true

const EMPTY_INDEX_SET: ReadonlySet<number> = new Set()
const EMPTY_VERTEX_TRANSFORMS: ReadonlyMap<number, VertexTransform> = new Map()
const EMPTY_EDGE_THICKNESS: ReadonlyMap<number, number> = new Map()
const EMPTY_VERTEX_CORNER_LENGTH: ReadonlyMap<number, number> = new Map()
const EMPTY_VERTEX_FLANGE_PARAMS: ReadonlyMap<number, Partial<FlangeShapeParams>> = new Map()

type DomeDocument = Omit<DomeState, 'selectionMode'> & {
  previewDiameterDraft: number | null
  bracePlateDraft: BracePlateParams
  appliedPreviewParams: PreviewShapeParams
}

function previewParamsFrom(state: Omit<DomeState, 'selectionMode'>): PreviewShapeParams {
  const {
    extrudeDistance, thickness, cornerLength, offsetModifier, endGrooveLengthPercent,
    midGrooveLengthPercent, grooveDepth, millingDiameter, chamferLength, roundStrutBridge, shellEnabled, shellThickness,
    toleranceLongitudinal, toleranceTransverse, centerHoleDiameter, sideHoleDiameterOuter,
    sideHoleDiameterInner, sideHoleDiameterOffset, overshoot, minSide,
    flangeMillingDiameter, footParams,
  } = state
  return {
    extrudeDistance, thickness, cornerLength, offsetModifier, endGrooveLengthPercent,
    midGrooveLengthPercent, grooveDepth, millingDiameter, chamferLength, roundStrutBridge, shellEnabled, shellThickness,
    toleranceLongitudinal, toleranceTransverse, centerHoleDiameter, sideHoleDiameterOuter,
    sideHoleDiameterInner, sideHoleDiameterOffset, overshoot, minSide,
    flangeMillingDiameter, footParams,
  }
}

function createDocument(initial: DomeState | null, sceneData = initial?.sceneData ?? DEFAULT_SCENE_DATA): DomeDocument {
  const state: Omit<DomeState, 'selectionMode'> = {
    partIdLabelSize: initial?.partIdLabelSize ?? DEFAULT_DXF_LABEL_SETTINGS.partIdLabelSize,
    connectedPartIdLabelSize: initial?.connectedPartIdLabelSize ?? DEFAULT_DXF_LABEL_SETTINGS.connectedPartIdLabelSize,
    stepExportSettings: initial?.stepExportSettings ?? DEFAULT_STEP_EXPORT_SETTINGS,
    dxfSheetSettings: initial?.dxfSheetSettings ?? DEFAULT_DXF_SHEET_SETTINGS,
    sceneData,
    extrudeDistance: initial?.extrudeDistance ?? DEFAULT_EXTRUDE_DISTANCE,
    thickness: initial?.thickness ?? DEFAULT_THICKNESS,
    cornerLength: initial?.cornerLength ?? DEFAULT_CORNER_LENGTH,
    offsetModifier: initial?.offsetModifier ?? DEFAULT_OFFSET_MODIFIER,
    endGrooveLengthPercent: initial?.endGrooveLengthPercent ?? DEFAULT_END_GROOVE_LENGTH_PERCENT,
    midGrooveLengthPercent: initial?.midGrooveLengthPercent ?? DEFAULT_MID_GROOVE_LENGTH_PERCENT,
    grooveDepth: initial?.grooveDepth ?? DEFAULT_GROOVE_DEPTH,
    millingDiameter: initial?.millingDiameter ?? DEFAULT_MILLING_DIAMETER,
    chamferLength: initial?.chamferLength ?? DEFAULT_CHAMFER_LENGTH,
    shellEnabled: initial?.shellEnabled ?? false,
    shellThickness: initial?.shellThickness ?? 2,
    shellStitches: new Set(initial?.shellStitches ?? []),
    shellLayout: new Map(initial?.shellLayout ?? []),
    roundStrutBridge: initial?.roundStrutBridge ?? DEFAULT_ROUND_STRUT_BRIDGE,
    toleranceLongitudinal: initial?.toleranceLongitudinal ?? DEFAULT_FLANGE_SHAPE_PARAMS.toleranceLongitudinal,
    toleranceTransverse: initial?.toleranceTransverse ?? DEFAULT_FLANGE_SHAPE_PARAMS.toleranceTransverse,
    centerHoleDiameter: initial?.centerHoleDiameter ?? DEFAULT_FLANGE_SHAPE_PARAMS.centerHoleDiameter,
    sideHoleDiameterOuter: initial?.sideHoleDiameterOuter ?? DEFAULT_FLANGE_SHAPE_PARAMS.sideHoleDiameterOuter,
    sideHoleDiameterInner: initial?.sideHoleDiameterInner ?? DEFAULT_FLANGE_SHAPE_PARAMS.sideHoleDiameterInner,
    sideHoleDiameterOffset: initial?.sideHoleDiameterOffset ?? DEFAULT_FLANGE_SHAPE_PARAMS.sideHoleDiameterOffset,
    overshoot: initial?.overshoot ?? DEFAULT_FLANGE_SHAPE_PARAMS.overshoot,
    minSide: initial?.minSide ?? DEFAULT_FLANGE_SHAPE_PARAMS.minSide,
    flangeMillingDiameter: initial?.flangeMillingDiameter ?? DEFAULT_FLANGE_SHAPE_PARAMS.millingDiameter,
    footParams: initial?.footParams ?? DEFAULT_FOOT_PARAMS,
    vertexTransforms: new Map(initial?.vertexTransforms ?? []),
    edgeThickness: new Map(initial?.edgeThickness ?? []),
    vertexCornerLength: new Map(initial?.vertexCornerLength ?? []),
    vertexFlangeParams: new Map(initial?.vertexFlangeParams ?? []),
    footVertices: new Set(initial?.footVertices ?? []),
  }
  return {
    ...state,
    previewDiameterDraft: null,
    bracePlateDraft: firstBracePlateParams(sceneData.braces),
    appliedPreviewParams: previewParamsFrom(state),
  }
}

function activeNumericField(): HTMLInputElement | null {
  const active = globalThis.document.activeElement
  return active instanceof HTMLInputElement && (active.type === 'number' || active.type === 'range') ? active : null
}

function App() {
  // Restored once, on first render, from whatever was auto-saved last time (see the autosave
  // effect below); null if there's nothing saved, in which case every field below falls back
  // to its hardcoded default and the app opens on the "New" tab.
  const [initial] = useState(() => loadInitialState())

  const [mode, setMode] = useState<ViewMode>(initial ? 'edit' : 'new')
  // Where to land after "New" closes (via Create or Cancel) - wherever we were before opening
  // it, defaulting to Edit (e.g. on first-ever launch, which opens straight into "New").
  const [preNewMode, setPreNewMode] = useState<EditOrPreviewMode>('edit')

  // "New" panel: how to generate a shape. Purely a recipe for the live preview below - once a
  // pick is committed (see handleCreateNew), only the resulting vertex/face/edge data matters,
  // so none of this is persisted.
  const [shape, setShape] = useState<ShapeType>(DEFAULT_SHAPE)
  const [axis, setAxis] = useState<AxisType>(DEFAULT_AXIS)
  const [subdivisions, setSubdivisions] = useState(DEFAULT_SUBDIVISIONS)
  // The recipe's own diameter, while choosing a shape in "New"; once a dome exists its size is
  // sceneData.diameter (see below).
  const [newDiameter, setNewDiameter] = useState(initial?.sceneData.diameter ?? DEFAULT_DIAMETER_MM)

  const previewData = useMemo(
    () => computePolyhedron(shape, axis, subdivisions, newDiameter),
    [shape, axis, subdivisions, newDiameter],
  )

  const [layerCount, setLayerCount] = useState(DEFAULT_LAYER_COUNT)

  // What the "New" tab's live 3D preview renders - the exact same pruning function Create uses
  // to bake the committed shape, so "what you see in preview" and "what Create commits" are
  // identical by construction.
  const previewSceneData = useMemo(
    () => pruneToLayerCount(previewData, layerCount),
    [previewData, layerCount],
  )

  // Applies a "New" panel pick and keeps the layer count defaulted to half the resulting
  // layers, same as the shape itself would suggest.
  const setNewShapeParams = (
    nextShape: ShapeType,
    nextAxis: AxisType,
    nextSubdivisions: number,
    nextDiameter: number,
  ) => {
    setShape(nextShape)
    setAxis(nextAxis)
    setSubdivisions(nextSubdivisions)
    setNewDiameter(nextDiameter)
    const next = computePolyhedron(nextShape, nextAxis, nextSubdivisions, nextDiameter)
    setLayerCount(Math.ceil(next.layers.length / 2))
  }
  const handleShapeChange = (s: ShapeType) => setNewShapeParams(s, axis, subdivisions, newDiameter)
  const handleAxisChange = (a: AxisType) => setNewShapeParams(shape, a, subdivisions, newDiameter)
  const handleSubdivisionsChange = (s: number) => setNewShapeParams(shape, axis, s, newDiameter)
  // In "New" the diameter is part of the shape recipe. In Preview, keep a draft until Redraw;
  // editing it in Edit mode still resizes the committed dome as an undoable change.

  const documentHistory = useHistory<DomeDocument>(createDocument(initial), 50)
  const domeDocument = documentHistory.value
  const {
    sceneData,
    previewDiameterDraft,
    bracePlateDraft,
    edgeThickness,
    vertexCornerLength,
    vertexFlangeParams,
    footVertices,
    vertexTransforms,
    extrudeDistance,
    thickness,
    cornerLength,
    offsetModifier,
    endGrooveLengthPercent,
    midGrooveLengthPercent,
    grooveDepth,
    millingDiameter,
    chamferLength,
    roundStrutBridge,
    shellEnabled,
    shellThickness,
    shellLayout,
    shellStitches,
    toleranceLongitudinal,
    toleranceTransverse,
    centerHoleDiameter,
    sideHoleDiameterOuter,
    sideHoleDiameterInner,
    sideHoleDiameterOffset,
    overshoot,
    minSide,
    flangeMillingDiameter,
    footParams,
    appliedPreviewParams,
    partIdLabelSize,
    stepExportSettings,
    dxfSheetSettings,
    connectedPartIdLabelSize,
  } = domeDocument
  const setDocumentField = <K extends keyof DomeDocument>(
    key: K, value: DomeDocument[K] | ((previous: DomeDocument[K]) => DomeDocument[K]),
  ) => {
    documentHistory.commit((previous) => {
      const oldValue = previous[key]
      const nextValue = typeof value === 'function'
        ? (value as (previous: DomeDocument[K]) => DomeDocument[K])(oldValue) : value
      return Object.is(nextValue, oldValue) ? previous : { ...previous, [key]: nextValue }
    }, activeNumericField())
  }
  const setSceneData = (value: DomeDocument['sceneData'] | ((previous: DomeDocument['sceneData']) => DomeDocument['sceneData'])) => setDocumentField('sceneData', value)
  const setPreviewDiameterDraft = (value: DomeDocument['previewDiameterDraft'] | ((previous: DomeDocument['previewDiameterDraft']) => DomeDocument['previewDiameterDraft'])) => setDocumentField('previewDiameterDraft', value)
  const setBracePlateDraft = (value: DomeDocument['bracePlateDraft'] | ((previous: DomeDocument['bracePlateDraft']) => DomeDocument['bracePlateDraft'])) => setDocumentField('bracePlateDraft', value)
  const setEdgeThickness = (value: DomeDocument['edgeThickness'] | ((previous: DomeDocument['edgeThickness']) => DomeDocument['edgeThickness'])) => setDocumentField('edgeThickness', value)
  const setVertexCornerLength = (value: DomeDocument['vertexCornerLength'] | ((previous: DomeDocument['vertexCornerLength']) => DomeDocument['vertexCornerLength'])) => setDocumentField('vertexCornerLength', value)
  const setVertexFlangeParams = (value: DomeDocument['vertexFlangeParams'] | ((previous: DomeDocument['vertexFlangeParams']) => DomeDocument['vertexFlangeParams'])) => setDocumentField('vertexFlangeParams', value)
  const setFootVertices = (value: DomeDocument['footVertices'] | ((previous: DomeDocument['footVertices']) => DomeDocument['footVertices'])) => setDocumentField('footVertices', value)
  const setVertexTransforms = (value: DomeDocument['vertexTransforms'] | ((previous: DomeDocument['vertexTransforms']) => DomeDocument['vertexTransforms'])) => setDocumentField('vertexTransforms', value)
  const setExtrudeDistance = (value: DomeDocument['extrudeDistance'] | ((previous: DomeDocument['extrudeDistance']) => DomeDocument['extrudeDistance'])) => setDocumentField('extrudeDistance', value)
  const setThickness = (value: DomeDocument['thickness'] | ((previous: DomeDocument['thickness']) => DomeDocument['thickness'])) => setDocumentField('thickness', value)
  const setCornerLength = (value: DomeDocument['cornerLength'] | ((previous: DomeDocument['cornerLength']) => DomeDocument['cornerLength'])) => setDocumentField('cornerLength', value)
  const setOffsetModifier = (value: DomeDocument['offsetModifier'] | ((previous: DomeDocument['offsetModifier']) => DomeDocument['offsetModifier'])) => setDocumentField('offsetModifier', value)
  const setEndGrooveLengthPercent = (value: DomeDocument['endGrooveLengthPercent'] | ((previous: DomeDocument['endGrooveLengthPercent']) => DomeDocument['endGrooveLengthPercent'])) => setDocumentField('endGrooveLengthPercent', value)
  const setMidGrooveLengthPercent = (value: DomeDocument['midGrooveLengthPercent'] | ((previous: DomeDocument['midGrooveLengthPercent']) => DomeDocument['midGrooveLengthPercent'])) => setDocumentField('midGrooveLengthPercent', value)
  const setGrooveDepth = (value: DomeDocument['grooveDepth'] | ((previous: DomeDocument['grooveDepth']) => DomeDocument['grooveDepth'])) => setDocumentField('grooveDepth', value)
  const setMillingDiameter = (value: DomeDocument['millingDiameter'] | ((previous: DomeDocument['millingDiameter']) => DomeDocument['millingDiameter'])) => setDocumentField('millingDiameter', value)
  const setChamferLength = (value: DomeDocument['chamferLength'] | ((previous: DomeDocument['chamferLength']) => DomeDocument['chamferLength'])) => setDocumentField('chamferLength', value)
  const shellWorkspaceActions = useRef<ShellWorkspaceActions>(null)
  const setShellThickness = (value: number) => setDocumentField('shellThickness', value)
  const setShellEnabled = (value: boolean) => setDocumentField('shellEnabled', value)
  const setRoundStrutBridge = (value: DomeDocument['roundStrutBridge'] | ((previous: DomeDocument['roundStrutBridge']) => DomeDocument['roundStrutBridge'])) => setDocumentField('roundStrutBridge', value)
  const setToleranceLongitudinal = (value: DomeDocument['toleranceLongitudinal'] | ((previous: DomeDocument['toleranceLongitudinal']) => DomeDocument['toleranceLongitudinal'])) => setDocumentField('toleranceLongitudinal', value)
  const setToleranceTransverse = (value: DomeDocument['toleranceTransverse'] | ((previous: DomeDocument['toleranceTransverse']) => DomeDocument['toleranceTransverse'])) => setDocumentField('toleranceTransverse', value)
  const setCenterHoleDiameter = (value: DomeDocument['centerHoleDiameter'] | ((previous: DomeDocument['centerHoleDiameter']) => DomeDocument['centerHoleDiameter'])) => setDocumentField('centerHoleDiameter', value)
  const setSideHoleDiameterOuter = (value: DomeDocument['sideHoleDiameterOuter'] | ((previous: DomeDocument['sideHoleDiameterOuter']) => DomeDocument['sideHoleDiameterOuter'])) => setDocumentField('sideHoleDiameterOuter', value)
  const setSideHoleDiameterInner = (value: DomeDocument['sideHoleDiameterInner'] | ((previous: DomeDocument['sideHoleDiameterInner']) => DomeDocument['sideHoleDiameterInner'])) => setDocumentField('sideHoleDiameterInner', value)
  const setSideHoleDiameterOffset = (value: DomeDocument['sideHoleDiameterOffset'] | ((previous: DomeDocument['sideHoleDiameterOffset']) => DomeDocument['sideHoleDiameterOffset'])) => setDocumentField('sideHoleDiameterOffset', value)
  const setOvershoot = (value: DomeDocument['overshoot'] | ((previous: DomeDocument['overshoot']) => DomeDocument['overshoot'])) => setDocumentField('overshoot', value)
  const setMinSide = (value: DomeDocument['minSide'] | ((previous: DomeDocument['minSide']) => DomeDocument['minSide'])) => setDocumentField('minSide', value)
  const setFlangeMillingDiameter = (value: DomeDocument['flangeMillingDiameter'] | ((previous: DomeDocument['flangeMillingDiameter']) => DomeDocument['flangeMillingDiameter'])) => setDocumentField('flangeMillingDiameter', value)
  const setFootParams = (value: DomeDocument['footParams'] | ((previous: DomeDocument['footParams']) => DomeDocument['footParams'])) => setDocumentField('footParams', value)
  const setPartIdLabelSize = (value: DomeDocument['partIdLabelSize'] | ((previous: DomeDocument['partIdLabelSize']) => DomeDocument['partIdLabelSize'])) => setDocumentField('partIdLabelSize', value)
  const setStepExportSettings = (value: DomeDocument['stepExportSettings']) => setDocumentField('stepExportSettings', value)
  const setDxfSheetSettings = (value: DomeDocument['dxfSheetSettings'] | ((previous: DomeDocument['dxfSheetSettings']) => DomeDocument['dxfSheetSettings'])) => setDocumentField('dxfSheetSettings', value)
  const setConnectedPartIdLabelSize = (value: DomeDocument['connectedPartIdLabelSize'] | ((previous: DomeDocument['connectedPartIdLabelSize']) => DomeDocument['connectedPartIdLabelSize'])) => setDocumentField('connectedPartIdLabelSize', value)

  const previewDiameterDirty = previewDiameterDraft !== null && previewDiameterDraft !== sceneData.diameter
  const handleDiameterChange = (d: number) => {
    if (!(d > 0)) return
    if (mode === 'new') setNewShapeParams(shape, axis, subdivisions, d)
    else if (mode === 'preview') setPreviewDiameterDraft(d === sceneData.diameter ? null : d)
    else documentHistory.commit((previous) => {
      if (d === previous.sceneData.diameter && previous.previewDiameterDraft === null) return previous
      return {
        ...previous,
        previewDiameterDraft: null,
        sceneData: d === previous.sceneData.diameter ? previous.sceneData : scaleSceneDiameter(previous.sceneData, d),
      }
    }, activeNumericField())
  }

  const [selectionMode, setSelectionMode] = useState<SelectionMode>(initial?.selectionMode ?? 'symmetric')
  const [editTarget, setEditTarget] = useState<EditTarget>('vertices')
  const [selectedVertexIndices, setSelectedVertexIndices] = useState<Set<number>>(new Set())
  const [selectedEdgeIndices, setSelectedEdgeIndices] = useState<Set<number>>(new Set())
  const [selectedFaceIndices, setSelectedFaceIndices] = useState<Set<number>>(new Set())
  const [selectedBraceIndices, setSelectedBraceIndices] = useState<Set<number>>(new Set())

  const draftPreviewParams = previewParamsFrom(domeDocument)
  const previewParamsDirty = (Object.keys(draftPreviewParams) as (keyof PreviewShapeParams)[]).some(
    (key) =>
      key === 'footParams'
        ? !footParamsEqual(draftPreviewParams.footParams, appliedPreviewParams.footParams)
        : draftPreviewParams[key] !== appliedPreviewParams[key],
  )
  const bracePlateDirty = useMemo(
    () => bracePlateParamsDiffer(sceneData, bracePlateDraft),
    [sceneData, bracePlateDraft],
  )
  // View-only, so it lives outside the dome's saved state and the Apply flow: changing it just
  // re-draws the already-built preview.
  const [partVisibility, setPartVisibility] = useState<PartVisibility>(DEFAULT_PART_VISIBILITY)
  const handlePartVisibilityChange = (kind: PreviewPartKind, visible: boolean) =>
    setPartVisibility((prev) => ({ ...prev, [kind]: visible }))
  const handleBracePlateParamChange = (key: keyof BracePlateParams, value: number) =>
    setBracePlateDraft((prev) => ({ ...prev, [key]: sanitizeBraceParam(key, value) }))
  const handleApplyPreview = () => {
    documentHistory.commit((previous) => {
      const nextScene = previous.previewDiameterDraft !== null && previous.previewDiameterDraft !== previous.sceneData.diameter
        ? scaleSceneDiameter(previous.sceneData, previous.previewDiameterDraft)
        : previous.sceneData
      return {
        ...previous,
        sceneData: bracePlateParamsDiffer(nextScene, previous.bracePlateDraft)
          ? applyBracePlateParams(nextScene, previous.bracePlateDraft) : nextScene,
        appliedPreviewParams: previewParamsFrom(previous),
        previewDiameterDraft: null,
      }
    })
  }

  // xyz positions of every vertex: its polar coordinates plus its polar transform diff.
  const transformedVertices = useMemo(
    () => applyVertexTransforms(sceneData.vertices, vertexTransforms),
    [sceneData.vertices, vertexTransforms],
  )
  // The same without any transform - the base positions selection grouping works against.
  const canonicalVertices = useMemo(
    () => applyVertexTransforms(sceneData.vertices, EMPTY_VERTEX_TRANSFORMS),
    [sceneData.vertices],
  )
  const previewVertices = useMemo(
    () => applyVertexTransforms(previewSceneData.vertices, EMPTY_VERTEX_TRANSFORMS),
    [previewSceneData.vertices],
  )

  // The "New" tab's shape/axis choice no longer describes committed geometry after edits, but
  // it's still the best guess we have for the model's rotational symmetry.
  const symmetryFold = () => SHAPE_AXES[shape].find((opt) => opt.value === axis)!.fold

  const handleVertexClick = (index: number) => {
    if (mode !== 'edit' || editTarget !== 'vertices') return

    // Grouping is always done against base (untransformed) positions, so it stays stable
    // regardless of any transform edits.
    const positionOf = (id: number) => canonicalVertices.get(id)!
    const candidateIds = Array.from(canonicalVertices.keys())

    let group: number[]
    if (selectionMode === 'layer') {
      group = findLayerGroup(index, candidateIds, positionOf)
    } else if (selectionMode === 'symmetric') {
      group = findRotationalSymmetryGroup(index, candidateIds, positionOf, symmetryFold())
    } else {
      group = [index]
    }

    setSelectedVertexIndices((prev) => toggleGroupSelection(prev, group))
  }

  const handleEdgeClick = (index: number) => {
    if (mode !== 'edit' || editTarget !== 'edges') return

    const edgeById = (eid: number): Edge => sceneData.edges.get(eid)!
    const positionOf = (vid: number) => canonicalVertices.get(vid)!
    const midpointOf = (eid: number) => edgeMidpoint(edgeById(eid), positionOf)
    const candidateIds = Array.from(sceneData.edges.keys())

    let group: number[]
    if (selectionMode === 'layer') {
      group = findLayerGroup(index, candidateIds, midpointOf)
    } else if (selectionMode === 'symmetric') {
      group = findRotationalSymmetryGroup(index, candidateIds, midpointOf, symmetryFold())
    } else {
      group = [index]
    }

    setSelectedEdgeIndices((prev) => toggleGroupSelection(prev, group))
  }

  const handleFaceClick = (id: number) => {
    if (mode !== 'edit' || editTarget !== 'faces') return

    const faceById = (fid: number): Face => sceneData.faces.get(fid)!
    const positionOf = (vid: number) => canonicalVertices.get(vid)!
    const centroidOf = (fid: number) => faceCentroid(faceById(fid), positionOf)
    const candidateIds = Array.from(sceneData.faces.keys())

    let group: number[]
    if (selectionMode === 'layer') {
      group = findLayerGroup(id, candidateIds, centroidOf)
    } else if (selectionMode === 'symmetric') {
      group = findRotationalSymmetryGroup(id, candidateIds, centroidOf, symmetryFold())
    } else {
      group = [id]
    }

    setSelectedFaceIndices((prev) => toggleGroupSelection(prev, group))
  }

  // Braces are picked one at a time (no layer/symmetric grouping yet).
  const handleBraceClick = (id: number) => {
    if (mode !== 'edit' || editTarget !== 'braces') return
    setSelectedBraceIndices((prev) => toggleGroupSelection(prev, [id]))
  }

  const handleEditTargetChange = (target: EditTarget) => {
    setEditTarget(target)
    setSelectedVertexIndices(new Set())
    setSelectedEdgeIndices(new Set())
    setSelectedFaceIndices(new Set())
    setSelectedBraceIndices(new Set())
  }

  // Undo/redo can remove a brace that's still selected, so only ever hand out ids that exist.
  const liveSelectedBraceIndices = useMemo(
    () => new Set(Array.from(selectedBraceIndices).filter((id) => sceneData.braces.has(id))),
    [selectedBraceIndices, sceneData.braces],
  )

  // Add Brace needs exactly two selected edges that share a vertex and don't already have a
  // brace between them.
  const canAddBrace = useMemo(
    () => mode === 'edit' && editTarget === 'edges' && resolveBracePair(sceneData, selectedEdgeIndices) !== null,
    [mode, editTarget, sceneData, selectedEdgeIndices],
  )

  const handleAddBrace = () => {
    if (!canAddBrace) return
    setSceneData(addBrace(sceneData, selectedEdgeIndices, bracePlateDraft))
    setSelectedEdgeIndices(new Set())
  }

  const handleDeleteSelectedBraces = () => {
    if (liveSelectedBraceIndices.size === 0) return
    setSceneData(deleteBraces(sceneData, liveSelectedBraceIndices))
    setSelectedBraceIndices(new Set())
  }

  // Each brace property's value if all the selected braces share it, else null.
  const braceParamValues = useMemo(() => {
    const values = {} as Record<keyof BraceParams, number | null>
    for (const { key } of BRACE_PARAM_FIELDS) {
      let value: number | null = null
      let first = true
      for (const id of liveSelectedBraceIndices) {
        const v = sceneData.braces.get(id)!.params[key]
        if (first) {
          value = v
          first = false
        } else if (v !== value) {
          value = null
          break
        }
      }
      values[key] = value
    }
    return values
  }, [liveSelectedBraceIndices, sceneData.braces])

  const handleBraceParamChange = (key: keyof BraceParams, value: number) => {
    if (liveSelectedBraceIndices.size === 0) return
    setSceneData(setBraceParam(sceneData, liveSelectedBraceIndices, key, value))
  }

  const handleDeleteSelectedFaces = () => {
    if (selectedFaceIndices.size === 0) return
    setSceneData(deleteFaces(sceneData, selectedFaceIndices))
    setSelectedFaceIndices(new Set())
  }

  // Any triangle hiding among the selected edges becomes a new face - skips any triangle that
  // already exists as a face, to avoid a coincident duplicate.
  const creatableFaces = useMemo(() => {
    if (mode !== 'edit' || editTarget !== 'edges') return []
    const edgeById = (eid: number): Edge => sceneData.edges.get(eid)!
    const triangles = findEdgeTriangles(Array.from(selectedEdgeIndices), edgeById)
    const key = (f: number[]) => [...f].sort((a, b) => a - b).join(',')
    const existing = new Set<string>()
    for (const f of sceneData.faces.values()) {
      if (f.length === 3) existing.add(key(f))
    }
    return triangles.filter((t) => !existing.has(key(t)))
  }, [mode, editTarget, selectedEdgeIndices, sceneData.edges, sceneData.faces])

  const handleCreateFacesFromEdges = () => {
    if (creatableFaces.length === 0) return
    setSceneData(addFaces(sceneData, creatableFaces))
    setSelectedEdgeIndices(new Set())
  }

  // Deleting an edge cascades: any face that had it as one of its own sides can no longer
  // stand, and a vertex it touched that's left with no other surviving edge is a stray point,
  // not worth keeping either (see deleteEdges in polyhedra.ts).
  const handleDeleteSelectedEdges = () => {
    if (selectedEdgeIndices.size === 0) return
    setSceneData(deleteEdges(sceneData, selectedEdgeIndices))
    setSelectedEdgeIndices(new Set())
  }

  const handleEdgeThicknessChange = (value: number) => {
    if (selectedEdgeIndices.size === 0) return
    setEdgeThickness((prev) => {
      const next = new Map(prev)
      for (const idx of selectedEdgeIndices) {
        if (value <= 0) next.delete(idx)
        else next.set(idx, value)
      }
      return next
    })
  }

  const handleResetEdgeThickness = () => {
    if (selectedEdgeIndices.size === 0) return
    setEdgeThickness((prev) => {
      const next = new Map(prev)
      for (const idx of selectedEdgeIndices) next.delete(idx)
      return next
    })
  }

  const handleVertexCornerLengthChange = (value: number) => {
    if (selectedVertexIndices.size === 0) return
    setVertexCornerLength((prev) => {
      const next = new Map(prev)
      for (const idx of selectedVertexIndices) {
        if (value <= 0) next.delete(idx)
        else next.set(idx, value)
      }
      return next
    })
  }

  const handleResetVertexCornerLength = () => {
    if (selectedVertexIndices.size === 0) return
    setVertexCornerLength((prev) => {
      const next = new Map(prev)
      for (const idx of selectedVertexIndices) next.delete(idx)
      return next
    })
  }

  // Sets one flange parameter on every selected vertex; `value` undefined clears it (back to the
  // global one). A vertex left with no overrides at all is dropped from the map entirely.
  const updateSelectedVertexFlangeParam = (key: keyof FlangeShapeParams, value: number | undefined) => {
    if (selectedVertexIndices.size === 0) return
    setVertexFlangeParams((prev) => {
      const next = new Map(prev)
      for (const idx of selectedVertexIndices) {
        const overrides = { ...next.get(idx) }
        if (value === undefined) delete overrides[key]
        else overrides[key] = value
        if (Object.keys(overrides).length === 0) next.delete(idx)
        else next.set(idx, overrides)
      }
      return next
    })
  }

  const handleVertexFlangeParamChange = (key: keyof FlangeShapeParams, value: number) =>
    updateSelectedVertexFlangeParam(key, value)

  const handleResetVertexFlangeParam = (key: keyof FlangeShapeParams) =>
    updateSelectedVertexFlangeParam(key, undefined)

  const handleResetAllVertexOverrides = () => {
    if (selectedVertexIndices.size === 0) return
    documentHistory.commit((previous) => {
      const vertexCornerLength = new Map(previous.vertexCornerLength)
      const vertexFlangeParams = new Map(previous.vertexFlangeParams)
      for (const id of selectedVertexIndices) {
        vertexCornerLength.delete(id)
        vertexFlangeParams.delete(id)
      }
      return { ...previous, vertexCornerLength, vertexFlangeParams }
    })
  }

  // Marks (or unmarks) every selected vertex as a foot.
  const handleFootVertexToggle = (isFoot: boolean) => {
    if (selectedVertexIndices.size === 0) return
    setFootVertices((prev) => {
      const next = new Set(prev)
      for (const idx of selectedVertexIndices) {
        if (isFoot) next.add(idx)
        else next.delete(idx)
      }
      return next
    })
  }

  const handleFootParamChange = (key: keyof FootParams, value: number) =>
    setFootParams((prev) => ({ ...prev, [key]: value }))

  const handleDeleteSelected = () => {
    if (selectedVertexIndices.size === 0) return
    setSceneData(deleteVertices(sceneData, selectedVertexIndices))
    setSelectedVertexIndices(new Set())
  }

  const clearSelection = () => {
    setSelectedVertexIndices(new Set())
    setSelectedEdgeIndices(new Set())
    setSelectedFaceIndices(new Set())
    setSelectedBraceIndices(new Set())
  }
  const handleUndo = () => {
    documentHistory.undo()
    clearSelection()
  }
  const handleRedo = () => {
    documentHistory.redo()
    clearSelection()
  }

  const handleDeselectAll = () => {
    setSelectedVertexIndices(new Set())
    setSelectedEdgeIndices(new Set())
    setSelectedFaceIndices(new Set())
    setSelectedBraceIndices(new Set())
  }

  const handleTransformChange = (field: keyof VertexTransform, value: number) => {
    if (selectedVertexIndices.size === 0) return
    setVertexTransforms((prev) => {
      const next = new Map(prev)
      for (const idx of selectedVertexIndices) {
        const updated = { ...(next.get(idx) ?? DEFAULT_VERTEX_TRANSFORM), [field]: value }
        if (isDefaultVertexTransform(updated)) next.delete(idx)
        else next.set(idx, updated)
      }
      return next
    })
  }

  const handleAlignHorizontally = () => {
    if (selectedVertexIndices.size < 2) return
    const selected = Array.from(selectedVertexIndices).filter((idx) => sceneData.vertices.has(idx) && transformedVertices.has(idx))
    if (selected.length < 2) return
    const averageY = selected.reduce((sum, idx) => sum + transformedVertices.get(idx)!.y, 0) / selected.length

    setVertexTransforms((prev) => {
      const next = new Map(prev)
      for (const idx of selected) {
        const base = sceneData.vertices.get(idx)
        if (!base) continue
        const current = next.get(idx) ?? DEFAULT_VERTEX_TRANSFORM
        const radius = base.r + current.r
        if (!(radius > 0)) continue
        const targetElevation = Math.asin(Math.min(1, Math.max(-1, averageY / radius)))
        const updated = { ...current, elevation: targetElevation - base.elevation }
        if (isDefaultVertexTransform(updated)) next.delete(idx)
        else next.set(idx, updated)
      }
      return next
    })
  }

  const handleAlignVertically = () => {
    if (selectedVertexIndices.size < 2) return
    setVertexTransforms((prev) => alignVerticesVertically(sceneData.vertices, prev, selectedVertexIndices))
  }

  const handleResetTransform = () => {
    if (selectedVertexIndices.size === 0) return
    setVertexTransforms((prev) => {
      const next = new Map(prev)
      for (const idx of selectedVertexIndices) next.delete(idx)
      return next
    })
  }

  const canPairVertices = selectedVertexIndices.size > 0 && selectedVertexIndices.size % 2 === 0

  const handleAddPoints = () => {
    if (!canPairVertices) return
    const positionOf = (id: number) => transformedVertices.get(id)!
    setSceneData(addMidpointsBetween(sceneData, Array.from(selectedVertexIndices), positionOf))
    setSelectedVertexIndices(new Set())
  }

  // Pairs up the selected vertices by nearest neighbor (same pairing "Add Points" uses) and
  // connects each pair with a direct edge, skipping any pair that's already connected - no
  // midpoint, no face, just the strut.
  const handleConnectVertices = () => {
    if (!canPairVertices) return
    const positionOf = (id: number) => transformedVertices.get(id)!
    setSceneData(connectVertexPairs(sceneData, Array.from(selectedVertexIndices), positionOf))
    setSelectedVertexIndices(new Set())
  }

  // "New" opens from a button now, rather than living in the Edit/Preview switcher - remember
  // where to come back to when it closes.
  const handleOpenNew = () => {
    if (mode !== 'new') {
      setPreNewMode(mode)
      // Start from the current dome's size.
      setNewDiameter(sceneData.diameter)
    }
    setMode('new')
  }

  // Create commits whatever's configured in "New" as the geometry to edit, discarding whatever
  // was being edited before (its vertex ids no longer mean anything against the new shape) and
  // resetting every other tab's settings (center, edge curvature, ...) back to their defaults,
  // since they were tuned for a dome that no longer exists.
  const handleCreateNew = () => {
    const next = createDocument(null, pruneToLayerCount(previewData, layerCount))
    documentHistory.reset({
      ...next,
      stepExportSettings,
      dxfSheetSettings,
      partIdLabelSize,
      connectedPartIdLabelSize,
    })
    clearSelection()
    setEditTarget('vertices')
    setMode(preNewMode)
  }

  // Cancel closes "New" without touching anything it would have committed.
  const handleCancelNew = () => {
    setMode(preNewMode)
  }

  const applyConfig = (state: DomeState) => {
    documentHistory.reset(createDocument(state))
    setSelectionMode(state.selectionMode)
    clearSelection()
    setEditTarget('vertices')
    setMode('edit')
  }

  const buildConfig = (): DomeConfig =>
    serializeConfig({
      stepExportSettings,
      dxfSheetSettings,
      partIdLabelSize,
      connectedPartIdLabelSize,
      sceneData,
      selectionMode,
      extrudeDistance,
      thickness,
      cornerLength,
      offsetModifier,
      endGrooveLengthPercent,
      midGrooveLengthPercent,
      grooveDepth,
      millingDiameter,
      chamferLength,
      roundStrutBridge,
      shellEnabled,
      shellThickness,
      shellLayout,
      shellStitches,
      toleranceLongitudinal,
      toleranceTransverse,
      centerHoleDiameter,
      sideHoleDiameterOuter,
      sideHoleDiameterInner,
      sideHoleDiameterOffset,
      overshoot,
      minSide,
      flangeMillingDiameter,
      vertexTransforms,
      edgeThickness,
      vertexCornerLength,
      vertexFlangeParams,
      footParams,
      footVertices,
    })

  // Auto-save on every change to any config field, so the next page load can restore it.
  useEffect(() => {
    saveConfigToLocalStorage(buildConfig())
  }, [
    stepExportSettings,
    dxfSheetSettings,
    partIdLabelSize,
    connectedPartIdLabelSize,
    sceneData,
    selectionMode,
    extrudeDistance,
    thickness,
    cornerLength,
    offsetModifier,
    endGrooveLengthPercent,
    midGrooveLengthPercent,
    grooveDepth,
    millingDiameter,
    chamferLength,
    roundStrutBridge,
    shellEnabled,
    shellThickness,
    shellLayout,
    shellStitches,
    toleranceLongitudinal,
    toleranceTransverse,
    centerHoleDiameter,
    sideHoleDiameterOuter,
    sideHoleDiameterInner,
    sideHoleDiameterOffset,
    overshoot,
    minSide,
    flangeMillingDiameter,
    vertexTransforms,
    edgeThickness,
    vertexCornerLength,
    vertexFlangeParams,
    footParams,
    footVertices,
  ])

  const handleExportConfig = () => {
    downloadConfigAsJson(buildConfig())
  }

  const handleImportConfig = async (file: File) => {
    const config = await readConfigFromFile(file)
    applyConfig(deserializeConfig(config))
  }

  // Preview-mode export: the same shouldered-tenon strut-end layout (precalculateStrutEnd) and
  // miter offsets the live Preview solids are built from (see DomeMesh's preview effect), plus
  // - per vertex - which adjacent edges have a face between them and which don't, and the
  // tangent plane those edges were projected onto to work that out.
  const [exportSession, setExportSession] = useState<ExportSession | null>(null)
  const exportController = useRef<AbortController | null>(null)
  const beginExport = (kind: ExportKind): AbortController | null => {
    if (exportController.current) return null
    const controller = new AbortController()
    exportController.current = controller
    setExportSession({ kind, status: 'running', progress: { phase: 'struts', done: 0, total: 0 }, arrangeOnSheet: dxfSheetSettings.arrangeOnSheet })
    return controller
  }
  const updateExportProgress = (controller: AbortController, progress: StepExportProgress | DxfExportProgress | null) => {
    if (!progress || controller.signal.aborted || exportController.current !== controller) return
    setExportSession((session) => session?.status === 'running' ? { ...session, progress } : session)
  }
  const finishExport = (controller: AbortController, error?: unknown) => {
    if (controller.signal.aborted) return
    exportController.current = null
    setExportSession((session) => session ? {
      ...session,
      status: error === undefined ? 'completed' : 'failed',
      error: error instanceof Error ? error.message : error === undefined ? undefined : String(error),
    } : null)
  }
  const cancelExport = () => {
    exportController.current?.abort()
    exportController.current = null
    setExportSession(null)
  }
  // Everything the STEP archive/assembly and DXF exports build their parts from - the applied
  // Preview params.
  const buildExportParams = (): RunStepExportParams => (
    {
      data: sceneData,
      transformedVertices,
      edgeThickness,
      thickness: appliedPreviewParams.thickness,
      extrudeDistance: appliedPreviewParams.extrudeDistance,
      cornerLength: appliedPreviewParams.cornerLength,
      vertexCornerLength,
      vertexFlangeParams,
      footVertices,
      footParams: appliedPreviewParams.footParams,
      offsetModifier: appliedPreviewParams.offsetModifier,
      endGrooveLengthPercent: appliedPreviewParams.endGrooveLengthPercent,
      midGrooveLengthPercent: appliedPreviewParams.midGrooveLengthPercent,
      grooveDepth: appliedPreviewParams.grooveDepth,
      millingDiameter: appliedPreviewParams.millingDiameter,
      chamferLength: appliedPreviewParams.chamferLength,
      roundStrutBridge: appliedPreviewParams.roundStrutBridge,
      shellEnabled: appliedPreviewParams.shellEnabled,
      flangeParams: {
        toleranceLongitudinal: appliedPreviewParams.toleranceLongitudinal,
        toleranceTransverse: appliedPreviewParams.toleranceTransverse,
        centerHoleDiameter: appliedPreviewParams.centerHoleDiameter,
        sideHoleDiameterOuter: appliedPreviewParams.sideHoleDiameterOuter,
        sideHoleDiameterInner: appliedPreviewParams.sideHoleDiameterInner,
        sideHoleDiameterOffset: appliedPreviewParams.sideHoleDiameterOffset,
        overshoot: appliedPreviewParams.overshoot,
        minSide: appliedPreviewParams.minSide,
        millingDiameter: appliedPreviewParams.flangeMillingDiameter,
      },
      scale: 1,
    }
  )

  const handleDownloadSteps = async () => {
    const controller = beginExport('step-parts')
    if (!controller) return
    try {
      const zipBlob = await runStepExport(
        { ...buildExportParams(), stepExportSettings },
        (progress) => updateExportProgress(controller, progress),
        () => controller.signal.aborted,
        controller.signal,
      )
      if (zipBlob && !controller.signal.aborted) {
        downloadBlob(zipBlob, 'dome-parts.zip')
        finishExport(controller)
      }
    } catch (err) {
      if (!controller.signal.aborted) finishExport(controller, err)
    }
  }

  // One randomly picked part, built as the archive would build it. Unlike the full exports, a
  // finished debug export just closes its dialog - it's meant to be clicked repeatedly.
  const handleDownloadStepDebugPart = async (kind: StepDebugPartKind) => {
    const controller = beginExport('step-debug')
    if (!controller) return
    try {
      const piece = await runStepDebugExport(
        { ...buildExportParams(), stepExportSettings },
        kind,
        (progress) => updateExportProgress(controller, progress),
        () => controller.signal.aborted,
        controller.signal,
      )
      if (piece && !controller.signal.aborted) {
        downloadBlob(piece.blob, piece.name)
        exportController.current = null
        setExportSession(null)
      }
    } catch (err) {
      if (!controller.signal.aborted) finishExport(controller, err)
    }
  }
  const stepDebugPartKinds = new Set<StepDebugPartKind>([
    ...(sceneData.edges.size > 0 ? ['strut', 'flange'] as const : []),
    ...(footVertices.size > 0 ? ['foot'] as const : []),
    ...(sceneData.braces.size > 0 ? ['bracePlate', 'brace'] as const : []),
  ])

  const handleDownloadStepAssembly = async () => {
    const controller = beginExport('step-assembly')
    if (!controller) return
    try {
      const stepBlob = await runStepAssemblyExport(
        buildExportParams(),
        (progress) => updateExportProgress(controller, progress),
        () => controller.signal.aborted,
        controller.signal,
      )
      if (stepBlob && !controller.signal.aborted) {
        downloadBlob(stepBlob, 'dome-assembly.step')
        finishExport(controller)
      }
    } catch (err) {
      if (!controller.signal.aborted) finishExport(controller, err)
    }
  }

  const handleDownloadDxf = async () => {
    const controller = beginExport('dxf')
    if (!controller) return
    try {
      const blob = await runDxfExport({ ...buildExportParams(), shellLayout, shellStitches, shellThickness: appliedPreviewParams.shellThickness }, (progress) => updateExportProgress(controller, progress), () => controller.signal.aborted, { partIdLabelSize, connectedPartIdLabelSize }, dxfSheetSettings, controller.signal)
      if (blob && !controller.signal.aborted) {
        downloadBlob(blob, 'dome-parts.dxf')
        finishExport(controller)
      }
    } catch (err) {
      if (!controller.signal.aborted) finishExport(controller, err)
    }
  }

  const isNew = mode === 'new'

  return (
    <div className="app">
      <Sidebar
        onDecoupleAllShellPanels={() => shellWorkspaceActions.current?.decoupleAll()}
        onAutoStitchShellPanels={() => shellWorkspaceActions.current?.stitchAutomatically()}
        onExportConfig={handleExportConfig}
        onImportConfig={handleImportConfig}
        onDownloadSteps={handleDownloadSteps}
        onDownloadStepAssembly={handleDownloadStepAssembly}
        onDownloadStepDebugPart={handleDownloadStepDebugPart}
        stepDebugPartKinds={stepDebugPartKinds}
        onDownloadDxf={handleDownloadDxf}
        exportBusy={exportSession?.status === 'running'}
        stepExportSettings={stepExportSettings}
        onStepExportSettingsChange={setStepExportSettings}
        dxfSheetSettings={dxfSheetSettings}
        onDxfSheetSettingsChange={setDxfSheetSettings}
        partIdLabelSize={partIdLabelSize}
        onPartIdLabelSizeChange={setPartIdLabelSize}
        connectedPartIdLabelSize={connectedPartIdLabelSize}
        onConnectedPartIdLabelSizeChange={setConnectedPartIdLabelSize}
        mode={mode}
        onOpenNew={handleOpenNew}
        onCreateNew={handleCreateNew}
        onCancelNew={handleCancelNew}
        onSwitchMode={setMode}
        shape={shape}
        onShapeChange={handleShapeChange}
        axis={axis}
        onAxisChange={handleAxisChange}
        subdivisions={subdivisions}
        onSubdivisionsChange={handleSubdivisionsChange}
        diameter={isNew ? newDiameter : mode === 'preview' ? previewDiameterDraft ?? sceneData.diameter : sceneData.diameter}
        onDiameterChange={handleDiameterChange}
        layerCount={layerCount}
        onLayerCountChange={setLayerCount}
        data={previewData}
        editTarget={editTarget}
        onEditTargetChange={handleEditTargetChange}
        selectionMode={selectionMode}
        onSelectionModeChange={setSelectionMode}
        selectedCount={selectedVertexIndices.size}
        selectedVertexIndices={selectedVertexIndices}
        vertexTransforms={vertexTransforms}
        onTransformChange={handleTransformChange}
        onAlignHorizontally={handleAlignHorizontally}
        onAlignVertically={handleAlignVertically}
        onResetTransform={handleResetTransform}
        canAddPoints={canPairVertices}
        onAddPoints={handleAddPoints}
        onConnectVertices={handleConnectVertices}
        selectedEdgeCount={selectedEdgeIndices.size}
        selectedEdgeIndices={selectedEdgeIndices}
        onDeleteSelectedEdges={handleDeleteSelectedEdges}
        edgeThickness={edgeThickness}
        onEdgeThicknessChange={handleEdgeThicknessChange}
        onResetEdgeThickness={handleResetEdgeThickness}
        vertexCornerLength={vertexCornerLength}
        onVertexCornerLengthChange={handleVertexCornerLengthChange}
        onResetVertexCornerLength={handleResetVertexCornerLength}
        vertexFlangeParams={vertexFlangeParams}
        onVertexFlangeParamChange={handleVertexFlangeParamChange}
        onResetVertexFlangeParam={handleResetVertexFlangeParam}
        onResetAllVertexOverrides={handleResetAllVertexOverrides}
        footVertices={footVertices}
        onFootVertexToggle={handleFootVertexToggle}
        footParams={footParams}
        onFootParamChange={handleFootParamChange}
        canCreateFace={creatableFaces.length > 0}
        onCreateFace={handleCreateFacesFromEdges}
        canAddBrace={canAddBrace}
        onAddBrace={handleAddBrace}
        selectedBraceCount={liveSelectedBraceIndices.size}
        braceParamValues={braceParamValues}
        onBraceParamChange={handleBraceParamChange}
        onDeleteSelectedBraces={handleDeleteSelectedBraces}
        selectedFaceCount={selectedFaceIndices.size}
        onDeleteSelectedFaces={handleDeleteSelectedFaces}
        extrudeDistance={extrudeDistance}
        onExtrudeDistanceChange={setExtrudeDistance}
        thickness={thickness}
        onThicknessChange={setThickness}
        cornerLength={cornerLength}
        onCornerLengthChange={setCornerLength}
        offsetModifier={offsetModifier}
        onOffsetModifierChange={setOffsetModifier}
        endGrooveLengthPercent={endGrooveLengthPercent}
        onEndGrooveLengthPercentChange={setEndGrooveLengthPercent}
        midGrooveLengthPercent={midGrooveLengthPercent}
        onMidGrooveLengthPercentChange={setMidGrooveLengthPercent}
        grooveDepth={grooveDepth}
        onGrooveDepthChange={setGrooveDepth}
        millingDiameter={millingDiameter}
        onMillingDiameterChange={setMillingDiameter}
        chamferLength={chamferLength}
        onChamferLengthChange={setChamferLength}
        shellThickness={shellThickness}
        onShellThicknessChange={setShellThickness}
        shellEnabled={shellEnabled}
        onShellEnabledChange={setShellEnabled}
        roundStrutBridge={roundStrutBridge}
        onRoundStrutBridgeChange={setRoundStrutBridge}
        toleranceLongitudinal={toleranceLongitudinal}
        onToleranceLongitudinalChange={setToleranceLongitudinal}
        toleranceTransverse={toleranceTransverse}
        onToleranceTransverseChange={setToleranceTransverse}
        centerHoleDiameter={centerHoleDiameter}
        onCenterHoleDiameterChange={setCenterHoleDiameter}
        sideHoleDiameterOuter={sideHoleDiameterOuter}
        onSideHoleDiameterOuterChange={setSideHoleDiameterOuter}
        sideHoleDiameterInner={sideHoleDiameterInner}
        onSideHoleDiameterInnerChange={setSideHoleDiameterInner}
        sideHoleDiameterOffset={sideHoleDiameterOffset}
        onSideHoleDiameterOffsetChange={setSideHoleDiameterOffset}
        overshoot={overshoot}
        onOvershootChange={setOvershoot}
        minSide={minSide}
        onMinSideChange={setMinSide}
        flangeMillingDiameter={flangeMillingDiameter}
        onFlangeMillingDiameterChange={setFlangeMillingDiameter}
        previewParamsDirty={previewParamsDirty || bracePlateDirty || previewDiameterDirty}
        bracePlateDraft={bracePlateDraft}
        onBracePlateParamChange={handleBracePlateParamChange}
        onApplyPreview={handleApplyPreview}
        partVisibility={partVisibility}
        onPartVisibilityChange={handlePartVisibilityChange}
        canUndo={documentHistory.canUndo}
        canRedo={documentHistory.canRedo}
        onDeleteSelected={handleDeleteSelected}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onEndHistoryGroup={documentHistory.endGroup}
      />
      {exportSession && <ExportProgressModal session={exportSession} onCancel={cancelExport} onClose={() => setExportSession(null)} />}
      {mode === 'shell' ? (
        <ShellWorkspace actionsRef={shellWorkspaceActions} params={buildExportParams()} layout={shellLayout} stitches={shellStitches}
          onLayoutChange={(layout, stitches) => documentHistory.commit(prev => ({ ...prev, shellLayout: layout, shellStitches: stitches }))}
          previewParamsDirty={previewParamsDirty || bracePlateDirty || previewDiameterDirty}
          onApplyPreview={handleApplyPreview} onEndHistoryGroup={documentHistory.endGroup} />
      ) : <Viewport
        mode={mode}
        editTarget={editTarget}
        diameter={isNew ? newDiameter : sceneData.diameter}
        data={isNew ? previewSceneData : sceneData}
        transformedVertices={isNew ? previewVertices : transformedVertices}
        selectedVertexIndices={isNew ? EMPTY_INDEX_SET : selectedVertexIndices}
        selectedEdgeIndices={isNew ? EMPTY_INDEX_SET : selectedEdgeIndices}
        edgeThickness={isNew ? EMPTY_EDGE_THICKNESS : edgeThickness}
        vertexCornerLength={isNew ? EMPTY_VERTEX_CORNER_LENGTH : vertexCornerLength}
        vertexFlangeParams={isNew ? EMPTY_VERTEX_FLANGE_PARAMS : vertexFlangeParams}
        footVertices={isNew ? EMPTY_INDEX_SET : footVertices}
        footParams={appliedPreviewParams.footParams}
        selectedFaceIndices={isNew ? EMPTY_INDEX_SET : selectedFaceIndices}
        selectedBraceIndices={isNew ? EMPTY_INDEX_SET : liveSelectedBraceIndices}
        extrudeDistance={appliedPreviewParams.extrudeDistance}
        thickness={appliedPreviewParams.thickness}
        cornerLength={appliedPreviewParams.cornerLength}
        offsetModifier={appliedPreviewParams.offsetModifier}
        endGrooveLengthPercent={appliedPreviewParams.endGrooveLengthPercent}
        midGrooveLengthPercent={appliedPreviewParams.midGrooveLengthPercent}
        grooveDepth={appliedPreviewParams.grooveDepth}
        millingDiameter={appliedPreviewParams.millingDiameter}
        chamferLength={appliedPreviewParams.chamferLength}
        shellThickness={appliedPreviewParams.shellThickness}
        shellEnabled={appliedPreviewParams.shellEnabled}
        roundStrutBridge={appliedPreviewParams.roundStrutBridge}
        toleranceLongitudinal={appliedPreviewParams.toleranceLongitudinal}
        toleranceTransverse={appliedPreviewParams.toleranceTransverse}
        centerHoleDiameter={appliedPreviewParams.centerHoleDiameter}
        sideHoleDiameterOuter={appliedPreviewParams.sideHoleDiameterOuter}
        sideHoleDiameterInner={appliedPreviewParams.sideHoleDiameterInner}
        sideHoleDiameterOffset={appliedPreviewParams.sideHoleDiameterOffset}
        overshoot={appliedPreviewParams.overshoot}
        minSide={appliedPreviewParams.minSide}
        flangeMillingDiameter={appliedPreviewParams.flangeMillingDiameter}
        partVisibility={partVisibility}
        previewParamsDirty={previewParamsDirty || bracePlateDirty || previewDiameterDirty}
        onApplyPreview={handleApplyPreview}
        onVertexClick={handleVertexClick}
        onEdgeClick={handleEdgeClick}
        onFaceClick={handleFaceClick}
        onBraceClick={handleBraceClick}
        onDeselectAll={handleDeselectAll}
      />}
    </div>
  )
}

export default App
