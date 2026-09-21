import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { NumberField } from '../components/Sidebar'
import { drawingToDXF } from '../lib/dxfExport'
import { strutBoundaryInputFromJson, type StrutBoundaryInput } from '../lib/strutGeometry'
import type { StrutMesh } from '../lib/replicadCad'
import {
  BRACE_PARAM_FIELDS,
  DEFAULT_BRACE_PARAMS,
  sanitizeBraceParam,
  type BraceParams,
  type StrutBraceEnd,
} from '../lib/braces'
import { StrutShapeScene, type StrutShapeViewport } from './StrutShapeScene'

const DEG2RAD = Math.PI / 180

interface Params {
  offset1: number
  offset2: number
  width: number
  cornerLength: number
  radius: number
  angleDeg: number
  endGrooveLengthPercent: number
  midGrooveLengthPercent: number
  grooveDepth: number
  millingDiameter: number
  chamferLength: number
  // A brace at end A / B of the strut and all of its properties (see braces.ts), `shift` being its
  // fraction of the A-B length.
  braceAEnabled: boolean
  braceA: BraceParams
  braceBEnabled: boolean
  braceB: BraceParams
}

type NumberParamKey = { [K in keyof Params]: Params[K] extends number ? K : never }[keyof Params]
type BooleanParamKey = { [K in keyof Params]: Params[K] extends boolean ? K : never }[keyof Params]

const DEFAULT_PARAMS: Params = {
  offset1: 100,
  offset2: 100,
  width: 120,
  cornerLength: 375,
  radius: 2500,
  angleDeg: 60,
  endGrooveLengthPercent: 25,
  midGrooveLengthPercent: 35,
  grooveDepth: 20,
  millingDiameter: 8,
  chamferLength: 6,
  braceAEnabled: false,
  braceA: { ...DEFAULT_BRACE_PARAMS },
  braceBEnabled: false,
  braceB: { ...DEFAULT_BRACE_PARAMS },
}

const DEFAULT_SHOW_HELPER_POINTS = true

// Persisted across reloads so tweaking params or the viewport doesn't get reset by Vite's HMR
// full-reloads (e.g. after editing strutGeometry.ts) or a manual page refresh.
const PARAMS_STORAGE_KEY = 'strut-shape-debug:params'
const VIEWPORT_STORAGE_KEY = 'strut-shape-debug:viewport'
const IMPORTED_STORAGE_KEY = 'strut-shape-debug:imported-input'

// A computeStrutBoundary call imported from a console failure dump. While set it replaces
// the params-derived inputs, so the exact failing call is reproduced.
function loadImportedInput(): StrutBoundaryInput | null {
  try {
    const raw = localStorage.getItem(IMPORTED_STORAGE_KEY)
    return raw ? strutBoundaryInputFromJson(raw) : null
  } catch {
    return null
  }
}

function loadParams(): Params {
  try {
    const raw = localStorage.getItem(PARAMS_STORAGE_KEY)
    if (!raw) return DEFAULT_PARAMS
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PARAMS
    const saved = parsed as Partial<Params>
    return {
      ...DEFAULT_PARAMS,
      ...saved,
      braceA: { ...DEFAULT_BRACE_PARAMS, ...saved.braceA },
      braceB: { ...DEFAULT_BRACE_PARAMS, ...saved.braceB },
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
  | { status: 'ready'; main: StrutMesh | null; helpers: HelperMesh[]; dxf: string | null }
  | { status: 'empty' }
  | { status: 'error'; message: string }

// Companion to EdgeSketchDebug, but wired to `computeStrutBoundary` in
// strutGeometry.ts - a sandbox for hand-building the strut sketch directly with replicad's
// own draw()/boolean-op primitives instead of trusting the existing Vec2 math to get it right.
// Reachable via `npm run strut-shape-debug`, which opens straight here. Edit
// strutGeometry.ts, save, and this page (auto-reloaded by Vite) shows the resulting shape -
// including a clear error message if your function throws, which is expected to happen a lot
// while iterating.
export function StrutShapeDebug() {
  const [params, setParams] = useState<Params>(loadParams)
  const setParam = (field: NumberParamKey) => (value: number) => setParams((prev) => ({ ...prev, [field]: value }))
  const setBraceParam = (brace: 'braceA' | 'braceB', field: keyof BraceParams) => (value: number) =>
    setParams((prev) => ({
      ...prev,
      [brace]: { ...prev[brace], [field]: sanitizeBraceParam(field, value) },
    }))
  const setFlag = (field: BooleanParamKey) => (value: boolean) => setParams((prev) => ({ ...prev, [field]: value }))
  const [state, setState] = useState<State>({ status: 'loading' })
  const [imported, setImported] = useState<StrutBoundaryInput | null>(loadImportedInput)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [showHelperPoints, setShowHelperPoints] = useState(DEFAULT_SHOW_HELPER_POINTS)
  const [initialViewport, setInitialViewport] = useState<StrutShapeViewport | null>(loadViewport)
  // Bumped on Reset to force StrutShapeScene to remount (via `key`) and re-fit the camera to the
  // shape, rather than reusing whatever pan/zoom it already settled into.
  const [viewportResetCount, setViewportResetCount] = useState(0)

  useEffect(() => {
    localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(params))
  }, [params])

  const handleImport = () => {
    try {
      const input = strutBoundaryInputFromJson(importText)
      // Stored with "NaN"/"Infinity" as strings, which the loader turns back into numbers.
      localStorage.setItem(
        IMPORTED_STORAGE_KEY,
        JSON.stringify(input, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v)),
      )
      setImported(input)
      setImportError(null)
      setImportText('')
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleClearImported = () => {
    localStorage.removeItem(IMPORTED_STORAGE_KEY)
    setImported(null)
  }

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
        const [{ ensureReplicadReady, meshDrawing }, { computeStrutBoundary }] = await Promise.all([
          import('../lib/replicadCad'),
          import('../lib/strutGeometry'),
        ])
        await ensureReplicadReady()
        if (cancelled) return

        let call: StrutBoundaryInput
        if (imported) {
          call = imported
        } else {
          const {
            radius,
            angleDeg,
            offset1,
            offset2,
            cornerLength,
            width,
            endGrooveLengthPercent,
            midGrooveLengthPercent,
            grooveDepth,
            millingDiameter,
            chamferLength,
            braceAEnabled,
            braceA,
            braceBEnabled,
            braceB,
          } = params
          const angleRad = angleDeg * DEG2RAD
          const a = new THREE.Vector3(radius * 1.11, 0, 0)
          const b = new THREE.Vector3(radius * Math.cos(angleRad), radius * Math.sin(angleRad), 0)

          const chord = a.distanceTo(b)
          const braceEnd = (braceId: number, brace: BraceParams): StrutBraceEnd => ({
            braceId,
            params: brace,
            distanceFromVertex: brace.shift * chord,
            otherEdgeId: braceId,
            otherEdgeDirection: [0, 0, 1],
          })
          call = {
            a: a.toArray(),
            b: b.toArray(),
            center: [0, 0, 0],
            offsetA: offset1,
            offsetB: offset2,
            cornerLengthA: cornerLength,
            cornerLengthB: cornerLength,
            halfWidth: width / 2,
            endGrooveLengthPercent,
            midGrooveLengthPercent,
            grooveDepth,
            millingDiameter,
            chamferLength,
            braces: {
              a: braceAEnabled ? [braceEnd(0, braceA)] : [],
              b: braceBEnabled ? [braceEnd(1, braceB)] : [],
            },
          }
        }

        console.log('md', call.millingDiameter, imported)
        const result = computeStrutBoundary(
          new THREE.Vector3(...call.a),
          new THREE.Vector3(...call.b),
          new THREE.Vector3(...call.center),
          call.offsetA,
          call.offsetB,
          call.cornerLengthA,
          call.cornerLengthB,
          call.halfWidth,
          call.endGrooveLengthPercent,
          call.midGrooveLengthPercent,
          call.grooveDepth,
          call.millingDiameter,
          call.chamferLength,
          call.braces,
        )
        if (cancelled) return

        const main = result.main ? meshDrawing(result.main) : null
        let dxf: string | null = null
        if (result.main) {
          try {
            dxf = drawingToDXF(result.main)
          } catch (err) {
            console.error('Failed to build DXF export', err)
          }
        }
        const helpers: HelperMesh[] = []
        for (const helper of result.helpers) {
          const mesh = meshDrawing(helper.drawing)
          if (mesh) helpers.push({ mesh, color: helper.color, name: helper.name })
        }
        if (cancelled) return

        setState(main || helpers.length > 0 ? { status: 'ready', main, helpers, dxf } : { status: 'empty' })
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [params, imported])

  const dxf = state.status === 'ready' ? state.dxf : null
  const downloadDxf = () => {
    if (!dxf) return
    const blob = new Blob([dxf], { type: 'application/dxf' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'strut-shape.dxf'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Strut Shape Debug</h1>
        <div className="button-row">
          <a href={import.meta.env.BASE_URL}>&larr; Back to builder</a>
        </div>
        <div className="button-row">
          <button type="button" onClick={downloadDxf} disabled={!dxf}>
            Download as DXF
          </button>
        </div>
        <div className="button-row">
          <button type="button" onClick={handleReset}>
            Reset to defaults
          </button>
        </div>
        <p className="hint">
          Renders whatever <code>computeStrutBoundary</code> in{' '}
          <code>src/lib/strutGeometry.ts</code> returns. Edit that file and save - this page
          reloads automatically.
        </p>

        <section className="control-group">
          <h2>Import failure JSON</h2>
          {imported ? (
            <>
              <p className="hint">
                Showing an <strong>imported call</strong>; the controls below are ignored until you
                clear it.
              </p>
              <div className="button-row">
                <button type="button" onClick={handleClearImported}>
                  Clear imported input
                </button>
              </div>
            </>
          ) : (
            <p className="hint">
              If <code>computeStrutBoundary</code> throws elsewhere in the app, it logs a JSON
              dump to the console. Paste it here to reproduce that exact call.
            </p>
          )}
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder='{ "error": "...", "input": { "a": [...], ... } }'
            rows={5}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 11 }}
          />
          <div className="button-row">
            <button type="button" onClick={handleImport} disabled={!importText.trim()}>
              Load JSON
            </button>
          </div>
          {importError && <p className="hint" style={{ color: '#ff6b6b' }}>{importError}</p>}
        </section>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={showHelperPoints}
            onChange={(e) => setShowHelperPoints(e.target.checked)}
          />
          Show helper points
        </label>

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
            <label>End groove length (%)</label>
            <NumberField
              value={params.endGrooveLengthPercent}
              step={5}
              min={0}
              onCommit={setParam('endGrooveLengthPercent')}
            />
          </div>
          <div className="transform-field">
            <label>Mid groove length (%)</label>
            <NumberField
              value={params.midGrooveLengthPercent}
              step={5}
              min={0}
              onCommit={setParam('midGrooveLengthPercent')}
            />
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

        <section className="control-group">
          <h2>Braces</h2>
          {(['A', 'B'] as const).map((end) => {
            const enabledKey = end === 'A' ? 'braceAEnabled' : 'braceBEnabled'
            const braceKey = end === 'A' ? 'braceA' : 'braceB'
            return (
              <div key={end}>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={params[enabledKey]}
                    onChange={(e) => setFlag(enabledKey)(e.target.checked)}
                  />
                  Brace at end {end}
                </label>
                {BRACE_PARAM_FIELDS.map(({ key, label, step }) => (
                  <div className="transform-field" key={key}>
                    <label>{`${end}: ${label}`}</label>
                    <NumberField
                      value={params[braceKey][key]}
                      step={step}
                      min={0}
                      clamp={(n) => sanitizeBraceParam(key, n)}
                      onCommit={setBraceParam(braceKey, key)}
                    />
                  </div>
                ))}
              </div>
            )
          })}
          <p className="hint">
            Each enabled brace adds a <code>braceCenter</code> helper point (midway across the
            strut&rsquo;s width, where the ray from the center through the brace&rsquo;s position
            along the strut crosses it) and its plate: a rounded rectangle, brace width long along
            the strut and as wide as fits between the arcs across it (up to the max plate width),
            with 6 holes. The 4 corner holes are also cut through the strut.
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
        {state.status === 'empty' && <div className="hud">computeStrutBoundary returned nothing to show.</div>}
        {state.status === 'error' && (
          <div className="hud" style={{ color: '#ff6b6b', maxWidth: 420, textAlign: 'right' }}>
            computeStrutBoundary threw:
            <br />
            {state.message}
          </div>
        )}
      </div>
    </div>
  )
}
