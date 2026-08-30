import { useEffect, useMemo, useState } from 'react'
import type { AxisType, SelectionMode, ShapeType } from './lib/polyhedra'
import {
  computePolyhedron,
  findLayerGroup,
  findRotationalSymmetryGroup,
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

  const data = useMemo(
    () => computePolyhedron(shape, axis, subdivisions),
    [shape, axis, subdivisions],
  )

  // Default to showing half the layers (rounded up) whenever the shape/axis/subdivision choice changes.
  useEffect(() => {
    setLayerCount(Math.ceil(data.layers.length / 2))
  }, [data])

  // Vertex-deletion edits only make sense for the dome config they were made against.
  useEffect(() => {
    setSelectedVertexIndices(new Set())
    setDeletedGroups([])
    setRedoStack([])
  }, [shape, axis, subdivisions, layerCount])

  const deletedVertexIndices = useMemo(() => new Set(deletedGroups.flat()), [deletedGroups])

  const handleVertexClick = (index: number) => {
    if (deletedVertexIndices.has(index)) return

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
        deletedVertexIndices={deletedVertexIndices}
        selectedVertexIndices={selectedVertexIndices}
        onVertexClick={handleVertexClick}
        onDeselectAll={handleDeselectAll}
      />
    </div>
  )
}

export default App
