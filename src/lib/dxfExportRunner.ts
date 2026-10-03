import { DEFAULT_DXF_LABEL_SETTINGS, type DxfLabelSettings } from './dxfLabelSettings'
import { computePreviewBuildInputs, type StrutGeometryEntry } from './previewBuildInputs'
import type { VertexEdgesInfo } from './edgesInfo'
import type { RunStepExportParams } from './stepExportRunner'
import { braceQuadFrame, braceQuadPoints2D, pairBracePoints, projectToFrame2D, type BracePoints } from './braceSolid'
import { layoutDxfParts, writeDxf, type DxfHelperText, type DxfPart } from './dxf'
import type { Vec3 } from './braceSolid'
import { computeBraceEndpoints } from './braces'
import { bracePlateNameKey, createPartNameMaps, type PartNameMaps } from './partNames'
import { runExportBatches } from './exportBatchPool'
import { exportProfilingEnabled, publishExportProfile, type ExportBatchProfile, type ExportWorkerProfile } from './exportProfile'
import type { DxfExportPhase, DxfExportRequest, DxfExportWorkerMessage } from '../workers/dxfExportWorker'
import { DEFAULT_DXF_SHEET_SETTINGS, validateDxfSheetSettings, type DxfSheetSettings } from './dxfSheetSettings'
import { runDxfNesting } from './dxfNestingRunner'

// Same per-worker item cap as the STEP export and the live Preview build, for the same reason.
const BATCH_SIZE = 12

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}

export interface DxfExportProgress {
  phase: DxfExportPhase | 'braces' | 'packing' | 'writing'
  done: number
  total: number
}

type Shared = Omit<DxfExportRequest, 'requestId' | 'strutJobs' | 'vertices'>

type Tuple3 = [number, number, number]

function add(a: Tuple3, b: Tuple3): Tuple3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function sub(a: Tuple3, b: Tuple3): Tuple3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function scale(v: Tuple3, s: number): Tuple3 {
  return [v[0] * s, v[1] * s, v[2] * s]
}

function length(v: Tuple3): number {
  return Math.hypot(v[0], v[1], v[2])
}

function normalize(v: Tuple3): Tuple3 {
  const len = length(v)
  return len > 0 ? scale(v, 1 / len) : [0, 0, 0]
}

function midpoint(a: Tuple3, b: Tuple3): Tuple3 {
  return scale(add(a, b), 0.5)
}

function footPartCenter(vertex: VertexEdgesInfo): Tuple3 | null {
  const foot = vertex.foot
  if (!foot) return null
  const e1 = normalize(vertex.tangentPlane.e1)
  const e2 = normalize(vertex.tangentPlane.e2)
  const angle = (foot.projectedAngleDeg * Math.PI) / 180
  const axis = normalize(add(scale(e1, Math.cos(angle)), scale(e2, Math.sin(angle))))
  if (length(axis) < 1e-12) return null
  return add(vertex.position, scale(axis, foot.holeOffset + foot.thickness / 2))
}

function buildDxfPartNames(
  params: RunStepExportParams,
  strutEntries: StrutGeometryEntry[],
  vertices: VertexEdgesInfo[],
  halfWidth: number,
): PartNameMaps {
  const flangeSpan = halfWidth - params.grooveDepth / 2
  const flanges = vertices.flatMap((vertex) => {
    const normal = normalize(vertex.tangentPlane.normal)
    return [
      { vertexId: vertex.vertexId, side: 'outer' as const, center: add(vertex.position, scale(normal, flangeSpan)) },
      { vertexId: vertex.vertexId, side: 'inner' as const, center: add(vertex.position, scale(normal, -flangeSpan)) },
    ]
  })

  const feet = vertices.flatMap((vertex) => {
    const center = footPartCenter(vertex)
    return center ? [{ id: vertex.vertexId, center }] : []
  })

  const bracePlates = strutEntries.flatMap((job) => {
    const posA = job.posA
    const posB = job.posB
    const axisAB = normalize(sub(posB, posA))
    return [
      ...job.braces.a.slice(0, 1).map((brace) => ({
        id: bracePlateNameKey(brace.braceId, job.index, 'A'),
        center: add(posA, scale(axisAB, brace.distanceFromVertex)),
      })),
      ...job.braces.b.slice(0, 1).map((brace) => ({
        id: bracePlateNameKey(brace.braceId, job.index, 'B'),
        center: add(posB, scale(axisAB, -brace.distanceFromVertex)),
      })),
    ]
  })

  const braces = Array.from(params.data.braces.entries()).flatMap(([braceId, brace]) => {
    const endpoints = computeBraceEndpoints(brace, params.data.edges, (vertexId) => params.transformedVertices.get(vertexId)!)
    if (!endpoints) return []
    const a = endpoints[0].toArray() as Tuple3
    const b = endpoints[1].toArray() as Tuple3
    return [{ id: braceId, center: midpoint(a, b) }]
  })

  return createPartNameMaps(
    {
      struts: strutEntries.map((job) => ({ id: job.index, center: midpoint(job.posA, job.posB) })),
      flanges,
      feet,
      bracePlates,
      braces,
    },
  )
}

function runBatch(
  strutJobs: StrutGeometryEntry[],
  vertices: VertexEdgesInfo[],
  shared: Shared,
  requestId: number,
  onProgress: (done: number) => void,
  signal?: AbortSignal,
): Promise<{ parts: DxfPart[]; bracePoints: BracePoints[]; profile?: ExportWorkerProfile; createToReadyMs: number; readyToResultMs: number }> {
  return new Promise((resolve, reject) => {
    const createdAt = performance.now()
    let readyAt = createdAt
    const worker = new Worker(new URL('../workers/dxfExportWorker.ts', import.meta.url), { type: 'module' })
    const settle = (fn: () => void) => {
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      fn()
    }
    const abort = () => settle(() => reject(new DOMException('Export cancelled', 'AbortError')))
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<DxfExportWorkerMessage>) => {
      const msg = event.data
      if (msg.requestId !== requestId) return
      if (msg.type === 'ready') readyAt = performance.now()
      else if (msg.type === 'progress') onProgress(msg.done)
      else if (msg.type === 'result') {
        const finishedAt = performance.now()
        settle(() => resolve({
          parts: msg.parts,
          bracePoints: msg.bracePoints,
          profile: msg.profile,
          createToReadyMs: readyAt - createdAt,
          readyToResultMs: finishedAt - readyAt,
        }))
      }
      else if (msg.type === 'error') settle(() => reject(new Error(msg.message)))
    }
    worker.onerror = (event) => settle(() => reject(new Error(event.message)))
    worker.postMessage({ ...shared, requestId, strutJobs, vertices } satisfies DxfExportRequest)
  })
}

// Builds a single DXF sheet with the flat 2D outline of every visible strut, flange plate, foot,
// brace plate and brace (each with its ID as a label in its own color - see dxf.ts), scaled by
// `params.scale`. Cancellation stops active workers when a signal is provided. Returns null if cancelled.
export async function runDxfExport(
  params: RunStepExportParams,
  onProgress: (progress: DxfExportProgress | null) => void,
  isCancelled: () => boolean,
  labelSettings: DxfLabelSettings = DEFAULT_DXF_LABEL_SETTINGS,
  sheetSettings: DxfSheetSettings = DEFAULT_DXF_SHEET_SETTINGS,
  signal?: AbortSignal,
): Promise<Blob | null> {
  if (sheetSettings.arrangeOnSheet) validateDxfSheetSettings(sheetSettings)
  const startedAt = performance.now()
  const profiling = exportProfilingEnabled()
  const batchProfiles: ExportBatchProfile[] = []
  const { strutEntries, vertices, halfWidth } = computePreviewBuildInputs(params)
  const names = buildDxfPartNames(params, strutEntries, vertices, halfWidth)

  const shared: Shared = {
    ...labelSettings,
    halfWidth,
    endGrooveLengthPercent: params.endGrooveLengthPercent,
    midGrooveLengthPercent: params.midGrooveLengthPercent,
    grooveDepth: params.grooveDepth,
    millingDiameter: params.millingDiameter,
    chamferLength: params.chamferLength,
    roundStrutBridge: params.roundStrutBridge,
    flangeParams: params.flangeParams,
    names,
    profile: profiling,
    strict: sheetSettings.arrangeOnSheet,
  }

  const parts: DxfPart[] = []
  const bracePoints: BracePoints[] = []

  const strutBatches = chunk(strutEntries, BATCH_SIZE)
  const strutResults = await runExportBatches(
    strutBatches,
    strutEntries.length,
    (batch, i, report) => runBatch(batch, [], shared, i + 1, report, signal),
    (done, total) => onProgress({ phase: 'struts', done, total }),
    (batch, err) => {
      if (sheetSettings.arrangeOnSheet) throw err
      console.error(`Failed to build DXF outlines for struts ${batch.map((job) => job.index).join(', ')}`, err)
    },
    isCancelled,
  )
  if (!strutResults) return null
  for (const [i, result] of strutResults.entries()) {
    if (!result) continue
    parts.push(...result.parts)
    bracePoints.push(...result.bracePoints)
    if (profiling && result.profile) batchProfiles.push({
      phase: 'struts', items: strutBatches[i].length,
      createToReadyMs: result.createToReadyMs, readyToResultMs: result.readyToResultMs,
      worker: result.profile,
    })
  }

  const vertexBatches = chunk(vertices, BATCH_SIZE)
  const vertexResults = await runExportBatches(
    vertexBatches,
    vertices.length,
    (batch, i, report) => runBatch([], batch, shared, strutBatches.length + i + 1, report, signal),
    (done, total) => onProgress({ phase: 'flanges', done, total }),
    (batch, err) => {
      if (sheetSettings.arrangeOnSheet) throw err
      console.error(`Failed to build DXF outlines for flanges of vertices ${batch.map((v) => v.vertexId).join(', ')}`, err)
    },
    isCancelled,
  )
  if (!vertexResults) return null
  for (const [i, result] of vertexResults.entries()) {
    if (!result) continue
    parts.push(...result.parts)
    if (profiling && result.profile) batchProfiles.push({
      phase: 'flanges', items: vertexBatches[i].length,
      createToReadyMs: result.createToReadyMs, readyToResultMs: result.readyToResultMs,
      worker: result.profile,
    })
  }

  if (isCancelled()) return null
  const bodies = pairBracePoints(bracePoints)
  onProgress({ phase: 'braces', done: 0, total: bodies.length })

  // A brace's body is the flat quad through its four plate end points - no WASM needed for that.
  for (const [index, body] of bodies.entries()) {
    if (isCancelled()) return null
    const frame = braceQuadFrame(body.a, body.b)
    if (!frame) {
      if (sheetSettings.arrangeOnSheet) throw new Error(`Cannot construct brace ${names.braces[body.braceId]}.`)
      continue
    }
    // Green: the strut each end of the brace goes into, written along the brace just inside
    // the end (the middle of that strut's two plate end points).
    const height = labelSettings.connectedPartIdLabelSize
    const mid = (pts: [Vec3, Vec3]): [number, number] => {
      const [p, q] = pts.map((pt) => projectToFrame2D(frame, pt))
      return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
    }
    const ends: [string, [number, number]][] = [
      [names.struts[body.edgeIdA], mid(body.a)],
      [names.struts[body.edgeIdB], mid(body.b)],
    ]
    const dir: [number, number] = [ends[1][1][0] - ends[0][1][0], ends[1][1][1] - ends[0][1][1]]
    const len = Math.hypot(dir[0], dir[1]) || 1
    const unit: [number, number] = [dir[0] / len, dir[1] / len]
    const helpers: DxfHelperText[] = ends.map(([text, at], i) => {
      // Moved inward, along the brace, by half the text's length plus a little.
      const inset = (text.length * height * 0.8) / 2 + 2
      const sign = i === 0 ? 1 : -1
      return {
        text,
        x: at[0] + sign * unit[0] * inset,
        y: at[1] + sign * unit[1] * inset,
        angleDeg: (Math.atan2(unit[1], unit[0]) * 180) / Math.PI,
        height,
      }
    })
    parts.push({
      name: names.braces[body.braceId],
      kind: 'brace',
      loops: [{ closed: true, vertices: braceQuadPoints2D(frame).map(([x, y]) => ({ x, y, bulge: 0 })) }],
      labelAngleDeg: (Math.atan2(unit[1], unit[0]) * 180) / Math.PI,
      helpers,
    })
    onProgress({ phase: 'braces', done: index + 1, total: bodies.length })
  }

  const layoutStart = performance.now()
  const options = { scale: params.scale, partIdLabelSize: labelSettings.partIdLabelSize }
  if (sheetSettings.arrangeOnSheet) onProgress({ phase: 'packing', done: 0, total: parts.length })
  const layout = sheetSettings.arrangeOnSheet
    ? await runDxfNesting({ parts, options, settings: sheetSettings }, (done, total) => onProgress({ phase: 'packing', done, total }), isCancelled)
    : { parts: layoutDxfParts(parts, options), sheets: [] }
  if (!layout || isCancelled()) return null
  onProgress({ phase: 'writing', done: 0, total: 1 })
  const writeStart = performance.now()
  const blob = new Blob([writeDxf(layout.parts, layout.sheets)], { type: 'application/dxf' })
  if (profiling) publishExportProfile('dxf', startedAt, batchProfiles, {
    layoutDxfParts: writeStart - layoutStart,
    writeDxf: performance.now() - writeStart,
  })
  onProgress({ phase: 'writing', done: 1, total: 1 })
  return isCancelled() ? null : blob
}
