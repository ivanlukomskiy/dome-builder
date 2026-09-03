import { useEffect, useState } from 'react'
import { NumberField } from '../components/Sidebar'
import type { StrutMesh } from '../lib/replicadCad'
import { StrutShapeScene, type StrutShapeViewport } from './StrutShapeScene'

// Shared (non-per-edge) strut-shape knobs - same fields precalculateStrutEnd takes beyond each
// edge's own offset, see strutGeometryManual.ts.
interface SharedParams {
  cornerLength: number
  halfWidth: number
  endGrooveLengthPercent: number
  midGrooveLengthPercent: number
  grooveDepth: number
  millingDiameter: number
  chamferLength: number
}

// One row of the edited vertex's `edges` array - everything get_edges_info reports per edge,
// minus `strutEnd` itself (recomputed live from this edge's offsetMm plus the shared params
// above, so editing either stays consistent).
interface EdgeParams {
  edgeId: number
  neighborId: number
  thicknessMm: number
  offsetMm: number
  projectedAngleDeg: number
  hasFaceToNextEdge: boolean
  faceIdToNextEdge: number | null
}

// Matches FlangeShapeParams in flangeGeometry.ts - duplicated here (rather than imported)
// because that module's top-level `import ... from 'replicad'` is meant to stay behind the
// dynamic import() below, not load eagerly just for this page's own defaults.
interface FlangeParams {
  toleranceLongitudinal: number
  toleranceTransverse: number
  centerHoleDiameter: number
  sideHoleDiameter: number
  sideHoleDiameterOffset: number
  overshoot: number
  minSide: number
  millingDiameter: number
}

interface Params {
  vertexId: number
  edges: EdgeParams[]
  shared: SharedParams
  flange: FlangeParams
}

// Vertex 21 from a real "Get Edges Info" export (App.tsx's handleGetEdgesInfo) - the specific
// hub that crashes computeFlangeBoundary2D's replicad calls with a "memory access out of bounds"
// opencascade error (found via the one-vertex-per-worker debug logging in DomeMesh.tsx's preview
// build effect). `shared` is back-derived from this vertex's own `strutEnd` values (same
// cornerLength/halfWidth/groove/chamfer/milling numbers precalculateStrutEnd was given to produce
// them) - `flange`'s own tolerance/hole params aren't part of that export, so those are still
// just DEFAULT_FLANGE_SHAPE_PARAMS's values; tweak the Flange section below to match whatever
// they were actually set to when this crashed.
const DEFAULT_PARAMS: Params = {
  vertexId: 21,
  edges: [
    { edgeId: 44, neighborId: 11, thicknessMm: 75, offsetMm: 62.49210233276298, projectedAngleDeg: 39.310516226973846, hasFaceToNextEdge: false, faceIdToNextEdge: null },
    { edgeId: -5, neighborId: -3, thicknessMm: 75, offsetMm: 77.0553351884945, projectedAngleDeg: 224.540815554821, hasFaceToNextEdge: true, faceIdToNextEdge: -3 },
    { edgeId: 46, neighborId: 20, thicknessMm: 75, offsetMm: 77.0553351884945, projectedAngleDeg: 276.44178473718836, hasFaceToNextEdge: true, faceIdToNextEdge: 25 },
    { edgeId: 45, neighborId: 19, thicknessMm: 75, offsetMm: 63.74523960811312, projectedAngleDeg: 337.3766142915629, hasFaceToNextEdge: true, faceIdToNextEdge: 24 },
  ],
  shared: {
    cornerLength: 375,
    halfWidth: 62.5,
    endGrooveLengthPercent: 25,
    midGrooveLengthPercent: 35,
    grooveDepth: 20,
    millingDiameter: 8,
    chamferLength: 6,
  },
  flange: {
    toleranceLongitudinal: 0,
    toleranceTransverse: 0,
    centerHoleDiameter: 8,
    sideHoleDiameter: 4,
    sideHoleDiameterOffset: 6,
    overshoot: 2,
    minSide: 6,
    millingDiameter: 8,
  },
}

const NEW_EDGE: EdgeParams = {
  edgeId: -1,
  neighborId: -1,
  thicknessMm: 12,
  offsetMm: 9,
  projectedAngleDeg: 0,
  hasFaceToNextEdge: false,
  faceIdToNextEdge: null,
}

const DEFAULT_SHOW_HELPER_POINTS = true

// Persisted across reloads so tweaking params or the viewport doesn't get reset by Vite's HMR
// full-reloads (e.g. after editing flangeGeometry.ts) or a manual page refresh.
const PARAMS_STORAGE_KEY = 'flange-shape-debug:params'
const VIEWPORT_STORAGE_KEY = 'flange-shape-debug:viewport'

function loadParams(): Params {
  try {
    const raw = localStorage.getItem(PARAMS_STORAGE_KEY)
    if (!raw) return DEFAULT_PARAMS
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PARAMS
    const p = parsed as Partial<Params>
    // Merge `shared`/`flange` field-by-field (rather than a plain top-level spread) so a value
    // saved before a new field existed there doesn't blank it out - it falls back to that
    // field's own default instead.
    return {
      ...DEFAULT_PARAMS,
      ...p,
      shared: { ...DEFAULT_PARAMS.shared, ...p.shared },
      flange: { ...DEFAULT_PARAMS.flange, ...p.flange },
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

// Companion to StrutShapeDebug, but wired to `computeFlangeBoundary2D` in flangeGeometry.ts - a
// sandbox for hand-building the hub connector-plate sketch. Reachable via
// `npm run flange-shape-debug`, which opens straight here. Edit flangeGeometry.ts, save, and this
// page (auto-reloaded by Vite) shows the resulting shape - including a clear error message if
// your function throws, which is expected to happen a lot while iterating.
export function FlangeShapeDebug() {
  const [params, setParams] = useState<Params>(loadParams)
  const setShared = (field: keyof SharedParams) => (value: number) =>
    setParams((prev) => ({ ...prev, shared: { ...prev.shared, [field]: value } }))
  const setFlange = (field: keyof FlangeParams) => (value: number) =>
    setParams((prev) => ({ ...prev, flange: { ...prev.flange, [field]: value } }))
  const setEdgeField = <K extends keyof EdgeParams>(index: number, field: K) => (value: EdgeParams[K]) =>
    setParams((prev) => ({
      ...prev,
      edges: prev.edges.map((e, i) => (i === index ? { ...e, [field]: value } : e)),
    }))
  const addEdge = () => setParams((prev) => ({ ...prev, edges: [...prev.edges, { ...NEW_EDGE }] }))
  const removeEdge = (index: number) =>
    setParams((prev) => ({ ...prev, edges: prev.edges.filter((_, i) => i !== index) }))

  const [state, setState] = useState<State>({ status: 'loading' })
  const [showHelperPoints, setShowHelperPoints] = useState(DEFAULT_SHOW_HELPER_POINTS)
  const [initialViewport, setInitialViewport] = useState<StrutShapeViewport | null>(loadViewport)
  // Bumped on Reset to force StrutShapeScene to remount (via `key`) and re-fit the camera to the
  // shape, rather than reusing whatever pan/zoom it already settled into.
  const [viewportResetCount, setViewportResetCount] = useState(0)

  useEffect(() => {
    localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(params))
  }, [params])

  const handleViewportChange = (viewport: StrutShapeViewport) => {
    localStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify(viewport))
  }

  const handleReset = () => {
    setParams(DEFAULT_PARAMS)
    setShowHelperPoints(DEFAULT_SHOW_HELPER_POINTS)
    setInitialViewport(null)
    localStorage.removeItem(VIEWPORT_STORAGE_KEY)
    setViewportResetCount((n) => n + 1)
  }

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    ;(async () => {
      try {
        const [{ ensureReplicadReady, meshDrawing }, { precalculateStrutEnd }, { computeFlangeBoundary2D }] =
          await Promise.all([
            import('../lib/replicadCad'),
            import('../lib/strutGeometryManual'),
            import('../lib/flangeGeometry'),
          ])
        await ensureReplicadReady()
        if (cancelled) return

        const { shared, edges, vertexId } = params
        const n = edges.length
        const sorted = [...edges].sort((a, b) => a.projectedAngleDeg - b.projectedAngleDeg)
        const vertexInput = {
          vertexId,
          edges: sorted.map((edge, i) => {
            const next = sorted[(i + 1) % n]
            let angleToNextEdgeDeg = next.projectedAngleDeg - edge.projectedAngleDeg
            if (angleToNextEdgeDeg <= 0) angleToNextEdgeDeg += 360
            return {
              edgeId: edge.edgeId,
              neighborId: edge.neighborId,
              thicknessMm: edge.thicknessMm,
              offsetMm: edge.offsetMm,
              strutEnd: precalculateStrutEnd(
                edge.offsetMm,
                shared.cornerLength,
                shared.endGrooveLengthPercent,
                shared.midGrooveLengthPercent,
                shared.chamferLength,
                shared.millingDiameter,
                shared.grooveDepth,
                shared.halfWidth,
              ),
              projectedAngleDeg: edge.projectedAngleDeg,
              angleToNextEdgeDeg,
              hasFaceToNextEdge: edge.hasFaceToNextEdge,
              faceIdToNextEdge: edge.faceIdToNextEdge,
            }
          }),
        }

        const result = computeFlangeBoundary2D(vertexInput, params.flange)
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
        <h1>Flange Shape Debug</h1>
        <div className="button-row">
          <a href={import.meta.env.BASE_URL}>&larr; Back to builder</a>
        </div>
        <div className="button-row">
          <button type="button" onClick={handleReset}>
            Reset to defaults
          </button>
        </div>
        <p className="hint">
          Renders whatever <code>computeFlangeBoundary2D</code> in{' '}
          <code>src/lib/flangeGeometry.ts</code> returns for the vertex below. Edit that file and
          save - this page reloads automatically. Fields here match exactly what the main app's
          "Get Edges Info" (Preview mode) button exports per vertex, so you can paste a real
          vertex's data straight in.
        </p>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={showHelperPoints}
            onChange={(e) => setShowHelperPoints(e.target.checked)}
          />
          Show helper points
        </label>

        <section className="control-group">
          <h2>Vertex</h2>
          <div className="transform-field">
            <label>Vertex id</label>
            <NumberField
              value={params.vertexId}
              step={1}
              onCommit={(v) => setParams((prev) => ({ ...prev, vertexId: v }))}
            />
          </div>
        </section>

        <section className="control-group">
          <h2>Strut Shape (shared)</h2>
          <div className="transform-field">
            <label>Corner length (mm)</label>
            <NumberField value={params.shared.cornerLength} step={5} min={0} onCommit={setShared('cornerLength')} />
          </div>
          <div className="transform-field">
            <label>Half width (mm)</label>
            <NumberField value={params.shared.halfWidth} step={5} min={0} onCommit={setShared('halfWidth')} />
          </div>
          <div className="transform-field">
            <label>End groove length (%)</label>
            <NumberField
              value={params.shared.endGrooveLengthPercent}
              step={1}
              min={0}
              onCommit={setShared('endGrooveLengthPercent')}
            />
          </div>
          <div className="transform-field">
            <label>Mid groove length (%)</label>
            <NumberField
              value={params.shared.midGrooveLengthPercent}
              step={1}
              min={0}
              onCommit={setShared('midGrooveLengthPercent')}
            />
          </div>
          <div className="transform-field">
            <label>Groove depth (mm)</label>
            <NumberField value={params.shared.grooveDepth} step={1} min={0} onCommit={setShared('grooveDepth')} />
          </div>
          <div className="transform-field">
            <label>Milling diameter (mm)</label>
            <NumberField
              value={params.shared.millingDiameter}
              step={1}
              min={0}
              onCommit={setShared('millingDiameter')}
            />
          </div>
          <div className="transform-field">
            <label>Chamfer length (mm)</label>
            <NumberField value={params.shared.chamferLength} step={1} min={0} onCommit={setShared('chamferLength')} />
          </div>
        </section>

        <section className="control-group">
          <h2>Flange</h2>
          <div className="transform-field">
            <label>Tolerance longitudinal (mm)</label>
            <NumberField
              value={params.flange.toleranceLongitudinal}
              step={0.5}
              onCommit={setFlange('toleranceLongitudinal')}
            />
          </div>
          <div className="transform-field">
            <label>Tolerance transverse (mm)</label>
            <NumberField
              value={params.flange.toleranceTransverse}
              step={0.5}
              onCommit={setFlange('toleranceTransverse')}
            />
          </div>
          <div className="transform-field">
            <label>Center hole diameter (mm)</label>
            <NumberField
              value={params.flange.centerHoleDiameter}
              step={1}
              min={0}
              onCommit={setFlange('centerHoleDiameter')}
            />
          </div>
          <div className="transform-field">
            <label>Side hole diameter (mm)</label>
            <NumberField
              value={params.flange.sideHoleDiameter}
              step={1}
              min={0}
              onCommit={setFlange('sideHoleDiameter')}
            />
          </div>
          <div className="transform-field">
            <label>Side hole diameter offset (mm)</label>
            <NumberField
              value={params.flange.sideHoleDiameterOffset}
              step={1}
              min={0}
              onCommit={setFlange('sideHoleDiameterOffset')}
            />
          </div>
          <div className="transform-field">
            <label>Overshoot (mm)</label>
            <NumberField value={params.flange.overshoot} step={1} min={0} onCommit={setFlange('overshoot')} />
          </div>
          <div className="transform-field">
            <label>Min side (mm)</label>
            <NumberField value={params.flange.minSide} step={1} min={0} onCommit={setFlange('minSide')} />
          </div>
          <div className="transform-field">
            <label>Milling diameter (mm)</label>
            <NumberField
              value={params.flange.millingDiameter}
              step={1}
              min={0}
              onCommit={setFlange('millingDiameter')}
            />
          </div>
        </section>

        <section className="control-group">
          <h2>Edges</h2>
          {params.edges.map((edge, i) => (
            <div key={i} className="control-group">
              <div className="button-row">
                <strong>
                  Edge {edge.edgeId} &rarr; vertex {edge.neighborId}
                </strong>
                <button type="button" onClick={() => removeEdge(i)}>
                  Remove
                </button>
              </div>
              <div className="transform-field">
                <label>Edge id</label>
                <NumberField value={edge.edgeId} step={1} onCommit={setEdgeField(i, 'edgeId')} />
              </div>
              <div className="transform-field">
                <label>Neighbor vertex id</label>
                <NumberField value={edge.neighborId} step={1} onCommit={setEdgeField(i, 'neighborId')} />
              </div>
              <div className="transform-field">
                <label>Projected angle (deg)</label>
                <NumberField value={edge.projectedAngleDeg} step={5} onCommit={setEdgeField(i, 'projectedAngleDeg')} />
              </div>
              <div className="transform-field">
                <label>Offset (mm)</label>
                <NumberField value={edge.offsetMm} step={1} min={0} onCommit={setEdgeField(i, 'offsetMm')} />
              </div>
              <div className="transform-field">
                <label>Thickness (mm)</label>
                <NumberField value={edge.thicknessMm} step={1} min={0} onCommit={setEdgeField(i, 'thicknessMm')} />
              </div>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={edge.hasFaceToNextEdge}
                  onChange={(e) => setEdgeField(i, 'hasFaceToNextEdge')(e.target.checked)}
                />
                Face to next edge (angular order)
              </label>
            </div>
          ))}
          <div className="button-row">
            <button type="button" onClick={addEdge}>
              Add edge
            </button>
          </div>
          <p className="hint">
            Edges are sorted by projected angle before being handed to
            computeFlangeBoundary2D - "next edge" (for angleToNextEdgeDeg / face-to-next) always
            means the next one in that angular order, wrapping back to the first after the last.
          </p>
        </section>
      </aside>
      <div className="viewport">
        {state.status === 'ready' && (
          <StrutShapeScene
            key={viewportResetCount}
            main={state.main}
            helpers={showHelperPoints ? state.helpers : []}
            initialViewport={initialViewport}
            onViewportChange={handleViewportChange}
          />
        )}
        {state.status === 'loading' && <div className="hud">Loading CAD engine…</div>}
        {state.status === 'empty' && <div className="hud">computeFlangeBoundary2D returned nothing to show.</div>}
        {state.status === 'error' && (
          <div className="hud" style={{ color: '#ff6b6b', maxWidth: 420, textAlign: 'right' }}>
            computeFlangeBoundary2D threw:
            <br />
            {state.message}
          </div>
        )}
      </div>
    </div>
  )
}
