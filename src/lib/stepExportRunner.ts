import JSZip from 'jszip'
import type { FlangeShapeParams } from './flangeGeometry'
import { computePreviewBuildInputs, type PreviewBuildInputParams, type StrutGeometryEntry } from './previewBuildInputs'
import type { VertexEdgesInfo } from './edgesInfo'
import { pairBracePoints, type BraceBody, type BracePoints } from './braceSolid'
import { runExportBatches } from './exportBatchPool'
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
): Promise<{ pieces: StepExportPiece[]; bracePoints: BracePoints[] }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/stepExportWorker.ts', import.meta.url), {
      type: 'module',
    })

    const settle = (fn: () => void) => {
      worker.terminate()
      fn()
    }

    worker.onmessage = (event: MessageEvent<StepExportWorkerMessage>) => {
      const msg = event.data
      if (msg.requestId !== requestId) return

      if (msg.type === 'progress') {
        onProgress(msg.done)
      } else if (msg.type === 'result') {
        settle(() => resolve({ pieces: msg.pieces, bracePoints: msg.bracePoints }))
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
): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/stepExportWorker.ts', import.meta.url), {
      type: 'module',
    })

    const settle = (fn: () => void) => {
      worker.terminate()
      fn()
    }

    worker.onmessage = (event: MessageEvent<StepExportWorkerMessage>) => {
      const msg = event.data
      if (msg.requestId !== requestId) return

      if (msg.type === 'progress') {
        onProgress({ phase: msg.phase, done: msg.done, total: msg.total })
      } else if (msg.type === 'result') {
        settle(() => resolve(msg.assemblyBlob ?? null))
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

// Builds a STEP file for every visible strut and flange plate (see stepExportWorker.ts) and zips
// them into a single archive, reporting progress as it goes. `isCancelled` is polled between
// batches so a caller can abandon an in-flight export (e.g. the user navigated away) without
// starting more work. Already-running batches finish in their own workers and are discarded.
export async function runStepExport(
  params: RunStepExportParams,
  onProgress: (progress: StepExportProgress | null) => void,
  isCancelled: () => boolean,
): Promise<Blob | null> {
  const { strutEntries, vertices, halfWidth } = computePreviewBuildInputs(params)

  const shared: Omit<StepExportRequest, 'requestId' | 'strutJobs' | 'vertices' | 'braceBodies'> = {
    halfWidth,
    endGrooveLengthPercent: params.endGrooveLengthPercent,
    midGrooveLengthPercent: params.midGrooveLengthPercent,
    grooveDepth: params.grooveDepth,
    millingDiameter: params.millingDiameter,
    chamferLength: params.chamferLength,
    roundStrutBridge: params.roundStrutBridge,
    flangeParams: params.flangeParams,
    scale: params.scale,
  }

  const allPieces: StepExportPiece[] = []
  // Every strut's brace plate end points, across batches - a brace's two struts can land in
  // different batches, so the bodies are only built once all of them are in.
  const allBracePoints: BracePoints[] = []

  const strutBatches = chunk(strutEntries, BATCH_SIZE)
  const strutResults = await runExportBatches(
    strutBatches,
    strutEntries.length,
    (batch, i, report) => runBatch(batch, [], [], shared, i + 1, report),
    (done, total) => onProgress({ phase: 'struts', done, total }),
    (batch, err) => console.error(`Failed to export struts ${batch.map((job) => job.index).join(', ')}`, err),
    isCancelled,
  )
  if (!strutResults) return null
  for (const result of strutResults) {
    if (!result) continue
    allPieces.push(...result.pieces)
    allBracePoints.push(...result.bracePoints)
  }

  const vertexBatches = chunk(vertices, BATCH_SIZE)
  const vertexResults = await runExportBatches(
    vertexBatches,
    vertices.length,
    (batch, i, report) => runBatch([], batch, [], shared, strutBatches.length + i + 1, report),
    (done, total) => onProgress({ phase: 'flanges', done, total }),
    (batch, err) => console.error(`Failed to export flanges for vertices ${batch.map((v) => v.vertexId).join(', ')}`, err),
    isCancelled,
  )
  if (!vertexResults) return null
  for (const result of vertexResults) {
    if (result) allPieces.push(...result.pieces)
  }

  const braceBodies = pairBracePoints(allBracePoints)
  const braceBatches = chunk(braceBodies, BATCH_SIZE)
  const braceResults = await runExportBatches(
    braceBatches,
    braceBodies.length,
    (batch, i, report) => runBatch([], [], batch, shared, strutBatches.length + vertexBatches.length + i + 1, report),
    (done, total) => onProgress({ phase: 'braces', done, total }),
    (batch, err) => console.error(`Failed to export braces ${batch.map((b) => b.braceId).join(', ')}`, err),
    isCancelled,
  )
  if (!braceResults) return null
  for (const result of braceResults) {
    if (result) allPieces.push(...result.pieces)
  }

  if (isCancelled()) return null

  onProgress({ phase: 'zipping', done: 0, total: allPieces.length })
  const zip = new JSZip()
  for (const piece of allPieces) zip.file(piece.name, piece.blob)
  const zipBlob = await zip.generateAsync({ type: 'blob' })

  return isCancelled() ? null : zipBlob
}

// Builds one STEP assembly containing every visible strut, flange plate, brace plate and brace in
// its Preview position. Unlike runStepExport, this has to keep all shapes in one OpenCascade
// worker long enough for the STEP assembly writer to reference them together.
export async function runStepAssemblyExport(
  params: RunStepExportParams,
  onProgress: (progress: StepExportProgress | null) => void,
  isCancelled: () => boolean,
): Promise<Blob | null> {
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
  }

  if (isCancelled()) return null

  const blob = await runAssembly(strutEntries, vertices, shared, 1, onProgress)
  return isCancelled() ? null : blob
}
