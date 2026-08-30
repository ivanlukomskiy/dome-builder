import { useEffect, useMemo, useState } from 'react'
import type * as THREE from 'three'
import type { AxisType, Face, SelectionMode, ShapeType, VertexTransform } from './lib/polyhedra'
import {
  applyAddedVertexTransforms,
  applyVertexTransforms,
  buildAddedGeometry,
  computePolyhedron,
  DEFAULT_VERTEX_TRANSFORM,
  findLayerGroup,
  findRotationalSymmetryGroup,
  isDefaultVertexTransform,
  resolveVertexPosition,
  SHAPE_AXES,
} from './lib/polyhedra'
import { Sidebar } from './components/Sidebar'
import { Viewport } from './components/Viewport'

function App() {
  const [shape, setShape] = useState<ShapeType>('octahedron')
  const [axis, setAxis] = useState<AxisType>('vertex')
  const [subdivisions, setSubdivisions] = useState(3)
  const [layerCount, setLayerCount] = useState(2)
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('point')

  const [selectedVertexIndices, setSelectedVertexIndices] = useState<Set<number>>(new Set())
  const [deletedGroups, setDeletedGroups] = useState<number[][]>([])
  const [redoStack, setRedoStack] = useState<number[][]>([])
  const [vertexTransforms, setVertexTransforms] = useState<Map<number, VertexTransform>>(
    new Map(),
  )
  const [addedVertices, setAddedVertices] = useState<Map<number, THREE.Vector3>>(new Map())
  const [addedFaces, setAddedFaces] = useState<Face[]>([])
  const [nextAddedVertexId, setNextAddedVertexId] = useState(-1)

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

    // Added vertices don't belong to a layer or symmetry group - always a plain toggle.
    if (index < 0) {
      setSelectedVertexIndices((prev) => {
        const next = new Set(prev)
        if (next.has(index)) next.delete(index)
        else next.add(index)
        return next
      })
      return
    }

    let group: number[]
    if (selectionMode === 'layer') {
      group = findLayerGroup(data, index)
    } else if (selectionMode === 'symmetric') {
      const fold = SHAPE_AXES[shape].find((opt) => opt.value === axis)!.fold
      group = findRotationalSymmetryGroup(data, fold, index)
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

  return (
    <div className="app">
      <Sidebar
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
        canUndo={deletedGroups.length > 0}
        canRedo={redoStack.length > 0}
        onDeleteSelected={handleDeleteSelected}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onCancelAll={handleCancelAll}
      />
      <Viewport
        data={data}
        layerCount={layerCount}
        transformedVertices={transformedVertices}
        deletedVertexIndices={deletedVertexIndices}
        selectedVertexIndices={selectedVertexIndices}
        addedVertices={transformedAddedVertices}
        addedFaces={addedFaces}
        onVertexClick={handleVertexClick}
        onDeselectAll={handleDeselectAll}
      />
    </div>
  )
}

export default App
