import { useEffect, useState } from 'react'
import { NumberField } from '../components/Sidebar'
import type { StrutMesh } from '../lib/replicadCad'
import { StrutShapeScene, type StrutShapeViewport } from './StrutShapeScene'

interface FootDebugParams {
  length: number
  thickness: number
  grooveLength: number
  holeOffset: number
  tipOffset: number
  holeDiameter: number
  straightLength: number
  chamferLength: number
}

interface Params {
  foot: FootDebugParams
  strutWidth: number
  flangeThickness: number
}

const DEFAULT_PARAMS: Params = {
  foot: {
    length: 50,
    thickness: 10,
    grooveLength: 20,
    holeOffset: 20,
    tipOffset: 20,
    holeDiameter: 8,
    straightLength: 40,
    chamferLength: 4,
  },
  strutWidth: 125,
  flangeThickness: 30,
}

const PARAMS_STORAGE_KEY = 'foot-shape-debug:params'
const VIEWPORT_STORAGE_KEY = 'foot-shape-debug:viewport'

function loadParams(): Params {
  try {
    const raw = localStorage.getItem(PARAMS_STORAGE_KEY)
    if (!raw) return DEFAULT_PARAMS
    const parsed = JSON.parse(raw) as Partial<Params>
    return {
      ...DEFAULT_PARAMS,
      ...parsed,
      foot: { ...DEFAULT_PARAMS.foot, ...parsed.foot },
    }
  } catch {
    return DEFAULT_PARAMS
  }
}

function loadViewport(): StrutShapeViewport | null {
  try {
    const raw = localStorage.getItem(VIEWPORT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StrutShapeViewport> | null
    if (!parsed || typeof parsed.distance !== 'number' || !Array.isArray(parsed.target) || parsed.target.length !== 3) {
      return null
    }
    return parsed as StrutShapeViewport
  } catch {
    return null
  }
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; main: StrutMesh | null }
  | { status: 'empty' }
  | { status: 'error'; message: string }

export function FootShapeDebug() {
  const [params, setParams] = useState<Params>(loadParams)
  const setFoot = (field: keyof FootDebugParams) => (value: number) =>
    setParams((prev) => ({ ...prev, foot: { ...prev.foot, [field]: value } }))
  const setParam = (field: keyof Omit<Params, 'foot'>) => (value: number) =>
    setParams((prev) => ({ ...prev, [field]: value }))

  const [state, setState] = useState<State>({ status: 'loading' })
  const [initialViewport, setInitialViewport] = useState<StrutShapeViewport | null>(loadViewport)
  const [viewportResetCount, setViewportResetCount] = useState(0)

  useEffect(() => {
    localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(params))
  }, [params])

  const handleViewportChange = (viewport: StrutShapeViewport) => {
    localStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify(viewport))
  }

  const handleReset = () => {
    setParams(DEFAULT_PARAMS)
    setInitialViewport(null)
    localStorage.removeItem(VIEWPORT_STORAGE_KEY)
    setViewportResetCount((n) => n + 1)
  }

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    ;(async () => {
      try {
        const [{ ensureReplicadReady, meshDrawing }, { computeFootPartBoundary2D }] = await Promise.all([
          import('../lib/replicadCad'),
          import('../lib/footGeometry'),
        ])
        await ensureReplicadReady()
        if (cancelled) return

        const result = computeFootPartBoundary2D(params.foot, params.strutWidth, params.flangeThickness)
        const main = result.main ? meshDrawing(result.main) : null
        if (cancelled) return

        setState(main ? { status: 'ready', main } : { status: 'empty' })
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
        <h1>Foot Shape Debug</h1>
        <div className="button-row">
          <a href={import.meta.env.BASE_URL}>&larr; Back to builder</a>
        </div>
        <div className="button-row">
          <button type="button" onClick={handleReset}>
            Reset to defaults
          </button>
        </div>
        <p className="hint">
          Renders the separate foot part from <code>computeFootPartBoundary2D</code>.
        </p>

        <section className="control-group">
          <h2>Foot</h2>
          <div className="transform-field">
            <label>Foot length (mm)</label>
            <NumberField value={params.foot.length} step={1} min={0} onCommit={setFoot('length')} />
          </div>
          <div className="transform-field">
            <label>Foot thickness (mm)</label>
            <NumberField value={params.foot.thickness} step={1} min={0} onCommit={setFoot('thickness')} />
          </div>
          <div className="transform-field">
            <label>Foot groove length (mm)</label>
            <NumberField value={params.foot.grooveLength} step={1} min={0} onCommit={setFoot('grooveLength')} />
          </div>
          <div className="transform-field">
            <label>Foot hole offset (mm)</label>
            <NumberField value={params.foot.holeOffset} step={1} min={0} onCommit={setFoot('holeOffset')} />
          </div>
          <div className="transform-field">
            <label>Foot tip offset (mm)</label>
            <NumberField value={params.foot.tipOffset} step={1} min={0} onCommit={setFoot('tipOffset')} />
          </div>
          <div className="transform-field">
            <label>Foot hole diameter (mm)</label>
            <NumberField value={params.foot.holeDiameter} step={1} min={0} onCommit={setFoot('holeDiameter')} />
          </div>
          <div className="transform-field">
            <label>Foot straight length (mm)</label>
            <NumberField value={params.foot.straightLength} step={1} min={0} onCommit={setFoot('straightLength')} />
          </div>
          <div className="transform-field">
            <label>Foot chamfer length (mm)</label>
            <NumberField value={params.foot.chamferLength} step={1} min={0} onCommit={setFoot('chamferLength')} />
          </div>
        </section>

        <section className="control-group">
          <h2>Assembly</h2>
          <div className="transform-field">
            <label>Strut width (mm)</label>
            <NumberField value={params.strutWidth} step={5} min={0} onCommit={setParam('strutWidth')} />
          </div>
          <div className="transform-field">
            <label>Flange thickness (mm)</label>
            <NumberField value={params.flangeThickness} step={1} min={0} onCommit={setParam('flangeThickness')} />
          </div>
        </section>
      </aside>
      <div className="viewport">
        {state.status === 'ready' && (
          <StrutShapeScene
            key={viewportResetCount}
            main={state.main}
            helpers={[]}
            initialViewport={initialViewport}
            onViewportChange={handleViewportChange}
          />
        )}
        {state.status === 'loading' && <div className="hud">Loading CAD engine...</div>}
        {state.status === 'empty' && <div className="hud">computeFootPartBoundary2D returned nothing to show.</div>}
        {state.status === 'error' && (
          <div className="hud" style={{ color: '#ff6b6b', maxWidth: 420, textAlign: 'right' }}>
            computeFootPartBoundary2D threw:
            <br />
            {state.message}
          </div>
        )}
      </div>
    </div>
  )
}
