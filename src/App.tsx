import { useEffect, useMemo, useState } from 'react'
import type { AxisType, Edge, Face, SceneData, SelectionMode, ShapeType, VertexTransform } from './lib/polyhedra'
import {
  addFaces,
  addMidpointsBetween,
  applyVertexTransforms,
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
  SHAPE_AXES,
} from './lib/polyhedra'
import {
  addBrace,
  applyBracePlateParams,
  BRACE_PARAM_FIELDS,
  bracePlateParamsDiffer,
  DEFAULT_BRACE_PLATE_PARAMS,
  deleteBraces,
  firstBracePlateParams,
  resolveBracePair,
  sanitizeBraceParam,
  setBraceParam,
  type BraceParams,
  type BracePlateParams,
} from './lib/braces'
import { Sidebar } from './components/Sidebar'
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
import { downloadBlob, downloadJson } from './lib/download'
import { computeEdgesInfo } from './lib/edgesInfo'
import { DEFAULT_FLANGE_SHAPE_PARAMS, type FlangeShapeParams } from './lib/flangeGeometry'
import { runStepExport, type RunStepExportParams, type StepExportProgress } from './lib/stepExportRunner'
import { runDxfExport, type DxfExportProgress } from './lib/dxfExportRunner'
import { useHistory } from './lib/useHistory'

export type ViewMode = 'new' | 'edit' | 'preview'
export type EditOrPreviewMode = 'edit' | 'preview'
export type EditTarget = 'vertices' | 'edges' | 'faces' | 'braces'

// The strut-shape fields in the Sidebar's "Edge Curvature" and "Grooves" sections - the only
// preview settings, since rebuilding every strut solid via replicad/opencascade.js is slow.
// Kept separate from the live (draft) state below: the Viewport only ever sees this applied
// snapshot, so editing these fields doesn't retrigger that rebuild until "Apply" is clicked.
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
  toleranceLongitudinal: number
  toleranceTransverse: number
  centerHoleDiameter: number
  sideHoleDiameter: number
  sideHoleDiameterOffset: number
  overshoot: number
  minSide: number
  flangeMillingDiameter: number
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
// See the "Grooves" section in Sidebar and computeStrutBoundaryManual's shoulder/tenon params.
const DEFAULT_END_GROOVE_LENGTH_PERCENT = 15
const DEFAULT_MID_GROOVE_LENGTH_PERCENT = 15
const DEFAULT_GROOVE_DEPTH = 30
const DEFAULT_MILLING_DIAMETER = 5
const DEFAULT_CHAMFER_LENGTH = 6

const EMPTY_INDEX_SET: ReadonlySet<number> = new Set()
const EMPTY_VERTEX_TRANSFORMS: ReadonlyMap<number, VertexTransform> = new Map()
const EMPTY_EDGE_THICKNESS: ReadonlyMap<number, number> = new Map()
const EMPTY_VERTEX_CORNER_LENGTH: ReadonlyMap<number, number> = new Map()
const EMPTY_VERTEX_FLANGE_PARAMS: ReadonlyMap<number, Partial<FlangeShapeParams>> = new Map()

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
  const [diameter, setDiameter] = useState(initial?.diameter ?? DEFAULT_DIAMETER_MM)

  const previewData = useMemo(
    () => computePolyhedron(shape, axis, subdivisions, diameter),
    [shape, axis, subdivisions, diameter],
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
    setDiameter(nextDiameter)
    const next = computePolyhedron(nextShape, nextAxis, nextSubdivisions, nextDiameter)
    setLayerCount(Math.ceil(next.layers.length / 2))
  }
  const handleShapeChange = (s: ShapeType) => setNewShapeParams(s, axis, subdivisions, diameter)
  const handleAxisChange = (a: AxisType) => setNewShapeParams(shape, a, subdivisions, diameter)
  const handleSubdivisionsChange = (s: number) => setNewShapeParams(shape, axis, s, diameter)
  // The diameter is part of the shape recipe (regenerates the preview and marks it dirty to
  // commit) - it's only editable in "New".
  const handleDiameterChange = (d: number) => setNewShapeParams(shape, axis, subdivisions, d)

  // The committed geometry actually being edited/previewed - vertices, edges, and faces, plain
  // and concrete, with bounded undo/redo over every structural edit (delete/add). Only reset
  // (wiping undo history) when a "New" tab pick is committed or a config is loaded.
  const sceneHistory = useHistory<SceneData>(initial?.sceneData ?? DEFAULT_SCENE_DATA, 50)
  const sceneData = sceneHistory.value

  const [selectionMode, setSelectionMode] = useState<SelectionMode>(
    initial?.selectionMode ?? 'symmetric',
  )

  // Which kind of element clicking in the viewport selects, while editing.
  const [editTarget, setEditTarget] = useState<EditTarget>('vertices')

  const [selectedVertexIndices, setSelectedVertexIndices] = useState<Set<number>>(new Set())
  const [selectedEdgeIndices, setSelectedEdgeIndices] = useState<Set<number>>(new Set())
  const [selectedFaceIndices, setSelectedFaceIndices] = useState<Set<number>>(new Set())
  const [selectedBraceIndices, setSelectedBraceIndices] = useState<Set<number>>(new Set())
  // The plate properties (width, holes, thickness, ...) shown in the Preview sidebar. Every brace
  // has the same ones for now: Apply copies this draft onto all of them, and new braces start with
  // it. Starts out as whatever the first brace already has.
  const [bracePlateDraft, setBracePlateDraft] = useState<BracePlateParams>(() =>
    firstBracePlateParams((initial?.sceneData ?? DEFAULT_SCENE_DATA).braces),
  )
  const [edgeThickness, setEdgeThickness] = useState<Map<number, number>>(
    new Map(initial?.edgeThickness ?? []),
  )
  // Per-vertex corner length override (mm), keyed by vertex id; a vertex without an entry uses the
  // global `cornerLength`. Like edgeThickness, applies live rather than waiting for "Apply".
  const [vertexCornerLength, setVertexCornerLength] = useState<Map<number, number>>(
    new Map(initial?.vertexCornerLength ?? []),
  )
  // Per-vertex overrides of any flange parameter, keyed by vertex id; only the overridden
  // parameters are present, the rest use the global ones. Applies live, like the above.
  const [vertexFlangeParams, setVertexFlangeParams] = useState<
    Map<number, Partial<FlangeShapeParams>>
  >(new Map(initial?.vertexFlangeParams ?? []))
  const [vertexTransforms, setVertexTransforms] = useState<Map<number, VertexTransform>>(
    new Map(initial?.vertexTransforms ?? []),
  )

  const [extrudeDistance, setExtrudeDistance] = useState(
    initial?.extrudeDistance ?? DEFAULT_EXTRUDE_DISTANCE,
  )
  const [thickness, setThickness] = useState(initial?.thickness ?? DEFAULT_THICKNESS)
  const [cornerLength, setCornerLength] = useState(initial?.cornerLength ?? DEFAULT_CORNER_LENGTH)
  const [offsetModifier, setOffsetModifier] = useState(
    initial?.offsetModifier ?? DEFAULT_OFFSET_MODIFIER,
  )
  const [endGrooveLengthPercent, setEndGrooveLengthPercent] = useState(
    initial?.endGrooveLengthPercent ?? DEFAULT_END_GROOVE_LENGTH_PERCENT,
  )
  const [midGrooveLengthPercent, setMidGrooveLengthPercent] = useState(
    initial?.midGrooveLengthPercent ?? DEFAULT_MID_GROOVE_LENGTH_PERCENT,
  )
  const [grooveDepth, setGrooveDepth] = useState(initial?.grooveDepth ?? DEFAULT_GROOVE_DEPTH)
  const [millingDiameter, setMillingDiameter] = useState(
    initial?.millingDiameter ?? DEFAULT_MILLING_DIAMETER,
  )
  const [chamferLength, setChamferLength] = useState(initial?.chamferLength ?? DEFAULT_CHAMFER_LENGTH)

  // The flange connector plate at each hub vertex - see the "Flange" Sidebar section and
  // flangeGeometry.ts's FlangeShapeParams (which these mirror field-for-field, aside from its
  // own `millingDiameter` living here as `flangeMillingDiameter` to stay distinct from the
  // strut-shared one above).
  const [toleranceLongitudinal, setToleranceLongitudinal] = useState(
    initial?.toleranceLongitudinal ?? DEFAULT_FLANGE_SHAPE_PARAMS.toleranceLongitudinal,
  )
  const [toleranceTransverse, setToleranceTransverse] = useState(
    initial?.toleranceTransverse ?? DEFAULT_FLANGE_SHAPE_PARAMS.toleranceTransverse,
  )
  const [centerHoleDiameter, setCenterHoleDiameter] = useState(
    initial?.centerHoleDiameter ?? DEFAULT_FLANGE_SHAPE_PARAMS.centerHoleDiameter,
  )
  const [sideHoleDiameter, setSideHoleDiameter] = useState(
    initial?.sideHoleDiameter ?? DEFAULT_FLANGE_SHAPE_PARAMS.sideHoleDiameter,
  )
  const [sideHoleDiameterOffset, setSideHoleDiameterOffset] = useState(
    initial?.sideHoleDiameterOffset ?? DEFAULT_FLANGE_SHAPE_PARAMS.sideHoleDiameterOffset,
  )
  const [overshoot, setOvershoot] = useState(initial?.overshoot ?? DEFAULT_FLANGE_SHAPE_PARAMS.overshoot)
  const [minSide, setMinSide] = useState(initial?.minSide ?? DEFAULT_FLANGE_SHAPE_PARAMS.minSide)
  const [flangeMillingDiameter, setFlangeMillingDiameter] = useState(
    initial?.flangeMillingDiameter ?? DEFAULT_FLANGE_SHAPE_PARAMS.millingDiameter,
  )

  // The draft values above update live as the Sidebar's Preview fields are edited; the Viewport
  // instead renders this applied snapshot, only updated by handleApplyPreview - see
  // PreviewShapeParams's own doc.
  const [appliedPreviewParams, setAppliedPreviewParams] = useState<PreviewShapeParams>(() => ({
    extrudeDistance,
    thickness,
    cornerLength,
    offsetModifier,
    endGrooveLengthPercent,
    midGrooveLengthPercent,
    grooveDepth,
    millingDiameter,
    chamferLength,
    toleranceLongitudinal,
    toleranceTransverse,
    centerHoleDiameter,
    sideHoleDiameter,
    sideHoleDiameterOffset,
    overshoot,
    minSide,
    flangeMillingDiameter,
  }))
  const draftPreviewParams: PreviewShapeParams = {
    extrudeDistance,
    thickness,
    cornerLength,
    offsetModifier,
    endGrooveLengthPercent,
    midGrooveLengthPercent,
    grooveDepth,
    millingDiameter,
    chamferLength,
    toleranceLongitudinal,
    toleranceTransverse,
    centerHoleDiameter,
    sideHoleDiameter,
    sideHoleDiameterOffset,
    overshoot,
    minSide,
    flangeMillingDiameter,
  }
  const previewParamsDirty = (Object.keys(draftPreviewParams) as (keyof PreviewShapeParams)[]).some(
    (key) => draftPreviewParams[key] !== appliedPreviewParams[key],
  )
  const bracePlateDirty = useMemo(
    () => bracePlateParamsDiffer(sceneData, bracePlateDraft),
    [sceneData, bracePlateDraft],
  )
  const handleBracePlateParamChange = (key: keyof BracePlateParams, value: number) =>
    setBracePlateDraft((prev) => ({ ...prev, [key]: sanitizeBraceParam(key, value) }))
  const handleApplyPreview = () => {
    setAppliedPreviewParams(draftPreviewParams)
    if (bracePlateDirty) sceneHistory.commit(applyBracePlateParams(sceneData, bracePlateDraft))
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
    sceneHistory.commit(addBrace(sceneData, selectedEdgeIndices, bracePlateDraft))
    setSelectedEdgeIndices(new Set())
  }

  const handleDeleteSelectedBraces = () => {
    if (liveSelectedBraceIndices.size === 0) return
    sceneHistory.commit(deleteBraces(sceneData, liveSelectedBraceIndices))
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
    sceneHistory.commit(setBraceParam(sceneData, liveSelectedBraceIndices, key, value))
  }

  const handleDeleteSelectedFaces = () => {
    if (selectedFaceIndices.size === 0) return
    sceneHistory.commit(deleteFaces(sceneData, selectedFaceIndices))
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
    sceneHistory.commit(addFaces(sceneData, creatableFaces))
    setSelectedEdgeIndices(new Set())
  }

  // Deleting an edge cascades: any face that had it as one of its own sides can no longer
  // stand, and a vertex it touched that's left with no other surviving edge is a stray point,
  // not worth keeping either (see deleteEdges in polyhedra.ts).
  const handleDeleteSelectedEdges = () => {
    if (selectedEdgeIndices.size === 0) return
    sceneHistory.commit(deleteEdges(sceneData, selectedEdgeIndices))
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

  const handleResetVertexFlangeParams = () => {
    if (selectedVertexIndices.size === 0) return
    setVertexFlangeParams((prev) => {
      const next = new Map(prev)
      for (const idx of selectedVertexIndices) next.delete(idx)
      return next
    })
  }

  const handleDeleteSelected = () => {
    if (selectedVertexIndices.size === 0) return
    sceneHistory.commit(deleteVertices(sceneData, selectedVertexIndices))
    setSelectedVertexIndices(new Set())
  }

  const handleUndo = () => sceneHistory.undo()
  const handleRedo = () => sceneHistory.redo()

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
    sceneHistory.commit(addMidpointsBetween(sceneData, Array.from(selectedVertexIndices), positionOf))
    setSelectedVertexIndices(new Set())
  }

  // Pairs up the selected vertices by nearest neighbor (same pairing "Add Points" uses) and
  // connects each pair with a direct edge, skipping any pair that's already connected - no
  // midpoint, no face, just the strut.
  const handleConnectVertices = () => {
    if (!canPairVertices) return
    const positionOf = (id: number) => transformedVertices.get(id)!
    sceneHistory.commit(connectVertexPairs(sceneData, Array.from(selectedVertexIndices), positionOf))
    setSelectedVertexIndices(new Set())
  }

  // "New" opens from a button now, rather than living in the Edit/Preview switcher - remember
  // where to come back to when it closes.
  const handleOpenNew = () => {
    if (mode !== 'new') setPreNewMode(mode)
    setMode('new')
  }

  // Create commits whatever's configured in "New" as the geometry to edit, discarding whatever
  // was being edited before (its vertex ids no longer mean anything against the new shape) and
  // resetting every other tab's settings (center, edge curvature, ...) back to their defaults,
  // since they were tuned for a dome that no longer exists.
  const handleCreateNew = () => {
    sceneHistory.reset(pruneToLayerCount(previewData, layerCount))
    setVertexTransforms(new Map())
    setEdgeThickness(new Map())
    setVertexCornerLength(new Map())
    setVertexFlangeParams(new Map())
    setSelectedVertexIndices(new Set())
    setSelectedEdgeIndices(new Set())
    setSelectedFaceIndices(new Set())
    setSelectedBraceIndices(new Set())
    setBracePlateDraft(DEFAULT_BRACE_PLATE_PARAMS)
    setEditTarget('vertices')
    setExtrudeDistance(DEFAULT_EXTRUDE_DISTANCE)
    setThickness(DEFAULT_THICKNESS)
    setCornerLength(DEFAULT_CORNER_LENGTH)
    setOffsetModifier(DEFAULT_OFFSET_MODIFIER)
    setEndGrooveLengthPercent(DEFAULT_END_GROOVE_LENGTH_PERCENT)
    setMidGrooveLengthPercent(DEFAULT_MID_GROOVE_LENGTH_PERCENT)
    setGrooveDepth(DEFAULT_GROOVE_DEPTH)
    setMillingDiameter(DEFAULT_MILLING_DIAMETER)
    setChamferLength(DEFAULT_CHAMFER_LENGTH)
    setToleranceLongitudinal(DEFAULT_FLANGE_SHAPE_PARAMS.toleranceLongitudinal)
    setToleranceTransverse(DEFAULT_FLANGE_SHAPE_PARAMS.toleranceTransverse)
    setCenterHoleDiameter(DEFAULT_FLANGE_SHAPE_PARAMS.centerHoleDiameter)
    setSideHoleDiameter(DEFAULT_FLANGE_SHAPE_PARAMS.sideHoleDiameter)
    setSideHoleDiameterOffset(DEFAULT_FLANGE_SHAPE_PARAMS.sideHoleDiameterOffset)
    setOvershoot(DEFAULT_FLANGE_SHAPE_PARAMS.overshoot)
    setMinSide(DEFAULT_FLANGE_SHAPE_PARAMS.minSide)
    setFlangeMillingDiameter(DEFAULT_FLANGE_SHAPE_PARAMS.millingDiameter)
    setAppliedPreviewParams({
      extrudeDistance: DEFAULT_EXTRUDE_DISTANCE,
      thickness: DEFAULT_THICKNESS,
      cornerLength: DEFAULT_CORNER_LENGTH,
      offsetModifier: DEFAULT_OFFSET_MODIFIER,
      endGrooveLengthPercent: DEFAULT_END_GROOVE_LENGTH_PERCENT,
      midGrooveLengthPercent: DEFAULT_MID_GROOVE_LENGTH_PERCENT,
      grooveDepth: DEFAULT_GROOVE_DEPTH,
      millingDiameter: DEFAULT_MILLING_DIAMETER,
      chamferLength: DEFAULT_CHAMFER_LENGTH,
      toleranceLongitudinal: DEFAULT_FLANGE_SHAPE_PARAMS.toleranceLongitudinal,
      toleranceTransverse: DEFAULT_FLANGE_SHAPE_PARAMS.toleranceTransverse,
      centerHoleDiameter: DEFAULT_FLANGE_SHAPE_PARAMS.centerHoleDiameter,
      sideHoleDiameter: DEFAULT_FLANGE_SHAPE_PARAMS.sideHoleDiameter,
      sideHoleDiameterOffset: DEFAULT_FLANGE_SHAPE_PARAMS.sideHoleDiameterOffset,
      overshoot: DEFAULT_FLANGE_SHAPE_PARAMS.overshoot,
      minSide: DEFAULT_FLANGE_SHAPE_PARAMS.minSide,
      flangeMillingDiameter: DEFAULT_FLANGE_SHAPE_PARAMS.millingDiameter,
    })
    setMode(preNewMode)
  }

  // Cancel closes "New" without touching anything it would have committed.
  const handleCancelNew = () => {
    setMode(preNewMode)
  }

  const applyConfig = (state: DomeState) => {
    setDiameter(state.diameter)
    sceneHistory.reset(state.sceneData)
    setSelectionMode(state.selectionMode)
    setExtrudeDistance(state.extrudeDistance)
    setThickness(state.thickness)
    setCornerLength(state.cornerLength)
    setOffsetModifier(state.offsetModifier)
    setEndGrooveLengthPercent(state.endGrooveLengthPercent)
    setMidGrooveLengthPercent(state.midGrooveLengthPercent)
    setGrooveDepth(state.grooveDepth)
    setMillingDiameter(state.millingDiameter)
    setChamferLength(state.chamferLength)
    setToleranceLongitudinal(state.toleranceLongitudinal)
    setToleranceTransverse(state.toleranceTransverse)
    setCenterHoleDiameter(state.centerHoleDiameter)
    setSideHoleDiameter(state.sideHoleDiameter)
    setSideHoleDiameterOffset(state.sideHoleDiameterOffset)
    setOvershoot(state.overshoot)
    setMinSide(state.minSide)
    setFlangeMillingDiameter(state.flangeMillingDiameter)
    setAppliedPreviewParams({
      extrudeDistance: state.extrudeDistance,
      thickness: state.thickness,
      cornerLength: state.cornerLength,
      offsetModifier: state.offsetModifier,
      endGrooveLengthPercent: state.endGrooveLengthPercent,
      midGrooveLengthPercent: state.midGrooveLengthPercent,
      grooveDepth: state.grooveDepth,
      millingDiameter: state.millingDiameter,
      chamferLength: state.chamferLength,
      toleranceLongitudinal: state.toleranceLongitudinal,
      toleranceTransverse: state.toleranceTransverse,
      centerHoleDiameter: state.centerHoleDiameter,
      sideHoleDiameter: state.sideHoleDiameter,
      sideHoleDiameterOffset: state.sideHoleDiameterOffset,
      overshoot: state.overshoot,
      minSide: state.minSide,
      flangeMillingDiameter: state.flangeMillingDiameter,
    })
    setVertexTransforms(new Map(state.vertexTransforms))
    setEdgeThickness(new Map(state.edgeThickness))
    setVertexCornerLength(new Map(state.vertexCornerLength))
    setVertexFlangeParams(new Map(state.vertexFlangeParams))
    setSelectedVertexIndices(new Set())
    setSelectedEdgeIndices(new Set())
    setSelectedFaceIndices(new Set())
    setSelectedBraceIndices(new Set())
    setBracePlateDraft(firstBracePlateParams(state.sceneData.braces))
    setEditTarget('vertices')
    setMode('edit')
  }

  const buildConfig = (): DomeConfig =>
    serializeConfig({
      diameter,
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
      toleranceLongitudinal,
      toleranceTransverse,
      centerHoleDiameter,
      sideHoleDiameter,
      sideHoleDiameterOffset,
      overshoot,
      minSide,
      flangeMillingDiameter,
      vertexTransforms,
      edgeThickness,
      vertexCornerLength,
      vertexFlangeParams,
    })

  // Auto-save on every change to any config field, so the next page load can restore it.
  useEffect(() => {
    saveConfigToLocalStorage(buildConfig())
  }, [
    diameter,
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
    toleranceLongitudinal,
    toleranceTransverse,
    centerHoleDiameter,
    sideHoleDiameter,
    sideHoleDiameterOffset,
    overshoot,
    minSide,
    flangeMillingDiameter,
    vertexTransforms,
    edgeThickness,
    vertexCornerLength,
    vertexFlangeParams,
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
  const [stepExportProgress, setStepExportProgress] = useState<StepExportProgress | null>(null)
  // Uniform scale factor (1 = no change) applied to every solid in the STEP archive - lets the
  // export double as a scaled-down physical model rather than only the true-size parts.
  const [stepExportScale, setStepExportScale] = useState(1)

  const handleGetEdgesInfo = () => {
    const edgesInfo = computeEdgesInfo({
      data: sceneData,
      transformedVertices,
      edgeThicknessOf: (edgeId) => edgeThickness.get(edgeId) ?? appliedPreviewParams.thickness,
      cornerLength: appliedPreviewParams.cornerLength,
      vertexCornerLength,
      vertexFlangeParams,
      halfWidth: appliedPreviewParams.extrudeDistance / 2,
      offsetModifier: appliedPreviewParams.offsetModifier,
      endGrooveLengthPercent: appliedPreviewParams.endGrooveLengthPercent,
      midGrooveLengthPercent: appliedPreviewParams.midGrooveLengthPercent,
      grooveDepth: appliedPreviewParams.grooveDepth,
      millingDiameter: appliedPreviewParams.millingDiameter,
      chamferLength: appliedPreviewParams.chamferLength,
    })
    downloadJson(edgesInfo, 'edges-info.json')
  }

  // Everything the STEP and DXF exports build their parts from - the applied Preview params.
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
      offsetModifier: appliedPreviewParams.offsetModifier,
      endGrooveLengthPercent: appliedPreviewParams.endGrooveLengthPercent,
      midGrooveLengthPercent: appliedPreviewParams.midGrooveLengthPercent,
      grooveDepth: appliedPreviewParams.grooveDepth,
      millingDiameter: appliedPreviewParams.millingDiameter,
      chamferLength: appliedPreviewParams.chamferLength,
      flangeParams: {
        toleranceLongitudinal: appliedPreviewParams.toleranceLongitudinal,
        toleranceTransverse: appliedPreviewParams.toleranceTransverse,
        centerHoleDiameter: appliedPreviewParams.centerHoleDiameter,
        sideHoleDiameter: appliedPreviewParams.sideHoleDiameter,
        sideHoleDiameterOffset: appliedPreviewParams.sideHoleDiameterOffset,
        overshoot: appliedPreviewParams.overshoot,
        minSide: appliedPreviewParams.minSide,
        millingDiameter: appliedPreviewParams.flangeMillingDiameter,
      },
      scale: stepExportScale,
    }
  )

  const handleDownloadSteps = async () => {
    if (stepExportProgress) return
    setStepExportProgress({ phase: 'struts', done: 0, total: 0 })
    try {
      const zipBlob = await runStepExport(
        buildExportParams(),
        setStepExportProgress,
        () => false,
      )
      if (zipBlob) downloadBlob(zipBlob, 'dome-parts.zip')
    } catch (err) {
      console.error('Failed to export STEP archive', err)
    } finally {
      setStepExportProgress(null)
    }
  }

  const [dxfExportProgress, setDxfExportProgress] = useState<DxfExportProgress | null>(null)

  const handleDownloadDxf = async () => {
    if (dxfExportProgress) return
    setDxfExportProgress({ phase: 'struts', done: 0, total: 0 })
    try {
      const blob = await runDxfExport(buildExportParams(), setDxfExportProgress, () => false)
      if (blob) downloadBlob(blob, 'dome-parts.dxf')
    } catch (err) {
      console.error('Failed to export DXF', err)
    } finally {
      setDxfExportProgress(null)
    }
  }

  const isNew = mode === 'new'

  return (
    <div className="app">
      <Sidebar
        onExportConfig={handleExportConfig}
        onImportConfig={handleImportConfig}
        onGetEdgesInfo={handleGetEdgesInfo}
        onDownloadSteps={handleDownloadSteps}
        onDownloadDxf={handleDownloadDxf}
        dxfExportProgress={dxfExportProgress}
        stepExportProgress={stepExportProgress}
        stepExportScale={stepExportScale}
        onStepExportScaleChange={setStepExportScale}
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
        diameter={diameter}
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
        onResetVertexFlangeParams={handleResetVertexFlangeParams}
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
        toleranceLongitudinal={toleranceLongitudinal}
        onToleranceLongitudinalChange={setToleranceLongitudinal}
        toleranceTransverse={toleranceTransverse}
        onToleranceTransverseChange={setToleranceTransverse}
        centerHoleDiameter={centerHoleDiameter}
        onCenterHoleDiameterChange={setCenterHoleDiameter}
        sideHoleDiameter={sideHoleDiameter}
        onSideHoleDiameterChange={setSideHoleDiameter}
        sideHoleDiameterOffset={sideHoleDiameterOffset}
        onSideHoleDiameterOffsetChange={setSideHoleDiameterOffset}
        overshoot={overshoot}
        onOvershootChange={setOvershoot}
        minSide={minSide}
        onMinSideChange={setMinSide}
        flangeMillingDiameter={flangeMillingDiameter}
        onFlangeMillingDiameterChange={setFlangeMillingDiameter}
        previewParamsDirty={previewParamsDirty || bracePlateDirty}
        bracePlateDraft={bracePlateDraft}
        onBracePlateParamChange={handleBracePlateParamChange}
        onApplyPreview={handleApplyPreview}
        canUndo={sceneHistory.canUndo}
        canRedo={sceneHistory.canRedo}
        onDeleteSelected={handleDeleteSelected}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />
      <Viewport
        mode={mode}
        editTarget={editTarget}
        diameter={diameter}
        data={isNew ? previewSceneData : sceneData}
        transformedVertices={isNew ? previewVertices : transformedVertices}
        selectedVertexIndices={isNew ? EMPTY_INDEX_SET : selectedVertexIndices}
        selectedEdgeIndices={isNew ? EMPTY_INDEX_SET : selectedEdgeIndices}
        edgeThickness={isNew ? EMPTY_EDGE_THICKNESS : edgeThickness}
        vertexCornerLength={isNew ? EMPTY_VERTEX_CORNER_LENGTH : vertexCornerLength}
        vertexFlangeParams={isNew ? EMPTY_VERTEX_FLANGE_PARAMS : vertexFlangeParams}
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
        toleranceLongitudinal={appliedPreviewParams.toleranceLongitudinal}
        toleranceTransverse={appliedPreviewParams.toleranceTransverse}
        centerHoleDiameter={appliedPreviewParams.centerHoleDiameter}
        sideHoleDiameter={appliedPreviewParams.sideHoleDiameter}
        sideHoleDiameterOffset={appliedPreviewParams.sideHoleDiameterOffset}
        overshoot={appliedPreviewParams.overshoot}
        minSide={appliedPreviewParams.minSide}
        flangeMillingDiameter={appliedPreviewParams.flangeMillingDiameter}
        onVertexClick={handleVertexClick}
        onEdgeClick={handleEdgeClick}
        onFaceClick={handleFaceClick}
        onBraceClick={handleBraceClick}
        onDeselectAll={handleDeselectAll}
      />
    </div>
  )
}

export default App
