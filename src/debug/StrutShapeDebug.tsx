import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { NumberField } from '../components/Sidebar'
import type { StrutMesh } from '../lib/replicadCad'
import { StrutShapeScene } from './StrutShapeScene'

const DEG2RAD = Math.PI / 180

interface Params {
  offset1: number
  offset2: number
  width: number
  cornerLength: number
  radius: number
  angleDeg: number
  endGrooveLength: number
  midGrooveLength: number
  grooveDepth: number
  millingDiameter: number
  chamferLength: number
}

const DEFAULT_PARAMS: Params = {
  offset1: 100,
  offset2: 100,
  width: 125,
  cornerLength: 375,
  radius: 2500,
  angleDeg: 60,
  endGrooveLength: 75,
  midGrooveLength: 90,
  grooveDepth: 20,
  millingDiameter: 8,
  chamferLength: 6,
}

interface HelperMesh {
  mesh: StrutMesh
  color: string
  name: string
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; main: StrutMesh | null; helpers: HelperMesh[] }
  | { status: 'empty' }
  | { status: 'error'; message: string }

// Companion to EdgeSketchDebug, but wired to `computeStrutBoundaryManual` in
// strutGeometryManual.ts - a sandbox for hand-building the strut sketch directly with replicad's
// own draw()/boolean-op primitives instead of trusting the existing Vec2 math to get it right.
// Reachable via `npm run strut-shape-debug`, which opens straight here. Edit
// strutGeometryManual.ts, save, and this page (auto-reloaded by Vite) shows the resulting shape -
// including a clear error message if your function throws, which is expected to happen a lot
// while iterating.
export function StrutShapeDebug() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS)
  const setParam = (field: keyof Params) => (value: number) => setParams((prev) => ({ ...prev, [field]: value }))
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    ;(async () => {
      try {
        const [{ ensureReplicadReady, meshDrawing }, { computeStrutBoundaryManual }] = await Promise.all([
          import('../lib/replicadCad'),
          import('../lib/strutGeometryManual'),
        ])
        await ensureReplicadReady()
        if (cancelled) return

        const {
          radius,
          angleDeg,
          offset1,
          offset2,
          cornerLength,
          width,
          endGrooveLength,
          midGrooveLength,
          grooveDepth,
          millingDiameter,
          chamferLength,
        } = params
        const center = new THREE.Vector3(0, 0, 0)
        const angleRad = angleDeg * DEG2RAD
        const a = new THREE.Vector3(radius, 0, 0)
        const b = new THREE.Vector3(radius * Math.cos(angleRad), radius * Math.sin(angleRad), 0)

        const result = computeStrutBoundaryManual(
          a,
          b,
          center,
          offset1,
          offset2,
          cornerLength,
          width / 2,
          endGrooveLength,
          midGrooveLength,
          grooveDepth,
          millingDiameter,
          chamferLength,
        )
        if (cancelled) return

        const main = result.main ? meshDrawing(result.main) : null
        const helpers: HelperMesh[] = []
        for (const helper of result.helpers) {
          const mesh = meshDrawing(helper.drawing)
          if (mesh) helpers.push({ mesh, color: helper.color, name: helper.name })
        }
        if (cancelled) return

        setState(main || helpers.length > 0 ? { status: 'ready', main, helpers } : { status: 'empty' })
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [params])

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Strut Shape Debug</h1>
        <div className="button-row">
          <a href={import.meta.env.BASE_URL}>&larr; Back to builder</a>
        </div>
        <p className="hint">
          Renders whatever <code>computeStrutBoundaryManual</code> in{' '}
          <code>src/lib/strutGeometryManual.ts</code> returns. Edit that file and save - this page
          reloads automatically.
        </p>

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
          <h2>Grooves</h2>
          <div className="transform-field">
            <label>End groove length (mm)</label>
            <NumberField value={params.endGrooveLength} step={5} min={0} onCommit={setParam('endGrooveLength')} />
          </div>
          <div className="transform-field">
            <label>Mid groove length (mm)</label>
            <NumberField value={params.midGrooveLength} step={5} min={0} onCommit={setParam('midGrooveLength')} />
          </div>
          <div className="transform-field">
            <label>Groove depth (mm)</label>
            <NumberField value={params.grooveDepth} step={1} min={0} onCommit={setParam('grooveDepth')} />
          </div>
          <div className="transform-field">
            <label>Milling diameter (mm)</label>
            <NumberField value={params.millingDiameter} step={1} min={0} onCommit={setParam('millingDiameter')} />
          </div>
          <div className="transform-field">
            <label>Chamfer length (mm)</label>
            <NumberField value={params.chamferLength} step={1} min={0} onCommit={setParam('chamferLength')} />
          </div>
        </section>
      </aside>
      <div className="viewport">
        {state.status === 'ready' && <StrutShapeScene main={state.main} helpers={state.helpers} />}
        {state.status === 'loading' && <div className="hud">Loading CAD engine…</div>}
        {state.status === 'empty' && <div className="hud">computeStrutBoundaryManual returned nothing to show.</div>}
        {state.status === 'error' && (
          <div className="hud" style={{ color: '#ff6b6b', maxWidth: 420, textAlign: 'right' }}>
            computeStrutBoundaryManual threw:
            <br />
            {state.message}
          </div>
        )}
      </div>
    </div>
  )
}
