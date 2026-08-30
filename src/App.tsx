import { useEffect, useMemo, useState } from 'react'
import type * as THREE from 'three'
import type { AxisType, Face, SelectionMode, ShapeType, VertexTransform } from './lib/polyhedra'
import {
  applyAddedVertexTransforms,
  applyVertexTransforms,
  buildAddedGeometry,
  computeModelExtent,
  computePolyhedron,
  computeTransformToPosition,
  computeVisibleVertexIds,
  DEFAULT_VERTEX_TRANSFORM,
  findLayerGroup,
  findRotationalSymmetryGroup,
  isDefaultVertexTransform,
  resolveVertexPosition,
  scaleToRadius,
  SHAPE_AXES,
  sphereRadius,
} from './lib/polyhedra'
import { Sidebar } from './components/Sidebar'
import { Viewport } from './components/Viewport'

export type ViewMode = 'edit' | 'preview'

function App() {
  const [mode, setMode] = useState<ViewMode>('edit')
  const [shape, setShape] = useState<ShapeType>('octahedron')
  const [axis, setAxis] = useState<AxisType>('vertex')
  const [subdivisions, setSubdivisions] = useState(3)
  const [layerCount, setLayerCount] = useState(2)
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('symmetric')

  const [selectedVertexIndices, setSelectedVertexIndices] = useState<Set<number>>(new Set())
  const [deletedGroups, setDeletedGroups] = useState<number[][]>([])
  const [redoStack, setRedoStack] = useState<number[][]>([])
  const [vertexTransforms, setVertexTransforms] = useState<Map<number, VertexTransform>>(
    new Map(),
  )
  const [addedVertices, setAddedVertices] = useState<Map<number, THREE.Vector3>>(new Map())
  const [addedFaces, setAddedFaces] = useState<Face[]>([])
  const [nextAddedVertexId, setNextAddedVertexId] = useState(-1)

  // Sphere center: a fixed point on the main axis (x = 0, radius = 0), at a height given as a
  // fraction of the model's total height, offset from the model's vertical center.
  const [centerZ, setCenterZ] = useState(0)
  const [edgeSegments, setEdgeSegments] = useState(8)
  const [extrudeDistance, setExtrudeDistance] = useState(0.05)
  const [thickness, setThickness] = useState(0.03)
  const [cornerLength, setCornerLength] = useState(0.15)

  const data = useMemo(
    () => computePolyhedron(shape, axis, subdivisions),
    [shape, axis, subdivisions],
  )

  const transformedVertices = useMemo(
    () => applyVertexTransforms(data.vertices, vertexTransforms),
    [data.vertices, vertexTransforms],
  )

  // addedVertices holds each added point's default (as-created) position; transforms are
  // layered on top the same way they are for canonical vertices.
  const transformedAddedVertices = useMemo(
    () => applyAddedVertexTransforms(addedVertices, data.vertices, vertexTransforms),
    [addedVertices, data.vertices, vertexTransforms],
  )

  const modelExtent = useMemo(() => computeModelExtent(data.vertices), [data.vertices])
  const centerY = centerZ * modelExtent.totalHeight

  // Default to showing half the layers (rounded up) whenever the shape/axis/subdivision choice changes.
  useEffect(() => {
    setLayerCount(Math.ceil(data.layers.length / 2))
  }, [data])

  // Vertex-deletion, transform, and added-geometry edits only make sense for the dome config
  // they were made against.
  useEffect(() => {
    setSelectedVertexIndices(new Set())
    setDeletedGroups([])
    setRedoStack([])
    setVertexTransforms(new Map())
    setAddedVertices(new Map())
    setAddedFaces([])
    setNextAddedVertexId(-1)
  }, [shape, axis, subdivisions, layerCount])

  const deletedVertexIndices = useMemo(() => new Set(deletedGroups.flat()), [deletedGroups])

  const handleVertexClick = (index: number) => {
    if (deletedVertexIndices.has(index)) return

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

  // Snaps every (non-deleted) vertex onto a common sphere around the gravity center: first the
  // mean of everyone's current distance from that center, then each vertex is moved along its
  // own ray from the center out to that mean distance, replacing any transform it already had.
  const handleAdjustToSphere = () => {
    const canonicalIds = data.vertices.map((_, i) => i).filter((i) => !deletedVertexIndices.has(i))
    const addedIds = Array.from(addedVertices.keys()).filter((id) => !deletedVertexIndices.has(id))
    const allIds = [...canonicalIds, ...addedIds]
    if (allIds.length === 0) return

    const currentPositionOf = (id: number) =>
      resolveVertexPosition(id, transformedVertices, transformedAddedVertices)
    const canonicalPositionOf = (id: number) =>
      id >= 0 ? data.vertices[id] : addedVertices.get(id)!

    const meanRadius =
      allIds.reduce((sum, id) => sum + sphereRadius(currentPositionOf(id), centerY), 0) /
      allIds.length

    setVertexTransforms((prev) => {
      const next = new Map(prev)
      for (const id of allIds) {
        const current = currentPositionOf(id)
        const target = scaleToRadius(current.x, current.y, current.z, centerY, meanRadius)
        const t = computeTransformToPosition(canonicalPositionOf(id), target, modelExtent)
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
    setCenterZ(modelExtent.totalHeight > 0 ? minY / modelExtent.totalHeight : 0)
  }

  return (
    <div className="app">
      <Sidebar
        mode={mode}
        onModeChange={setMode}
        shape={shape}
        onShapeChange={setShape}
        axis={axis}
        onAxisChange={setAxis}
        subdivisions={subdivisions}
        onSubdivisionsChange={setSubdivisions}
        layerCount={layerCount}
        onLayerCountChange={setLayerCount}
        data={data}
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
        data={data}
        layerCount={layerCount}
        transformedVertices={transformedVertices}
        deletedVertexIndices={deletedVertexIndices}
        selectedVertexIndices={selectedVertexIndices}
        addedVertices={transformedAddedVertices}
        addedFaces={addedFaces}
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
