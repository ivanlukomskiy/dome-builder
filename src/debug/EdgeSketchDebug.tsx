import { useMemo, useState } from 'react'
import * as THREE from 'three'
import { NumberField } from '../components/Sidebar'
import type { Vec2 } from '../lib/strutGeometry'
import { computeStrutBoundary } from '../lib/strutGeometry'
import { EdgeSketchScene } from './EdgeSketchScene'

const DEG2RAD = Math.PI / 180

interface Params {
  offset1: number
  offset2: number
  width: number
  cornerLength: number
  radius: number
  angleDeg: number
  toothHeight: number
  toothLength: number
  toothChamfer: number
  millRadius: number
}

const DEFAULT_PARAMS: Params = {
  offset1: 100,
  offset2: 100,
  width: 125,
  cornerLength: 375,
  radius: 2500,
  angleDeg: 60,
  toothHeight: 30,
  toothLength: 60,
  toothChamfer: 8,
  millRadius: 6,
}

export function EdgeSketchDebug() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS)
  const setParam = (field: keyof Params) => (value: number) => setParams((prev) => ({ ...prev, [field]: value }))

  const sketch = useMemo(() => {
    const { radius, angleDeg, offset1, offset2, cornerLength, width, toothHeight, toothLength, toothChamfer, millRadius } =
      params
    const center = new THREE.Vector3(0, 0, 0)
    const angleRad = angleDeg * DEG2RAD
    const a = new THREE.Vector3(radius, 0, 0)
    const b = new THREE.Vector3(radius * Math.cos(angleRad), radius * Math.sin(angleRad), 0)
    return computeStrutBoundary(a, b, center, offset1, offset2, cornerLength, width / 2, {
      height: toothHeight,
      length: toothLength,
      chamfer: toothChamfer,
      millRadius,
    })
  }, [params])

  // The local (u, v) coordinates of the two vertices are always exactly (radius, 0) and
  // (radius*cos(angle), radius*sin(angle)) - computeStrutPlane always aligns its xDir with
  // vertex A, so this needs no extra lookup into the sketch itself.
  const vertexA: Vec2 = [params.radius, 0]
  const vertexB: Vec2 = [params.radius * Math.cos(params.angleDeg * DEG2RAD), params.radius * Math.sin(params.angleDeg * DEG2RAD)]

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Edge Sketch Debug</h1>
        <div className="button-row">
          <a href={import.meta.env.BASE_URL}>&larr; Back to builder</a>
        </div>

        <section className="control-group">
          <h2>Vertex Placement</h2>
          <div className="transform-field">
            <label>Radius from center (mm)</label>
            <NumberField value={params.radius} step={50} min={1} onCommit={setParam('radius')} />
          </div>
          <div className="transform-field">
            <label>Angle between radiuses (deg)</label>
            <NumberField value={params.angleDeg} step={1} onCommit={setParam('angleDeg')} />
          </div>
        </section>

        <section className="control-group">
          <h2>Edge End Offsets</h2>
          <div className="transform-field">
            <label>Offset 1 (mm)</label>
            <NumberField value={params.offset1} step={5} min={0} onCommit={setParam('offset1')} />
          </div>
          <div className="transform-field">
            <label>Offset 2 (mm)</label>
            <NumberField value={params.offset2} step={5} min={0} onCommit={setParam('offset2')} />
          </div>
        </section>

        <section className="control-group">
          <h2>Strut Shape</h2>
          <div className="transform-field">
            <label>Width (mm)</label>
            <NumberField value={params.width} step={5} min={0} onCommit={setParam('width')} />
          </div>
          <div className="transform-field">
            <label>Corner length (mm)</label>
            <NumberField value={params.cornerLength} step={5} min={0} onCommit={setParam('cornerLength')} />
          </div>
        </section>

        <section className="control-group">
          <h2>Corner Teeth</h2>
          <div className="transform-field">
            <label>Tooth height (mm)</label>
            <NumberField value={params.toothHeight} step={5} min={0} onCommit={setParam('toothHeight')} />
          </div>
          <div className="transform-field">
            <label>Tooth length (mm)</label>
            <NumberField value={params.toothLength} step={5} min={0} onCommit={setParam('toothLength')} />
          </div>
          <div className="transform-field">
            <label>Chamfer length (mm)</label>
            <NumberField value={params.toothChamfer} step={1} min={0} onCommit={setParam('toothChamfer')} />
          </div>
          <div className="transform-field">
            <label>Mill radius (mm)</label>
            <NumberField value={params.millRadius} step={1} min={0} onCommit={setParam('millRadius')} />
          </div>
          <p className="hint">
            A tooth appears at each vertex end, on both the outer and inner boundary (mirrored
            across the centerline). 0 height turns it off. The mill radius sets a dogbone relief
            cut into the main line at each of the tooth's two concave base corners - the corner
            itself stays sharp, but a real round cutting bit can't reach all the way into it, so
            a semicircle is cut in just before, leaving room for a square mating part to seat
            flush.
          </p>
        </section>

        <section className="control-group">
          <h2>Legend</h2>
          <p className="hint" style={{ color: '#5b9bd5' }}>Boundary - the actual sketch outline</p>
          <p className="hint" style={{ color: '#f5a623' }}>Centerline - the trimmed, mitered main line</p>
          <p className="hint" style={{ color: '#2dd4bf' }}>Arc section - of either line above</p>
          <p className="hint" style={{ color: '#e0729f' }}>Offset line - vertex to where the centerline starts</p>
        </section>
      </aside>
      <div className="viewport">
        {sketch ? (
          <EdgeSketchScene
            boundary={sketch}
            centerline={sketch.centerline}
            vertexA={vertexA}
            vertexB={vertexB}
            radius={params.radius}
            angleDeg={params.angleDeg}
          />
        ) : (
          <div className="hud">Degenerate configuration - a vertex sits on the gravity center.</div>
        )}
      </div>
    </div>
  )
}
