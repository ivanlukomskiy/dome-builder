import { useEffect, useMemo, useState } from 'react'
import type { AxisType, ShapeType } from './lib/polyhedra'
import { computePolyhedron } from './lib/polyhedra'
import { Sidebar } from './components/Sidebar'
import { Viewport } from './components/Viewport'

function App() {
  const [shape, setShape] = useState<ShapeType>('icosahedron')
  const [axis, setAxis] = useState<AxisType>('vertex')
  const [subdivisions, setSubdivisions] = useState(1)
  const [layerCount, setLayerCount] = useState(4)

  const data = useMemo(
    () => computePolyhedron(shape, axis, subdivisions),
    [shape, axis, subdivisions],
  )

  // Default to showing the full shape whenever the shape/axis choice changes.
  useEffect(() => {
    setLayerCount(data.layers.length)
  }, [data])

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
      />
      <Viewport data={data} layerCount={layerCount} />
    </div>
  )
}

export default App
