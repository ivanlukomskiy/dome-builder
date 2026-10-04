import { DEFAULT_STEP_EXPORT_SETTINGS, validateStepLabelDepth, type StepExportSettings } from './stepExportSettings'
import { buildExportPartNames } from './exportPartNames'
import JSZip from 'jszip'
import type { FlangeShapeParams } from './flangeGeometry'
import { computePreviewBuildInputs, type PreviewBuildInputParams, type StrutGeometryEntry } from './previewBuildInputs'
import type { VertexEdgesInfo } from './edgesInfo'
import { pairBracePoints, type BraceBody, type BracePoints } from './braceSolid'
import { runExportBatches } from './exportBatchPool'
import { exportProfilingEnabled, publishExportProfile, type ExportBatchProfile, type ExportWorkerProfile } from './exportProfile'
import type {
  StepExportPiece,
  StepExportRequest,
  StepExportWorkerMessage,
  StepExportWorkerPhase,
} from '../workers/stepExportWorker'

// Same per-worker item cap as DomeMesh.tsx's live Preview build, and for the same reason: no
// single opencascade instance should have to hold more than one batch's worth of accumulated
// geometry before its heap gets reclaimed by tearing the worker down.
const BATCH_SIZE = 12

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}

export interface StepExportProgress {
  phase: StepExportWorkerPhase | 'zipping'
  done: number
  total: number
}

export interface RunStepExportParams extends PreviewBuildInputParams {
  stepExportSettings?: StepExportSettings
  flangeParams: FlangeShapeParams
  // Uniform scale factor (1 = no change) applied to every exported solid - see
  // buildStrutStepFromDrawing in replicadCad.ts.
  scale: number
}

// Runs one batch (a handful of struts, or of flange vertices - never both) in its own fresh
// worker, terminated the moment its result comes back - see stepExportWorker.ts and DomeMesh.tsx's
// own runBatch for why.
function runBatch(
  strutJobs: StrutGeometryEntry[],
  vertices: VertexEdgesInfo[],
  braceBodies: BraceBody[],
  shared: Omit<StepExportRequest, 'requestId' | 'strutJobs' | 'vertices' | 'braceBodies'>,
  requestId: number,
  onProgress: (done: number) => void,
  signal?: AbortSignal,
): Promise<{ pieces: StepExportPiece[]; bracePoints: BracePoints[]; profile?: ExportWorkerProfile; createToReadyMs: number; readyToResultMs: number }> {
  return new Promise((resolve, reject) => {
    const createdAt = performance.now()
    let readyAt = createdAt
    const worker = new Worker(new URL('../workers/stepExportWorker.ts', import.meta.url), {
      type: 'module',
    })

    const settle = (fn: () => void) => {
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      fn()
    }
    const abort = () => settle(() => reject(new DOMException('Export cancelled', 'AbortError')))
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })

    worker.onmessage = (event: MessageEvent<StepExportWorkerMessage>) => {
      const msg = event.data
      if (msg.requestId !== requestId) return

      if (msg.type === 'ready') {
        readyAt = performance.now()
      } else if (msg.type === 'progress') {
        onProgress(msg.done)
      } else if (msg.type === 'result') {
        const finishedAt = performance.now()
        settle(() => resolve({
          pieces: msg.pieces,
          bracePoints: msg.bracePoints,
          profile: msg.profile,
          createToReadyMs: readyAt - createdAt,
          readyToResultMs: finishedAt - readyAt,
        }))
      } else if (msg.type === 'error') {
        settle(() => reject(new Error(msg.message)))
      }
    }
    worker.onerror = (event) => {
      settle(() => reject(new Error(event.message)))
    }

    const request: StepExportRequest = { ...shared, requestId, strutJobs, vertices, braceBodies }
    worker.postMessage(request)
  })
}

function runAssembly(
  strutJobs: StrutGeometryEntry[],
  vertices: VertexEdgesInfo[],
  shared: Omit<StepExportRequest, 'requestId' | 'strutJobs' | 'vertices' | 'braceBodies' | 'mode'>,
  requestId: number,
  onProgress: (progress: StepExportProgress) => void,
  signal?: AbortSignal,
): Promise<{ blob: Blob | null; profile?: ExportWorkerProfile; createToReadyMs: number; readyToResultMs: number }> {
  return new Promise((resolve, reject) => {
    const createdAt = performance.now()
    let readyAt = createdAt
    const worker = new Worker(new URL('../workers/stepExportWorker.ts', import.meta.url), {
      type: 'module',
    })

    const settle = (fn: () => void) => {
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      fn()
    }
    const abort = () => settle(() => reject(new DOMException('Export cancelled', 'AbortError')))
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })

    worker.onmessage = (event: MessageEvent<StepExportWorkerMessage>) => {
      const msg = event.data
      if (msg.requestId !== requestId) return

      if (msg.type === 'ready') {
        readyAt = performance.now()
      } else if (msg.type === 'progress') {
        onProgress({ phase: msg.phase, done: msg.done, total: msg.total })
      } else if (msg.type === 'result') {
        const finishedAt = performance.now()
        settle(() => resolve({
          blob: msg.assemblyBlob ?? null,
          profile: msg.profile,
          createToReadyMs: readyAt - createdAt,
          readyToResultMs: finishedAt - readyAt,
        }))
      } else if (msg.type === 'error') {
        settle(() => reject(new Error(msg.message)))
      }
    }
    worker.onerror = (event) => {
      settle(() => reject(new Error(event.message)))
    }

    const request: StepExportRequest = {
      ...shared,
      requestId,
      mode: 'assembly',
      strutJobs,
      vertices,
      braceBodies: [],
    }
    worker.postMessage(request)
  })
}

type PartsShared = Omit<StepExportRequest, 'requestId' | 'strutJobs' | 'vertices' | 'braceBodies'>

// What every worker of a parts export (the whole archive, or one debug part) is told besides its
// own jobs: the applied geometry params and, with labels on, what to engrave.
function buildPartsShared(
  params: RunStepExportParams,
  { strutEntries, vertices, halfWidth }: ReturnType<typeof computePreviewBuildInputs>,
  profiling: boolean,
): PartsShared {
  const settings = params.stepExportSettings ?? DEFAULT_STEP_EXPORT_SETTINGS
  if (settings.addLabels) validateStepLabelDepth(settings.depth)

  return {
    engraving: settings.addLabels ? {
      depth: settings.depth,
      partIdLabelSize: settings.partIdLabelSize,
      connectedPartIdLabelSize: settings.connectedPartIdLabelSize,
      names: buildExportPartNames(params, strutEntries, vertices, halfWidth),
    } : undefined,
    halfWidth,
    endGrooveLengthPercent: params.endGrooveLengthPercent,
    midGrooveLengthPercent: params.midGrooveLengthPercent,
    grooveDepth: params.grooveDepth,
    millingDiameter: params.millingDiameter,
    chamferLength: params.chamferLength,
    roundStrutBridge: params.roundStrutBridge,
    flangeParams: params.flangeParams,
    scale: params.scale,
    profile: profiling,
  }
}

// Builds a STEP file for every visible strut and flange plate (see stepExportWorker.ts) and zips
// them into a single archive, reporting progress as it goes. Cancellation stops active workers
// when a signal is provided and prevents subsequent batches from starting.
export async function runStepExport(
  params: RunStepExportParams,
  onProgress: (progress: StepExportProgress | null) => void,
  isCancelled: () => boolean,
  signal?: AbortSignal,
): Promise<Blob | null> {
  const startedAt = performance.now()
  const profiling = exportProfilingEnabled()
  const batchProfiles: ExportBatchProfile[] = []
  const inputs = computePreviewBuildInputs(params)
  const { strutEntries, vertices } = inputs
  const shared = buildPartsShared(params, inputs, profiling)

  const allPieces: StepExportPiece[] = []
  // Every strut's brace plate end points, across batches - a brace's two struts can land in
  // different batches, so the bodies are only built once all of them are in.
  const allBracePoints: BracePoints[] = []

  const strutBatches = chunk(strutEntries, BATCH_SIZE)
  const strutResults = await runExportBatches(
    strutBatches,
    strutEntries.length,
    (batch, i, report) => runBatch(batch, [], [], shared, i + 1, report, signal),
    (done, total) => onProgress({ phase: 'struts', done, total }),
    (batch, err) => { throw new Error(`Failed to export struts ${batch.map((job) => job.index).join(', ')}: ${err instanceof Error ? err.message : String(err)}`) },
    isCancelled,
  )
  if (!strutResults) return null
  for (const [i, result] of strutResults.entries()) {
    if (!result) continue
    allPieces.push(...result.pieces)
    allBracePoints.push(...result.bracePoints)
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
    (batch, i, report) => runBatch([], batch, [], shared, strutBatches.length + i + 1, report, signal),
    (done, total) => onProgress({ phase: 'flanges', done, total }),
    (batch, err) => { throw new Error(`Failed to export flanges for vertices ${batch.map((v) => v.vertexId).join(', ')}: ${err instanceof Error ? err.message : String(err)}`) },
    isCancelled,
  )
  if (!vertexResults) return null
  for (const [i, result] of vertexResults.entries()) {
    if (!result) continue
    allPieces.push(...result.pieces)
    if (profiling && result.profile) batchProfiles.push({
      phase: 'flanges', items: vertexBatches[i].length,
      createToReadyMs: result.createToReadyMs, readyToResultMs: result.readyToResultMs,
      worker: result.profile,
    })
  }

  const braceBodies = pairBracePoints(allBracePoints)
  const braceBatches = chunk(braceBodies, BATCH_SIZE)
  const braceResults = await runExportBatches(
    braceBatches,
    braceBodies.length,
    (batch, i, report) => runBatch([], [], batch, shared, strutBatches.length + vertexBatches.length + i + 1, report, signal),
    (done, total) => onProgress({ phase: 'braces', done, total }),
    (batch, err) => { throw new Error(`Failed to export braces ${batch.map((b) => b.braceId).join(', ')}: ${err instanceof Error ? err.message : String(err)}`) },
    isCancelled,
  )
  if (!braceResults) return null
  for (const [i, result] of braceResults.entries()) {
    if (!result) continue
    allPieces.push(...result.pieces)
    if (profiling && result.profile) batchProfiles.push({
      phase: 'braces', items: braceBatches[i].length,
      createToReadyMs: result.createToReadyMs, readyToResultMs: result.readyToResultMs,
      worker: result.profile,
    })
  }

  if (isCancelled()) return null

  onProgress({ phase: 'zipping', done: 0, total: 100 })
  const zipStart = performance.now()
  const zip = new JSZip()
  for (const piece of allPieces) zip.file(piece.name, piece.blob)
  const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
    if (!isCancelled()) onProgress({ phase: 'zipping', done: Math.round(metadata.percent), total: 100 })
  })

  if (profiling && !isCancelled()) publishExportProfile('stepArchive', startedAt, batchProfiles, { zip: performance.now() - zipStart })
  return isCancelled() ? null : zipBlob
}

export const STEP_DEBUG_PART_KINDS = ['strut', 'flange', 'foot', 'bracePlate', 'brace'] as const
export type StepDebugPartKind = typeof STEP_DEBUG_PART_KINDS[number]

function pickRandom<T>(items: T[]): T {
  if (items.length === 0) throw new Error('The model has no parts of this type.')
  return items[Math.floor(Math.random() * items.length)]
}

// Builds the STEP file of one randomly picked part of the given kind, exactly as runStepExport
// would build it for the archive (same worker, same params, same engraved labels) - for checking
// export settings on a single part without waiting for the whole dome.
export async function runStepDebugExport(
  params: RunStepExportParams,
  kind: StepDebugPartKind,
  onProgress: (progress: StepExportProgress | null) => void,
  isCancelled: () => boolean,
  signal?: AbortSignal,
): Promise<StepExportPiece | null> {
  const inputs = computePreviewBuildInputs(params)
  const { strutEntries, vertices } = inputs
  const shared = buildPartsShared(params, inputs, false)

  let name: string
  let phase: StepExportWorkerPhase = 'struts'
  let strutJobs: StrutGeometryEntry[] = []
  let vertexJobs: VertexEdgesInfo[] = []
  let braceBodies: BraceBody[] = []

  if (kind === 'strut') {
    const job = pickRandom(strutEntries)
    name = `strut-${job.index}.step`
    strutJobs = [job]
  } else if (kind === 'flange' || kind === 'foot') {
    phase = 'flanges'
    const vertex = pickRandom(kind === 'foot' ? vertices.filter((v) => v.foot) : vertices)
    name = kind === 'foot'
      ? `foot-${vertex.vertexId}.step`
      : `flange-${vertex.vertexId}-${pickRandom(['outer', 'inner'])}.step`
    vertexJobs = [vertex]
  } else {
    // Only the first brace on each strut end gets a plate and a body - same as stepExportWorker.ts.
    const plates = strutEntries.flatMap((job) => ([['A', job.braces.a[0]], ['B', job.braces.b[0]]] as const)
      .flatMap(([end, brace]) => brace ? [{ job, end, brace }] : []))
    if (kind === 'bracePlate') {
      const plate = pickRandom(plates.filter(({ brace }) => brace.params.plateThickness > 0))
      name = `brace-plate-${plate.brace.braceId}-strut-${plate.job.index}-${plate.end}.step`
      strutJobs = [plate.job]
    } else {
      const braceId = pickRandom(plates).brace.braceId
      name = `brace-${braceId}.step`
      // The body spans the plates on the brace's two struts, so their end points come first.
      const jobs = [...new Set(plates.filter(({ brace }) => brace.braceId === braceId).map(({ job }) => job))]
      const points = await runBatch(jobs, [], [], { ...shared, onlyPiece: name }, 1,
        (done) => onProgress({ phase: 'struts', done, total: jobs.length }), signal)
      if (isCancelled()) return null
      const body = pairBracePoints(points.bracePoints).find((b) => b.braceId === braceId)
      if (!body) throw new Error(`Brace ${braceId} has no plate end points on both of its struts.`)
      phase = 'braces'
      braceBodies = [body]
    }
  }

  const result = await runBatch(strutJobs, vertexJobs, braceBodies, { ...shared, onlyPiece: name }, 2,
    (done) => onProgress({ phase, done, total: 1 }), signal)
  if (isCancelled()) return null
  const piece = result.pieces.find((p) => p.name === name)
  if (!piece) throw new Error(`${name} produced no solid.`)
  return piece
}

// Builds one STEP assembly containing every visible strut, flange plate, brace plate and brace in
// its Preview position. Unlike runStepExport, this has to keep all shapes in one OpenCascade
// worker long enough for the STEP assembly writer to reference them together.
export async function runStepAssemblyExport(
  params: RunStepExportParams,
  onProgress: (progress: StepExportProgress | null) => void,
  isCancelled: () => boolean,
  signal?: AbortSignal,
): Promise<Blob | null> {
  const startedAt = performance.now()
  const profiling = exportProfilingEnabled()
  const { strutEntries, vertices, halfWidth } = computePreviewBuildInputs(params)

  const shared: Omit<StepExportRequest, 'requestId' | 'strutJobs' | 'vertices' | 'braceBodies' | 'mode'> = {
    halfWidth,
    endGrooveLengthPercent: params.endGrooveLengthPercent,
    midGrooveLengthPercent: params.midGrooveLengthPercent,
    grooveDepth: params.grooveDepth,
    millingDiameter: params.millingDiameter,
    chamferLength: params.chamferLength,
    roundStrutBridge: params.roundStrutBridge,
    flangeParams: params.flangeParams,
    scale: params.scale,
    profile: profiling,
  }

  if (isCancelled()) return null

  const result = await runAssembly(strutEntries, vertices, shared, 1, onProgress, signal)
  if (profiling && !isCancelled() && result.profile) publishExportProfile('stepAssembly', startedAt, [{
    phase: 'assembly', items: strutEntries.length + vertices.length,
    createToReadyMs: result.createToReadyMs, readyToResultMs: result.readyToResultMs,
    worker: result.profile,
  }])
  return isCancelled() ? null : result.blob
}
