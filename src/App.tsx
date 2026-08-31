import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import type {
  AxisType,
  Face,
  PolyhedronData,
  SelectionMode,
  ShapeType,
  VertexTransform,
} from './lib/polyhedra'
import {
  applyAddedVertexTransforms,
  applyVertexTransforms,
  buildAddedGeometry,
  computePolyhedron,
  computeTransformToPosition,
  computeVisibleVertexIds,
  DEFAULT_DIAMETER_MM,
  DEFAULT_VERTEX_TRANSFORM,
  findLayerGroup,
  findRotationalSymmetryGroup,
  isDefaultVertexTransform,
  resolveVertexPosition,
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

export type ViewMode = 'new' | 'edit' | 'preview'

const DEFAULT_SHAPE: ShapeType = 'octahedron'
const DEFAULT_AXIS: AxisType = 'vertex'
const DEFAULT_SUBDIVISIONS = 3
const DEFAULT_BASE_DATA = computePolyhedron(
  DEFAULT_SHAPE,
  DEFAULT_AXIS,
  DEFAULT_SUBDIVISIONS,
  DEFAULT_DIAMETER_MM,
)

const DEFAULT_CENTER_Z = 0
const DEFAULT_EDGE_SEGMENTS = 8
const DEFAULT_EXTRUDE_DISTANCE = 125
const DEFAULT_THICKNESS = 75
const DEFAULT_CORNER_LENGTH = 375

const EMPTY_INDEX_SET: ReadonlySet<number> = new Set()
const EMPTY_VERTEX_MAP: ReadonlyMap<number, THREE.Vector3> = new Map()
const EMPTY_FACES: Face[] = []

function App() {
  // Restored once, on first render, from whatever was auto-saved last time (see the autosave
  // effect below); null if there's nothing saved, in which case every field below falls back
  // to its hardcoded default and the app opens on the "New" tab.
  const [initial] = useState(() => loadInitialState())

  const [mode, setMode] = useState<ViewMode>(initial ? 'edit' : 'new')

  // "New" tab picker: how to generate a shape. Purely a recipe for the live preview below -
  // once a pick is committed (see handleModeChange), only the resulting vertex/face/edge data
  // matters, so none of this is persisted.
  const [shape, setShape] = useState<ShapeType>(DEFAULT_SHAPE)
  const [axis, setAxis] = useState<AxisType>(DEFAULT_AXIS)
  const [subdivisions, setSubdivisions] = useState(DEFAULT_SUBDIVISIONS)
  const [diameter, setDiameter] = useState(DEFAULT_DIAMETER_MM)
  const [shapeDirty, setShapeDirty] = useState(false)

  const previewData = useMemo(
    () => computePolyhedron(shape, axis, subdivisions, diameter),
    [shape, axis, subdivisions, diameter],
  )

  // Applies a "New" tab pick and keeps the layer count defaulted to half the resulting layers,
  // same as the shape itself would suggest.
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
    setShapeDirty(true)
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

  // The committed geometry actually being edited/previewed - vertices, faces, and edges, plain
  // and concrete. Only changes when a "New" tab pick is committed (or a config is loaded).
  const [baseData, setBaseData] = useState<PolyhedronData>(initial?.baseData ?? DEFAULT_BASE_DATA)

  const [layerCount, setLayerCount] = useState(
    initial?.layerCount ?? Math.ceil(DEFAULT_BASE_DATA.layers.length / 2),
  )
  const [selectionMode, setSelectionMode] = useState<SelectionMode>(
    initial?.selectionMode ?? 'symmetric',
  )

  const [selectedVertexIndices, setSelectedVertexIndices] = useState<Set<number>>(new Set())
  const [deletedGroups, setDeletedGroups] = useState<number[][]>(initial?.deletedGroups ?? [])
  const [redoStack, setRedoStack] = useState<number[][]>([])
  const [vertexTransforms, setVertexTransforms] = useState<Map<number, VertexTransform>>(
    new Map(initial?.vertexTransforms ?? []),
  )
  const [addedVertices, setAddedVertices] = useState<Map<number, THREE.Vector3>>(
    new Map(initial?.addedVertices ?? []),
  )
  const [addedFaces, setAddedFaces] = useState<Face[]>(initial?.addedFaces ?? [])
  const [nextAddedVertexId, setNextAddedVertexId] = useState(initial?.nextAddedVertexId ?? -1)

  // Sphere center: a fixed point on the main axis (x = 0, radius = 0), at this height in mm.
  const [centerZ, setCenterZ] = useState(initial?.centerZ ?? DEFAULT_CENTER_Z)
  const [edgeSegments, setEdgeSegments] = useState(initial?.edgeSegments ?? DEFAULT_EDGE_SEGMENTS)
  const [extrudeDistance, setExtrudeDistance] = useState(
    initial?.extrudeDistance ?? DEFAULT_EXTRUDE_DISTANCE,
  )
  const [thickness, setThickness] = useState(initial?.thickness ?? DEFAULT_THICKNESS)
  const [cornerLength, setCornerLength] = useState(initial?.cornerLength ?? DEFAULT_CORNER_LENGTH)

  const data = baseData

  const transformedVertices = useMemo(
    () => applyVertexTransforms(data.vertices, vertexTransforms),
    [data.vertices, vertexTransforms],
  )

  // addedVertices holds each added point's default (as-created) position; transforms are
  // layered on top the same way they are for canonical vertices.
  const transformedAddedVertices = useMemo(
    () => applyAddedVertexTransforms(addedVertices, vertexTransforms),
    [addedVertices, vertexTransforms],
  )

  const centerY = centerZ

  const deletedVertexIndices = useMemo(() => new Set(deletedGroups.flat()), [deletedGroups])

  const handleVertexClick = (index: number) => {
    if (mode !== 'edit' || deletedVertexIndices.has(index)) return

    // Grouping is always done against base (untransformed) positions, canonical vertices
    // and added ones alike, so it stays stable regardless of any transform edits.
    const positionOf = (id: number) => resolveVertexPosition(id, data.vertices, addedVertices)
    const candidateIds = [
      ...data.vertices.map((_, i) => i),
      ...Array.from(addedVertices.keys()),
    ]

    let group: number[]
    if (selectionMode === 'layer') {
      group = findLayerGroup(index, candidateIds, positionOf)
    } else if (selectionMode === 'symmetric') {
      // The "New" tab's shape/axis choice no longer describes committed geometry after edits,
      // but it's still the best guess we have for the model's rotational symmetry.
      const fold = SHAPE_AXES[shape].find((opt) => opt.value === axis)!.fold
      group = findRotationalSymmetryGroup(index, candidateIds, positionOf, fold)
    } else {
      group = [index]
    }

    setSelectedVertexIndices((prev) => {
      const next = new Set(prev)
      const allSelected = group.every((i) => next.has(i))
      for (const i of group) {
        if (allSelected) next.delete(i)
        else next.add(i)
      }
      return next
    })
  }

  const handleDeleteSelected = () => {
    if (selectedVertexIndices.size === 0) return
    setDeletedGroups([...deletedGroups, Array.from(selectedVertexIndices)])
    setRedoStack([])
    setSelectedVertexIndices(new Set())
  }

  const handleUndo = () => {
    if (deletedGroups.length === 0) return
    const last = deletedGroups[deletedGroups.length - 1]
    setDeletedGroups(deletedGroups.slice(0, -1))
    setRedoStack([...redoStack, last])
  }

  const handleRedo = () => {
    if (redoStack.length === 0) return
    const last = redoStack[redoStack.length - 1]
    setRedoStack(redoStack.slice(0, -1))
    setDeletedGroups([...deletedGroups, last])
  }

  const handleDeselectAll = () => {
    setSelectedVertexIndices(new Set())
  }

  const handleCancelAll = () => {
    setDeletedGroups([])
    setRedoStack([])
    setSelectedVertexIndices(new Set())
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

  const canAddPoints = selectedVertexIndices.size > 0 && selectedVertexIndices.size % 2 === 0

  const handleAddPoints = () => {
    if (!canAddPoints) return
    const positionOf = (index: number) =>
      resolveVertexPosition(index, transformedVertices, transformedAddedVertices)
    const { vertices, faces, nextId } = buildAddedGeometry(
      Array.from(selectedVertexIndices),
      positionOf,
      nextAddedVertexId,
    )
    setAddedVertices((prev) => new Map([...prev, ...vertices]))
    setAddedFaces((prev) => [...prev, ...faces])
    setNextAddedVertexId(nextId)
    setSelectedVertexIndices(new Set())
  }

  // Snaps every (non-deleted) vertex onto the sphere of the given diameter around the gravity
  // center, moving each vertex along its own ray from that center out to that fixed radius,
  // replacing any transform it already had.
  const handleAdjustToSphere = () => {
    const canonicalIds = data.vertices.map((_, i) => i).filter((i) => !deletedVertexIndices.has(i))
    const addedIds = Array.from(addedVertices.keys()).filter((id) => !deletedVertexIndices.has(id))
    const allIds = [...canonicalIds, ...addedIds]
    if (allIds.length === 0) return

    const currentPositionOf = (id: number) =>
      resolveVertexPosition(id, transformedVertices, transformedAddedVertices)
    const canonicalPositionOf = (id: number) =>
      id >= 0 ? data.vertices[id] : addedVertices.get(id)!

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

  // Lowers (or raises) the gravity center so it sits at the same height as the currently
  // visible model's lowest vertex - i.e. the dome's base rests exactly on the center's plane.
  const handleGroundCenter = () => {
    const visibleIds = computeVisibleVertexIds(
      data,
      transformedVertices,
      layerCount,
      deletedVertexIndices,
      addedFaces,
    )
    if (visibleIds.length === 0) return
    const positionOf = (id: number) => resolveVertexPosition(id, transformedVertices, transformedAddedVertices)
    const minY = visibleIds.reduce(
      (min, id) => Math.min(min, positionOf(id).y),
      Infinity,
    )
    setCenterZ(minY)
  }

  // Leaving "New" with a shape actually picked commits it as the geometry to edit, discarding
  // whatever was being edited before (its vertex indices no longer mean anything against the
  // new shape) and resetting every other tab's settings (center, edge curvature, ...) back to
  // their defaults, since they were tuned for a dome that no longer exists. Just passing
  // through "New" without touching its controls leaves everything as it was - e.g. a config
  // loaded from disk stays untouched if you only glance at the tab.
  const handleModeChange = (newMode: ViewMode) => {
    if (mode === 'new' && newMode !== 'new' && shapeDirty) {
      setBaseData(previewData)
      setDeletedGroups([])
      setRedoStack([])
      setVertexTransforms(new Map())
      setAddedVertices(new Map())
      setAddedFaces([])
      setNextAddedVertexId(-1)
      setSelectedVertexIndices(new Set())
      setCenterZ(DEFAULT_CENTER_Z)
      setEdgeSegments(DEFAULT_EDGE_SEGMENTS)
      setExtrudeDistance(DEFAULT_EXTRUDE_DISTANCE)
      setThickness(DEFAULT_THICKNESS)
      setCornerLength(DEFAULT_CORNER_LENGTH)
      setShapeDirty(false)
    }
    setMode(newMode)
  }

  const applyConfig = (state: DomeState) => {
    setBaseData(state.baseData)
    setLayerCount(state.layerCount)
    setSelectionMode(state.selectionMode)
    setCenterZ(state.centerZ)
    setEdgeSegments(state.edgeSegments)
    setExtrudeDistance(state.extrudeDistance)
    setThickness(state.thickness)
    setCornerLength(state.cornerLength)
    setDeletedGroups(state.deletedGroups)
    setRedoStack([])
    setVertexTransforms(new Map(state.vertexTransforms))
    setAddedVertices(new Map(state.addedVertices))
    setAddedFaces(state.addedFaces)
    setNextAddedVertexId(state.nextAddedVertexId)
    setSelectedVertexIndices(new Set())
    setShapeDirty(false)
    setMode('edit')
  }

  const buildConfig = (): DomeConfig =>
    serializeConfig({
      baseData,
      layerCount,
      selectionMode,
      centerZ,
      edgeSegments,
      extrudeDistance,
      thickness,
      cornerLength,
      deletedGroups,
      vertexTransforms,
      addedVertices,
      addedFaces,
      nextAddedVertexId,
    })

  // Auto-save on every change to any config field, so the next page load can restore it.
  useEffect(() => {
    saveConfigToLocalStorage(buildConfig())
  }, [
    baseData,
    layerCount,
    selectionMode,
    centerZ,
    edgeSegments,
    extrudeDistance,
    thickness,
    cornerLength,
    deletedGroups,
    vertexTransforms,
    addedVertices,
    addedFaces,
    nextAddedVertexId,
  ])

  const handleExportConfig = () => {
    downloadConfigAsJson(buildConfig())
  }

  const handleImportConfig = async (file: File) => {
    const config = await readConfigFromFile(file)
    applyConfig(deserializeConfig(config))
  }

  const isNew = mode === 'new'

  return (
    <div className="app">
      <Sidebar
        onExportConfig={handleExportConfig}
        onImportConfig={handleImportConfig}
        mode={mode}
        onModeChange={handleModeChange}
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
        selectionMode={selectionMode}
        onSelectionModeChange={setSelectionMode}
        selectedCount={selectedVertexIndices.size}
        selectedVertexIndices={selectedVertexIndices}
        vertexTransforms={vertexTransforms}
        onTransformChange={handleTransformChange}
        onResetTransform={handleResetTransform}
        canAddPoints={canAddPoints}
        onAddPoints={handleAddPoints}
        onAdjustToSphere={handleAdjustToSphere}
        centerZ={centerZ}
        onCenterZChange={setCenterZ}
        onGroundCenter={handleGroundCenter}
        edgeSegments={edgeSegments}
        onEdgeSegmentsChange={setEdgeSegments}
        extrudeDistance={extrudeDistance}
        onExtrudeDistanceChange={setExtrudeDistance}
        thickness={thickness}
        onThicknessChange={setThickness}
        cornerLength={cornerLength}
        onCornerLengthChange={setCornerLength}
        canUndo={deletedGroups.length > 0}
        canRedo={redoStack.length > 0}
        onDeleteSelected={handleDeleteSelected}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onCancelAll={handleCancelAll}
      />
      <Viewport
        mode={mode}
        data={isNew ? previewData : data}
        layerCount={layerCount}
        transformedVertices={isNew ? previewData.vertices : transformedVertices}
        deletedVertexIndices={isNew ? EMPTY_INDEX_SET : deletedVertexIndices}
        selectedVertexIndices={isNew ? EMPTY_INDEX_SET : selectedVertexIndices}
        addedVertices={isNew ? EMPTY_VERTEX_MAP : transformedAddedVertices}
        addedFaces={isNew ? EMPTY_FACES : addedFaces}
        centerY={centerY}
        edgeSegments={edgeSegments}
        extrudeDistance={extrudeDistance}
        thickness={thickness}
        cornerLength={cornerLength}
        onVertexClick={handleVertexClick}
        onDeselectAll={handleDeselectAll}
      />
    </div>
  )
}

export default App
