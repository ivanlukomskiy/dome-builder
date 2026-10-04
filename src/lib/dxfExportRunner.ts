import { DEFAULT_DXF_LABEL_SETTINGS, type DxfLabelSettings } from './dxfLabelSettings'
import { computePreviewBuildInputs, type StrutGeometryEntry } from './previewBuildInputs'
import type { VertexEdgesInfo } from './edgesInfo'
import type { RunStepExportParams } from './stepExportRunner'
import { braceQuadFrame, braceQuadPoints2D, pairBracePoints, type BracePoints } from './braceSolid'
import { layoutDxfParts, orientDxfStrut, writeDxf, type DxfPart } from './dxf'
import { buildExportPartNames } from './exportPartNames'
import { bracePartLabels } from './partLabels'
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
  const names = buildExportPartNames(params, strutEntries, vertices, halfWidth)

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
    parts.push({
      ...bracePartLabels(body, names, labelSettings),
      kind: 'brace',
      loops: [{ closed: true, vertices: braceQuadPoints2D(frame).map(([x, y]) => ({ x, y, bulge: 0 })) }],
    })
    onProgress({ phase: 'braces', done: index + 1, total: bodies.length })
  }

  const layoutStart = performance.now()
  const options = { scale: params.scale, partIdLabelSize: labelSettings.partIdLabelSize }
  const orientedParts = parts.map(orientDxfStrut)
  if (sheetSettings.arrangeOnSheet) onProgress({ phase: 'packing', done: 0, total: parts.length })
  const layout = sheetSettings.arrangeOnSheet
    ? await runDxfNesting({ parts: orientedParts, options, settings: sheetSettings }, (done, total) => onProgress({ phase: 'packing', done, total }), isCancelled)
    : { parts: layoutDxfParts(orientedParts, options), sheets: [] }
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
