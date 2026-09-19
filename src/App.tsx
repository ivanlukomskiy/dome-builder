import { useEffect, useMemo, useState } from 'react'
import type { AxisType, Edge, Face, SceneData, SelectionMode, ShapeType, VertexTransform } from './lib/polyhedra'
import {
  addFaces,
  addMidpointsBetween,
  applyVertexTransforms,
  computePolyhedron,
  computeTransformToPosition,
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
  scaleToRadius,
  SHAPE_AXES,
} from './lib/polyhedra'
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
import { DEFAULT_FLANGE_SHAPE_PARAMS } from './lib/flangeGeometry'
import { runStepExport, type StepExportProgress } from './lib/stepExportRunner'
import { useHistory } from './lib/useHistory'

export type ViewMode = 'new' | 'edit' | 'preview'
export type EditOrPreviewMode = 'edit' | 'preview'
export type EditTarget = 'vertices' | 'edges' | 'faces'

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

const DEFAULT_CENTER_Z = 0
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
const EMPTY_EDGE_THICKNESS: ReadonlyMap<number, number> = new Map()

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
  // In "New" a diameter change is part of the shape recipe (regenerates the preview and marks
  // it dirty to commit); in "Edit" it's just the target size "Adjust to a Sphere" snaps onto,
  // so it doesn't touch the committed geometry on its own.
  const handleDiameterChange = (d: number) => {
    if (mode === 'new') setNewShapeParams(shape, axis, subdivisions, d)
    else setDiameter(d)
  }

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
  const [edgeThickness, setEdgeThickness] = useState<Map<number, number>>(
    new Map(initial?.edgeThickness ?? []),
  )
  const [vertexTransforms, setVertexTransforms] = useState<Map<number, VertexTransform>>(
    new Map(initial?.vertexTransforms ?? []),
  )

  // Sphere center: a fixed point on the main axis (x = 0, radius = 0), at this height in mm.
  const [centerZ, setCenterZ] = useState(initial?.centerZ ?? DEFAULT_CENTER_Z)
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
  const handleApplyPreview = () => setAppliedPreviewParams(draftPreviewParams)

  const transformedVertices = useMemo(
    () => applyVertexTransforms(sceneData.vertices, vertexTransforms),
    [sceneData.vertices, vertexTransforms],
  )

  const centerY = centerZ

  // The "New" tab's shape/axis choice no longer describes committed geometry after edits, but
  // it's still the best guess we have for the model's rotational symmetry.
  const symmetryFold = () => SHAPE_AXES[shape].find((opt) => opt.value === axis)!.fold

  const handleVertexClick = (index: number) => {
    if (mode !== 'edit' || editTarget !== 'vertices') return

    // Grouping is always done against base (untransformed) positions, so it stays stable
    // regardless of any transform edits.
    const positionOf = (id: number) => sceneData.vertices.get(id)!
    const candidateIds = Array.from(sceneData.vertices.keys())

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
    const positionOf = (vid: number) => sceneData.vertices.get(vid)!
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
    const positionOf = (vid: number) => sceneData.vertices.get(vid)!
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

  const handleEditTargetChange = (target: EditTarget) => {
    setEditTarget(target)
    setSelectedVertexIndices(new Set())
    setSelectedEdgeIndices(new Set())
    setSelectedFaceIndices(new Set())
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

  // Snaps every vertex onto the sphere of the given diameter around the gravity center, moving
  // each vertex along its own ray from that center out to that fixed radius, replacing any
  // transform it already had.
  const handleAdjustToSphere = () => {
    const allIds = Array.from(sceneData.vertices.keys())
    if (allIds.length === 0) return

    const currentPositionOf = (id: number) => transformedVertices.get(id)!
    const canonicalPositionOf = (id: number) => sceneData.vertices.get(id)!

    const targetRadius = diameter / 2

    setVertexTransforms((prev) => {
      const next = new Map(prev)
      for (const id of allIds) {
        const current = currentPositionOf(id)
        const target = scaleToRadius(current.x, current.y, current.z, centerY, targetRadius)
        const t = computeTransformToPosition(canonicalPositionOf(id), target)
        if (isDefaultVertexTransform(t)) next.delete(id)
        else next.set(id, t)
      }
      return next
    })
  }

  // Lowers (or raises) the gravity center so it sits at the same height as the model's lowest
  // vertex - i.e. the dome's base rests exactly on the center's plane.
  const handleGroundCenter = () => {
    if (transformedVertices.size === 0) return
    let minY = Infinity
    for (const p of transformedVertices.values()) minY = Math.min(minY, p.y)
    setCenterZ(minY)
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
    setSelectedVertexIndices(new Set())
    setSelectedEdgeIndices(new Set())
    setSelectedFaceIndices(new Set())
    setEditTarget('vertices')
    setCenterZ(DEFAULT_CENTER_Z)
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
    setCenterZ(state.centerZ)
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
    setSelectedVertexIndices(new Set())
    setSelectedEdgeIndices(new Set())
    setSelectedFaceIndices(new Set())
    setEditTarget('vertices')
    setMode('edit')
  }

  const buildConfig = (): DomeConfig =>
    serializeConfig({
      diameter,
      sceneData,
      selectionMode,
      centerZ,
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
    })

  // Auto-save on every change to any config field, so the next page load can restore it.
  useEffect(() => {
    saveConfigToLocalStorage(buildConfig())
  }, [
    diameter,
    sceneData,
    selectionMode,
    centerZ,
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
      centerY,
      edgeThicknessOf: (edgeId) => edgeThickness.get(edgeId) ?? appliedPreviewParams.thickness,
      cornerLength: appliedPreviewParams.cornerLength,
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

  const handleDownloadSteps = async () => {
    if (stepExportProgress) return
    setStepExportProgress({ phase: 'struts', done: 0, total: 0 })
    try {
      const zipBlob = await runStepExport(
        {
          data: sceneData,
          transformedVertices,
          centerY,
          edgeThickness,
          thickness: appliedPreviewParams.thickness,
          extrudeDistance: appliedPreviewParams.extrudeDistance,
          cornerLength: appliedPreviewParams.cornerLength,
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
        },
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

  const isNew = mode === 'new'

  return (
    <div className="app">
      <Sidebar
        onExportConfig={handleExportConfig}
        onImportConfig={handleImportConfig}
        onGetEdgesInfo={handleGetEdgesInfo}
        onDownloadSteps={handleDownloadSteps}
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
        onAdjustToSphere={handleAdjustToSphere}
        selectedEdgeCount={selectedEdgeIndices.size}
        selectedEdgeIndices={selectedEdgeIndices}
        onDeleteSelectedEdges={handleDeleteSelectedEdges}
        edgeThickness={edgeThickness}
        onEdgeThicknessChange={handleEdgeThicknessChange}
        onResetEdgeThickness={handleResetEdgeThickness}
        canCreateFace={creatableFaces.length > 0}
        onCreateFace={handleCreateFacesFromEdges}
        selectedFaceCount={selectedFaceIndices.size}
        onDeleteSelectedFaces={handleDeleteSelectedFaces}
        centerZ={centerZ}
        onCenterZChange={setCenterZ}
        onGroundCenter={handleGroundCenter}
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
        previewParamsDirty={previewParamsDirty}
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
        transformedVertices={isNew ? previewSceneData.vertices : transformedVertices}
        selectedVertexIndices={isNew ? EMPTY_INDEX_SET : selectedVertexIndices}
        selectedEdgeIndices={isNew ? EMPTY_INDEX_SET : selectedEdgeIndices}
        edgeThickness={isNew ? EMPTY_EDGE_THICKNESS : edgeThickness}
        selectedFaceIndices={isNew ? EMPTY_INDEX_SET : selectedFaceIndices}
        centerY={centerY}
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
        onDeselectAll={handleDeselectAll}
      />
    </div>
  )
}

export default App
