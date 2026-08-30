import { useEffect, useMemo, useState } from 'react'
import type { AxisType, ShapeType } from './lib/polyhedra'
import { computePolyhedron } from './lib/polyhedra'
import { Sidebar } from './components/Sidebar'
import { Viewport } from './components/Viewport'

function App() {
  const [shape, setShape] = useState<ShapeType>('icosahedron')
  const [axis, setAxis] = useState<AxisType>('vertex')
  const [subdivisions, setSubdivisions] = useState(2)
  const [layerCount, setLayerCount] = useState(2)

  const data = useMemo(
    () => computePolyhedron(shape, axis, subdivisions),
    [shape, axis, subdivisions],
  )

  // Default to showing half the layers (rounded up) whenever the shape/axis/subdivision choice changes.
  useEffect(() => {
    setLayerCount(Math.ceil(data.layers.length / 2))
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
