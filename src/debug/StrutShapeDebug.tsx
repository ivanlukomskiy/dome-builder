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

interface HelperMesh {
  mesh: StrutMesh
  color: string
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

        const { radius, angleDeg, offset1, offset2, cornerLength, width, toothHeight, toothLength, toothChamfer, millRadius } =
          params
        const center = new THREE.Vector3(0, 0, 0)
        const angleRad = angleDeg * DEG2RAD
        const a = new THREE.Vector3(radius, 0, 0)
        const b = new THREE.Vector3(radius * Math.cos(angleRad), radius * Math.sin(angleRad), 0)

        const result = computeStrutBoundaryManual(a, b, center, offset1, offset2, cornerLength, width / 2, {
          height: toothHeight,
          length: toothLength,
          chamfer: toothChamfer,
          millRadius,
        })
        if (cancelled) return

        const main = result.main ? meshDrawing(result.main) : null
        const helpers: HelperMesh[] = []
        for (const helper of result.helpers) {
          const mesh = meshDrawing(helper.drawing)
          if (mesh) helpers.push({ mesh, color: helper.color })
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
